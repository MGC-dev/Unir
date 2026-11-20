-- Google Calendar: each person connects their own Google account so their events show in the portal's Calendar
-- (read-only). Tokens are secrets, so this table has row level security on and no policies: only the Edge Functions
-- (service role) read or write it. People ask the google-oauth function whether they are connected.

create table public.google_calendar_connections (
  firm_id        uuid not null references public.firms (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  email          text not null,
  refresh_token  text not null,
  access_token   text,
  expires_at     timestamptz,
  scopes         text[] not null default '{}',
  connected_at   timestamptz not null default now(),
  primary key (firm_id, user_id)
);

alter table public.google_calendar_connections enable row level security;
revoke all on public.google_calendar_connections from anon, authenticated;
