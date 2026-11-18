-- The portal's data: leads and their activity, tasks, calendar events, services, the document library,
-- campaigns (with folders and recipients), message templates, sent messages and integrations.
-- Shapes follow src/api/types.ts in the portal. Every table has firm_id; the policies at the end of this file
-- give members of a firm full access to that firm's rows and nothing else.

-- ---------- services ----------

create table public.services (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references public.firms (id) on delete cascade,
  name           text not null,
  practice       text not null,
  description    text not null default '',
  pricing_model  text not null default 'flat' check (pricing_model in ('flat', 'hourly', 'monthly', 'contingency')),
  -- flat: fee · hourly: rate per hour · monthly: fee per month · contingency: percentage
  price          numeric(12, 2) not null default 0 check (price >= 0),
  retainer       numeric(12, 2) not null default 0 check (retainer >= 0),
  active         boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index services_firm_idx on public.services (firm_id, practice, name);

-- ---------- leads ----------

create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms (id) on delete cascade,
  name         text not null,
  email        text not null default '',
  phone        text not null default '',
  matter       text not null default '',
  practice     text not null default '',
  source       text not null default 'manual' check (source in ('web', 'email', 'text', 'manual', 'referral', 'ads')),
  -- Estimated fee, from the services taken.
  value        numeric(12, 2) not null default 0 check (value >= 0),
  stage        text not null default 'new' check (stage in ('new', 'contacted', 'consult', 'contract', 'signed', 'payment', 'delivered', 'lost')),
  owner_id     uuid references auth.users (id) on delete set null,
  lost_reason  text,
  opted_out    boolean not null default false,
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index leads_firm_stage_idx on public.leads (firm_id, stage);
create index leads_firm_created_idx on public.leads (firm_id, created_at desc);
create index leads_owner_idx on public.leads (owner_id);

-- The services a lead is taking.
create table public.lead_services (
  lead_id     uuid not null references public.leads (id) on delete cascade,
  service_id  uuid not null references public.services (id) on delete restrict,
  firm_id     uuid not null references public.firms (id) on delete cascade,
  primary key (lead_id, service_id)
);

-- The timeline on a ticket.
create table public.lead_activities (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms (id) on delete cascade,
  lead_id     uuid not null references public.leads (id) on delete cascade,
  at          timestamptz not null default now(),
  type        text not null check (type in ('enquiry', 'auto', 'text', 'email', 'call', 'meeting', 'doc', 'signed', 'stage', 'reminder', 'lost')),
  -- '' normal, 'auto' sent by automation, 'good' milestone, 'bad' held, failed or lost
  cls         text not null default '' check (cls in ('', 'auto', 'good', 'bad')),
  title       text not null,
  text        text,
  quote       text,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null
);
create index lead_activities_lead_idx on public.lead_activities (lead_id, at);
create index lead_activities_firm_idx on public.lead_activities (firm_id, at desc);

-- Documents sent to a lead for signature, as one packet.
create table public.engagement_packets (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms (id) on delete cascade,
  lead_id    uuid not null references public.leads (id) on delete cascade,
  status     text not null default 'sent' check (status in ('sent', 'signed', 'void')),
  sent_at    timestamptz not null default now(),
  signed_at  timestamptz,
  signed_by  text,
  -- [{ templateId, name, values: { inputId: value } }]
  items      jsonb not null default '[]',
  -- The e-signature provider's envelope id, once one is connected.
  provider_ref text
);
create index engagement_packets_lead_idx on public.engagement_packets (lead_id, sent_at desc);

-- ---------- tasks and calendar ----------

create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms (id) on delete cascade,
  type          text not null default 'task' check (type in ('task', 'call', 'meeting', 'follow_up', 'deadline')),
  title         text not null,
  due_at        timestamptz not null,
  done          boolean not null default false,
  completed_at  timestamptz,
  assigned_to   uuid references auth.users (id) on delete set null,
  lead_id       uuid references public.leads (id) on delete cascade,
  notes         text not null default '',
  -- Booked by a pipeline stage change; closed automatically when the stage moves on.
  auto          boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index tasks_firm_due_idx on public.tasks (firm_id, done, due_at);
create index tasks_lead_idx on public.tasks (lead_id);

create table public.firm_events (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms (id) on delete cascade,
  starts_at     timestamptz not null,
  duration_min  integer not null default 60 check (duration_min > 0),
  title         text not null,
  who           text not null default ''
);
create index firm_events_firm_idx on public.firm_events (firm_id, starts_at);

-- ---------- document library ----------

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms (id) on delete cascade,
  name         text not null,
  category     text not null default 'Other' check (category in ('Engagement', 'Fees', 'Intake', 'Compliance', 'Other')),
  description  text not null default '',
  -- The file in the private "documents" storage bucket, at <firm_id>/<document id>/<file name>.
  file_path    text,
  file_name    text,
  file_size    bigint,
  file_type    text,
  uploaded_at  timestamptz,
  -- [{ id, label, source, kind, required }]
  fields       jsonb not null default '[]',
  -- Only active documents (with a file) can be sent.
  active       boolean not null default false check (not active or file_path is not null),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid() references auth.users (id) on delete set null
);
create index documents_firm_idx on public.documents (firm_id, updated_at desc);

