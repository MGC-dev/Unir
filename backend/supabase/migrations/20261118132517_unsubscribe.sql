-- One-click unsubscribe for campaigns. Each lead has a private, unguessable token; campaign emails carry a link and
-- List-Unsubscribe headers with it. Using it marks the lead as opted out (campaigns and automatic messages then skip
-- them), notes it on the lead's timeline, and the change is in the audit log.

alter table public.leads add column unsubscribe_token uuid not null default gen_random_uuid();
create unique index leads_unsubscribe_token_idx on public.leads (unsubscribe_token);

-- What the unsubscribe page shows before the person confirms: only the firm's name, never the lead's details.
create or replace function public.unsubscribe_info(t uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('firm', f.name, 'done', l.opted_out)
  from public.leads l join public.firms f on f.id = l.firm_id
  where l.unsubscribe_token = t
$$;

-- Opts the lead out. Safe to call twice. Returns the firm's name, or null for an unknown token.
create or replace function public.unsubscribe_by_token(t uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.leads%rowtype; firm_name text;
begin
  select * into l from public.leads where unsubscribe_token = t;
  if l.id is null then return null; end if;
  select name into firm_name from public.firms where id = l.firm_id;
  if not l.opted_out then
    update public.leads set opted_out = true where id = l.id;
    insert into public.lead_activities (firm_id, lead_id, type, cls, title, text, created_by)
    values (l.firm_id, l.id, 'stage', 'bad', 'Unsubscribed', 'Used the unsubscribe link in an email. No more campaign or automatic messages.', null);
  end if;
  return jsonb_build_object('firm', firm_name, 'done', true);
end $$;

-- Anyone holding a link may use it (that is the point of the link); the token is the only key.
revoke all on function public.unsubscribe_info(uuid), public.unsubscribe_by_token(uuid) from public;
grant execute on function public.unsubscribe_info(uuid), public.unsubscribe_by_token(uuid) to anon, authenticated, service_role;
