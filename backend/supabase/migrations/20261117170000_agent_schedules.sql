-- Scheduled agents: an agent can run by itself on chosen days at a chosen time, and email what it finds to people in
-- the firm. Every run (scheduled or "Run now") is kept in bot_runs and written to the audit log.
-- A pg_cron job calls the run-agent function every 15 minutes; it runs whichever agents are due.

alter table public.bots
  add column schedule_enabled boolean not null default false,
  -- 0 = Sunday … 6 = Saturday
  add column schedule_days smallint[] not null default '{1,2,3,4,5}' check (schedule_days <@ array[0,1,2,3,4,5,6]::smallint[]),
  add column schedule_time time not null default '08:00',
  add column schedule_tz text not null default 'Africa/Johannesburg',
  -- Firm members who get the result by email (only members can be chosen, so agents can't email outsiders).
  add column deliver_to uuid[] not null default '{}',
  add column last_run_at timestamptz;

-- The time zone must be one Postgres knows, or the schedule could never be worked out (and a bad one would stop
-- every agent's schedule, since they're all checked together).
create or replace function private.check_schedule_tz() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.schedule_tz) then
    raise exception 'Unknown time zone %', new.schedule_tz;
  end if;
  return new;
end $$;
create trigger bots_schedule_tz before insert or update of schedule_tz on public.bots for each row execute function private.check_schedule_tz();

create table public.bot_runs (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references public.firms (id) on delete cascade,
  bot_id         uuid not null references public.bots (id) on delete cascade,
  at             timestamptz not null default now(),
  trigger        text not null check (trigger in ('schedule', 'manual')),
  run_by         uuid references auth.users (id) on delete set null,
  status         text not null check (status in ('done', 'failed')),
  output         text not null default '',
  -- Whom it was emailed to, and whether the email went out.
  recipients     text[] not null default '{}',
  email_status   text not null default 'none' check (email_status in ('none', 'sent', 'held', 'failed')),
  error          text,
  model          text,
  input_tokens   integer,
  output_tokens  integer
);
create index bot_runs_bot_idx on public.bot_runs (bot_id, at desc);

alter table public.bot_runs enable row level security;
-- The firm can read its agents' runs; only the run-agent function writes them.
create policy "firm members read runs" on public.bot_runs for select to authenticated using (private.is_member(firm_id));

-- Agents due now: switched on, scheduled for today in their time zone, past their time, and not yet run today.
-- Marks them as run in the same step (skipping any another runner already took), so no agent runs twice.
create or replace function public.claim_due_bots() returns setof public.bots
language sql security definer set search_path = '' as $$
  update public.bots b set last_run_at = now()
  where b.id in (
    select x.id from public.bots x
    where x.active and x.schedule_enabled
      and extract(dow from now() at time zone x.schedule_tz)::smallint = any (x.schedule_days)
      and (now() at time zone x.schedule_tz)::time >= x.schedule_time
      and (x.last_run_at is null or (x.last_run_at at time zone x.schedule_tz)::date < (now() at time zone x.schedule_tz)::date)
    for update skip locked
  )
  returning b.*
$$;
revoke all on function public.claim_due_bots() from public, anon, authenticated;

-- The shared secret the cron job sends, so only it can trigger scheduled runs. Kept in Vault, never in code.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'agent_runner_secret', 'Lets the cron job call the run-agent function')
where not exists (select 1 from vault.secrets where name = 'agent_runner_secret');

create or replace function public.check_runner_secret(t text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'agent_runner_secret' and decrypted_secret = t)
$$;
revoke all on function public.check_runner_secret(text) from public, anon, authenticated;
grant execute on function public.check_runner_secret(text) to service_role;

-- Every 15 minutes, ask the run-agent function to run whatever is due. Replace the project URL when deploying elsewhere.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('run-scheduled-agents', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://fzpzyftefquczmcydmzz.supabase.co/functions/v1/run-agent',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-runner-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'agent_runner_secret')),
    body := '{"scheduled": true}'::jsonb,
    timeout_milliseconds := 120000
  )
$cron$);

-- Runs are audited like everything else.
create trigger bot_runs_audit after insert or update or delete on public.bot_runs for each row execute function private.audit_row();