-- ---------- campaigns ----------

create table public.campaign_folders (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);
create unique index campaign_folders_name_idx on public.campaign_folders (firm_id, lower(name));

create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms (id) on delete cascade,
  folder_id   uuid references public.campaign_folders (id) on delete set null,
  kind        text not null check (kind in ('auto', 'broadcast', 'survey')),
  metric      text check (metric in ('nps', 'csat')),
  name        text not null,
  channel     text not null check (channel in ('Text', 'Email', 'Text and Email')),
  subject     text not null default '',
  body        text not null,
  -- Inputs beyond {first}, {matter} and {firm}: [{ id, label, source }]
  tags        jsonb not null default '[]',
  -- Automatic campaigns: e.g. "A ticket moves to Signed". One-off sends and surveys: who they go to.
  trigger     text,
  audience    text check (audience in ('open', 'consult', 'clients', 'lost', 'all')),
  active      boolean not null default false,
  draft       boolean not null default true,
  steps       integer not null default 1,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (kind <> 'survey' or metric is not null),
  check (kind <> 'auto' or trigger is not null),
  check (kind = 'auto' or audience is not null)
);
create index campaigns_firm_idx on public.campaigns (firm_id, kind, active);
create index campaigns_folder_idx on public.campaigns (folder_id);

create table public.campaign_recipients (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms (id) on delete cascade,
  campaign_id  uuid not null references public.campaigns (id) on delete cascade,
  lead_id      uuid references public.leads (id) on delete set null,
  name         text not null,
  channel      text not null check (channel in ('Text', 'Email')),
  status       text not null check (status in ('delivered', 'held', 'skipped', 'failed', 'queued')),
  sent_at      timestamptz,
  opened       boolean not null default false,
  replied      boolean not null default false,
  -- Survey answer: 0 to 10 for NPS, 1 to 5 for CSAT.
  score        smallint check (score between 0 and 10),
  -- Resend's (or the texting provider's) id, to match delivery and open webhooks.
  provider_id  text
);
create index campaign_recipients_campaign_idx on public.campaign_recipients (campaign_id);
create index campaign_recipients_provider_idx on public.campaign_recipients (provider_id) where provider_id is not null;

create table public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms (id) on delete cascade,
  name        text not null,
  channel     text not null check (channel in ('Text', 'Email')),
  subject     text,
  body        text not null,
  tags        jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid() references auth.users (id) on delete set null
);
create index message_templates_firm_idx on public.message_templates (firm_id, updated_at desc);

-- Every email and text the portal sends or receives, with the provider's status.
create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms (id) on delete cascade,
  lead_id      uuid references public.leads (id) on delete set null,
  campaign_id  uuid references public.campaigns (id) on delete set null,
  channel      text not null check (channel in ('Text', 'Email')),
  direction    text not null default 'out' check (direction in ('out', 'in')),
  status       text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'opened', 'held', 'failed', 'received')),
  provider     text,
  provider_id  text,
  to_address   text not null,
  from_address text,
  subject      text,
  body         text not null,
  error        text,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid() references auth.users (id) on delete set null
);
create index messages_lead_idx on public.messages (lead_id, created_at desc);
create index messages_firm_idx on public.messages (firm_id, created_at desc);
create index messages_provider_idx on public.messages (provider_id) where provider_id is not null;

-- ---------- integrations ----------

-- Which integrations a firm has switched on, with non-secret settings. API keys never go here: they are kept as
-- Edge Function secrets (or in Supabase Vault).
create table public.integrations (
  firm_id       uuid not null references public.firms (id) on delete cascade,
  provider      text not null,
  enabled       boolean not null default false,
  settings      jsonb not null default '{}',
  connected_at  timestamptz,
  primary key (firm_id, provider)
);

