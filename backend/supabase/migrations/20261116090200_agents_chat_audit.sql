-- Chat and agents, and the audit log.
--
-- Chat is the assistant inside the portal; agents are bots with their own instructions and a set of tools and
-- actions they may use. Every chat message (what was asked, what the model answered, which model, how many tokens)
-- is kept, and every change to a firm's data is written to an append-only audit log, whether a person made it
-- or an agent did. Firms handle legal matters, so this is the record of who did what and when.

-- ---------- agents ----------

create table public.bots (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms (id) on delete cascade,
  name          text not null,
  description   text not null default '',
  -- The standing instructions (system prompt).
  instructions  text not null default '',
  model         text not null default 'balanced' check (model in ('fast', 'balanced', 'advanced')),
  -- What it may read: leads, tasks, documents, campaigns, messages, services.
  tools         text[] not null default '{leads}',
  -- What it may change, always after a person approves: create_lead, move_stage, book_task, send_text, set_services.
  actions       text[] not null default '{}',
  -- What it may reach outside the portal.
  external      text[] not null default '{}',
  active        boolean not null default false,
  runs          integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid default auth.uid() references auth.users (id) on delete set null,
  check (tools <@ array['leads', 'tasks', 'documents', 'campaigns', 'messages', 'services']),
  check (actions <@ array['create_lead', 'move_stage', 'book_task', 'send_text', 'set_services']),
  check (external <@ array['web', 'pages', 'browser', 'email', 'calendar', 'files', 'api'])
);
create index bots_firm_idx on public.bots (firm_id);
create trigger bots_touch before update on public.bots for each row execute function public.touch_updated_at();

-- ---------- chat ----------

create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms (id) on delete cascade,
  -- Whose conversation it is. Each person sees only their own chats.
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The agent answering, or null for the general assistant.
  bot_id      uuid references public.bots (id) on delete set null,
  title       text not null default 'New chat',
  unread      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index conversations_user_idx on public.conversations (user_id, updated_at desc);
create trigger conversations_touch before update on public.conversations for each row execute function public.touch_updated_at();

create table public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  firm_id          uuid not null references public.firms (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  text             text not null default '',
  -- The tools used to answer, shown above the answer.
  steps            text[] not null default '{}',
  -- A change the assistant proposed: { kind, summary, params, status: proposed|done|cancelled|failed, result }
  action           jsonb,
  -- For the record: which model answered and what it cost.
  model            text,
  input_tokens     integer,
  output_tokens    integer,
  created_at       timestamptz not null default now()
);
create index chat_messages_conversation_idx on public.chat_messages (conversation_id, created_at);

alter table public.bots enable row level security;
alter table public.conversations enable row level security;
alter table public.chat_messages enable row level security;

create policy "firm members read agents" on public.bots for select to authenticated using (public.is_member(firm_id));
create policy "admins manage agents" on public.bots for all to authenticated using (public.is_admin(firm_id)) with check (public.is_admin(firm_id));

create policy "own conversations" on public.conversations for select to authenticated using (user_id = auth.uid() and public.is_member(firm_id));
create policy "start conversations" on public.conversations for insert to authenticated with check (user_id = auth.uid() and public.is_member(firm_id));
create policy "rename own conversations" on public.conversations for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(firm_id));
create policy "delete own conversations" on public.conversations for delete to authenticated using (user_id = auth.uid());

-- Messages are written only by the chat function (service role), so the record can't be edited from the portal.
create policy "read own chat messages" on public.chat_messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));

-- ---------- audit log ----------

create table public.audit_log (
  id          bigint generated always as identity primary key,
  -- No foreign key: the history is kept even if a firm is deleted.
  firm_id     uuid,
  at          timestamptz not null default now(),
  -- user: a person in the portal · agent: an agent, after a person approved · system: automations and webhooks
  actor_type  text not null check (actor_type in ('user', 'agent', 'system')),
  actor_id    uuid,
  bot_id      uuid,
  -- insert, update, delete, or a named event such as chat.message, agent.action, email.sent, member.invited
  action      text not null,
  table_name  text,
  record_id   text,
  before      jsonb,
  after       jsonb,
  meta        jsonb not null default '{}'
);
create index audit_log_firm_idx on public.audit_log (firm_id, at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);

alter table public.audit_log enable row level security;
-- Firm admins can read their firm's log. Nobody can change or delete it from the portal: no insert, update or
-- delete policies, and the table's privileges are revoked below. Rows are written by the trigger and the functions.
create policy "admins read the audit log" on public.audit_log for select to authenticated using (public.is_admin(firm_id));
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

-- Server functions acting for an agent set these for the transaction, so the trigger records the change as the agent's:
--   select set_config('app.actor_type', 'agent', true), set_config('app.bot_id', '<bot id>', true), set_config('app.actor_id', '<user id>', true)
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec       jsonb := to_jsonb(coalesce(new, old));
  actor     text := coalesce(nullif(current_setting('app.actor_type', true), ''), case when auth.uid() is null then 'system' else 'user' end);
  actor_uid uuid := coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, auth.uid());
  bot       uuid := nullif(current_setting('app.bot_id', true), '')::uuid;
begin
  -- Skip updates that only moved updated_at.
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then return new; end if;
  insert into public.audit_log (firm_id, actor_type, actor_id, bot_id, action, table_name, record_id, before, after)
  values (
    (case when tg_table_name = 'firms' then rec ->> 'id' else rec ->> 'firm_id' end)::uuid, actor, actor_uid, bot, lower(tg_op), tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'lead_id', rec ->> 'user_id', rec ->> 'provider'),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'firms', 'firm_members', 'services', 'leads', 'lead_services', 'engagement_packets', 'tasks', 'documents',
    'campaign_folders', 'campaigns', 'message_templates', 'messages', 'integrations', 'bots', 'chat_messages'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;
