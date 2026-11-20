-- Scheduled agent reports can be attached to the email as a PDF, and a "Run now" earlier in the day no longer
-- cancels that day's scheduled run.

alter table public.bots add column deliver_pdf boolean not null default false;

-- Agents due now: switched on, scheduled for today in their time zone, past their time, and not yet run since
-- today's scheduled time (a "Run now" before it doesn't count). Marks them as run in the same step, skipping any
-- another runner already took, so no agent runs twice.
create or replace function public.claim_due_bots() returns setof public.bots
language sql security definer set search_path = '' as $$
  update public.bots b set last_run_at = now()
  where b.id in (
    select x.id from public.bots x
    where x.active and x.schedule_enabled
      and extract(dow from now() at time zone x.schedule_tz)::smallint = any (x.schedule_days)
      and (now() at time zone x.schedule_tz)::time >= x.schedule_time
      and (x.last_run_at is null
        or (x.last_run_at at time zone x.schedule_tz) < (now() at time zone x.schedule_tz)::date + x.schedule_time)
    for update skip locked
  )
  returning b.*
$$;
revoke all on function public.claim_due_bots() from public, anon, authenticated;
