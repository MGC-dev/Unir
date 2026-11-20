-- Gmail (Google OAuth): the tokens a firm's connected Google account gave the portal. Tokens are secrets, so this
-- table has row level security on and no policies: only the Edge Functions (service role) can read or write it.
-- The firm sees whether Gmail is connected, and which address, through public.integrations (provider 'gmail').

create table public.google_connections (
  firm_id        uuid not null references public.firms (id) on delete cascade,
  provider       text not null default 'gmail' check (provider in ('gmail')),
  email          text not null,
  refresh_token  text not null,
  access_token   text,
  expires_at     timestamptz,
  scopes         text[] not null default '{}',
  connected_by   uuid references auth.users (id) on delete set null,
  connected_at   timestamptz not null default now(),
  primary key (firm_id, provider)
);

alter table public.google_connections enable row level security;
revoke all on public.google_connections from anon, authenticated;