-- ---------- updated_at ----------

create trigger services_touch before update on public.services for each row execute function public.touch_updated_at();
create trigger leads_touch before update on public.leads for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();
create trigger documents_touch before update on public.documents for each row execute function public.touch_updated_at();
create trigger campaigns_touch before update on public.campaigns for each row execute function public.touch_updated_at();
create trigger message_templates_touch before update on public.message_templates for each row execute function public.touch_updated_at();

-- ---------- row level security: a firm's members, and only they, can use its rows ----------

do $$
declare t text;
begin
  foreach t in array array[
    'services', 'leads', 'lead_services', 'lead_activities', 'engagement_packets', 'tasks', 'firm_events',
    'documents', 'campaign_folders', 'campaigns', 'campaign_recipients', 'message_templates', 'messages', 'integrations'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "firm members read" on public.%I for select to authenticated using (public.is_member(firm_id))', t);
    execute format('create policy "firm members add" on public.%I for insert to authenticated with check (public.is_member(firm_id))', t);
    execute format('create policy "firm members change" on public.%I for update to authenticated using (public.is_member(firm_id)) with check (public.is_member(firm_id))', t);
    execute format('create policy "firm members delete" on public.%I for delete to authenticated using (public.is_member(firm_id))', t);
  end loop;
end $$;

-- Messages are a record of what was sent: the portal can read them, only the server functions write them.
drop policy "firm members add" on public.messages;
drop policy "firm members change" on public.messages;
drop policy "firm members delete" on public.messages;
-- Integrations are switched on and off by admins.
drop policy "firm members add" on public.integrations;
drop policy "firm members change" on public.integrations;
drop policy "firm members delete" on public.integrations;
create policy "admins manage integrations" on public.integrations for all to authenticated using (public.is_admin(firm_id)) with check (public.is_admin(firm_id));

-- A lead's owner and a task's assignee must be in the same firm.
create or replace function public.check_member_ref() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if uid is not null and not exists (select 1 from public.firm_members m where m.firm_id = new.firm_id and m.user_id = uid) then
    raise exception 'That person is not in this firm';
  end if;
  return new;
end $$;
create trigger leads_owner_check before insert or update of owner_id, firm_id on public.leads for each row execute function public.check_member_ref('owner_id');
create trigger tasks_assignee_check before insert or update of assigned_to, firm_id on public.tasks for each row execute function public.check_member_ref('assigned_to');

-- Child rows must belong to the same firm as their parent (so nobody can attach rows to another firm's lead).
-- tg_argv: the parent table and the column on this row that points at it.
create or replace function public.check_same_firm() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  parent_id   uuid := (to_jsonb(new) ->> tg_argv[1])::uuid;
  parent_firm uuid;
begin
  if parent_id is null then return new; end if;
  execute format('select firm_id from public.%I where id = $1', tg_argv[0]) into parent_firm using parent_id;
  if parent_firm is distinct from new.firm_id then raise exception 'Belongs to a different firm'; end if;
  return new;
end $$;
create trigger lead_services_firm before insert or update on public.lead_services for each row execute function public.check_same_firm('leads', 'lead_id');
create trigger lead_activities_firm before insert or update on public.lead_activities for each row execute function public.check_same_firm('leads', 'lead_id');
create trigger engagement_packets_firm before insert or update on public.engagement_packets for each row execute function public.check_same_firm('leads', 'lead_id');
create trigger tasks_firm before insert or update on public.tasks for each row execute function public.check_same_firm('leads', 'lead_id');
create trigger messages_firm before insert or update on public.messages for each row execute function public.check_same_firm('leads', 'lead_id');
create trigger campaign_recipients_firm before insert or update on public.campaign_recipients for each row execute function public.check_same_firm('campaigns', 'campaign_id');
create trigger messages_campaign_firm before insert or update on public.messages for each row execute function public.check_same_firm('campaigns', 'campaign_id');
create trigger lead_services_service_firm before insert or update on public.lead_services for each row execute function public.check_same_firm('services', 'service_id');
create trigger campaigns_folder_firm before insert or update on public.campaigns for each row execute function public.check_same_firm('campaign_folders', 'folder_id');

-- ---------- file storage ----------

-- Private bucket for the document library. Files are stored under <firm_id>/..., and only that firm's members can
-- read or write them.
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;

create policy "firm members read files" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "firm members upload files" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "firm members replace files" on storage.objects for update to authenticated
  using (bucket_id = 'documents' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "firm members delete files" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.is_member(((storage.foldername(name))[1])::uuid));
