-- Carries out a change an agent proposed, once a person has approved it in chat. Runs in one transaction that
-- marks the audit log entries as the agent's (with the approving person as actor_id). Called only by the
-- chat-action function with the service role, after it has checked the person, the firm and the agent's permissions.

create or replace function public.run_agent_action(p_firm uuid, p_user uuid, p_bot uuid, p_kind text, p_params jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l public.leads%rowtype;
  new_id uuid;
  owner uuid;
begin
  if not exists (select 1 from public.firm_members where firm_id = p_firm and user_id = p_user) then
    raise exception 'The approving person is not in this firm';
  end if;
  if p_bot is not null and not exists (select 1 from public.bots where id = p_bot and firm_id = p_firm and active and p_kind = any (actions)) then
    raise exception 'This agent is not allowed to %', p_kind;
  end if;

  perform set_config('app.actor_type', case when p_bot is null then 'user' else 'agent' end, true);
  perform set_config('app.actor_id', p_user::text, true);
  perform set_config('app.bot_id', coalesce(p_bot::text, ''), true);

  -- The lead the action is about, when it names one (by id, or by name within the firm).
  if p_params ? 'lead_id' or p_params ? 'lead_name' then
    select * into l from public.leads
    where firm_id = p_firm and (id::text = p_params ->> 'lead_id' or lower(name) = lower(p_params ->> 'lead_name'))
    order by created_at desc limit 1;
    if l.id is null then raise exception 'No lead called %', coalesce(p_params ->> 'lead_name', p_params ->> 'lead_id'); end if;
  end if;

  case p_kind
    when 'create_lead' then
      insert into public.leads (firm_id, name, phone, email, matter, practice, source, owner_id, notes)
      values (p_firm, p_params ->> 'name', coalesce(p_params ->> 'phone', ''), coalesce(p_params ->> 'email', ''),
              coalesce(p_params ->> 'matter', ''), coalesce(p_params ->> 'practice', ''), 'manual', p_user, coalesce(p_params ->> 'notes', ''))
      returning id into new_id;
      insert into public.lead_activities (firm_id, lead_id, type, cls, title, text, created_by)
      values (p_firm, new_id, 'enquiry', 'auto', 'Enquiry added by an agent', 'Approved in chat.', p_user);
      return jsonb_build_object('lead_id', new_id, 'result', 'Created ' || (p_params ->> 'name'));

    when 'move_stage' then
      if l.id is null then raise exception 'Say which lead to move'; end if;
      update public.leads set stage = p_params ->> 'stage', lost_reason = case when p_params ->> 'stage' = 'lost' then coalesce(p_params ->> 'reason', lost_reason) end
      where id = l.id;
      insert into public.lead_activities (firm_id, lead_id, type, cls, title, created_by)
      values (p_firm, l.id, case when p_params ->> 'stage' = 'lost' then 'lost' else 'stage' end, '', 'Moved to ' || (p_params ->> 'stage') || ' by an agent', p_user);
      return jsonb_build_object('lead_id', l.id, 'result', l.name || ' moved to ' || (p_params ->> 'stage'));

    when 'book_task' then
      owner := coalesce(l.owner_id, p_user);
      insert into public.tasks (firm_id, type, title, due_at, assigned_to, lead_id, notes)
      values (p_firm, coalesce(p_params ->> 'type', 'task'), p_params ->> 'title', (p_params ->> 'due_at')::timestamptz, owner, l.id, coalesce(p_params ->> 'notes', ''))
      returning id into new_id;
      return jsonb_build_object('task_id', new_id, 'result', 'Booked ' || (p_params ->> 'title'));

    when 'set_services' then
      if l.id is null then raise exception 'Say which lead the services are for'; end if;
      delete from public.lead_services where lead_id = l.id;
      insert into public.lead_services (lead_id, service_id, firm_id)
      select l.id, s.id, p_firm from public.services s
      where s.firm_id = p_firm and s.id::text in (select jsonb_array_elements_text(p_params -> 'service_ids'));
      update public.leads set value = (select coalesce(sum(s.price), 0) from public.lead_services ls join public.services s on s.id = ls.service_id where ls.lead_id = l.id)
      where id = l.id;
      return jsonb_build_object('lead_id', l.id, 'result', 'Services set for ' || l.name);

    else
      raise exception 'Unknown action %', p_kind;
  end case;
end $$;

revoke all on function public.run_agent_action(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- Counts an agent's runs (used by the chat function).
create or replace function public.bump_bot_runs(p_bot uuid) returns void
language sql security definer set search_path = '' as $$ update public.bots set runs = runs + 1 where id = p_bot $$;
revoke all on function public.bump_bot_runs(uuid) from public, anon, authenticated;
