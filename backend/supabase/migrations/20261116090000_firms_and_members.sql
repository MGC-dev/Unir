-- Firms and the people who work in them.
--
-- Every client firm lives in the same database. Each row of firm data carries a firm_id, and row level security
-- only lets a signed-in person see and change rows of the firms they belong to. MGC onboards firms with
-- public.onboard_firm() (service role only); a firm's admins then invite their own team with the invite-member function.

create extension if not exists pgcrypto with schema extensions;

-- ---------- helpers ----------

-- Keeps updated_at current on every update.
create or replace function public.touch_updated_at() returns trigger set search_path = ''
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- firms ----------

create table public.firms (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) > 0),
  -- Email is sent from intake@<domain> once the domain is verified with Resend.
  domain          text,
  domain_status   text not null default 'unverified' check (domain_status in ('unverified', 'pending', 'verified')),
  -- The firm's texting number, once registered with carriers.
  phone_number    text,
  text_status     text not null default 'unregistered' check (text_status in ('unregistered', 'review', 'registered')),
  practice_areas  text[] not null default array['Family law', 'Personal injury', 'Immigration', 'Estate planning', 'Employment', 'Criminal defense', 'Business law', 'Real estate'],
  -- Add-ons the firm pays for (e.g. 'chat', 'agents'), so features can be switched on per firm.
  addons          text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger firms_touch before update on public.firms for each row execute function public.touch_updated_at();

-- ---------- members ----------

create table public.firm_members (
  firm_id     uuid not null references public.firms (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'member' check (role in ('admin', 'member')),
  full_name   text not null default '',
  title       text not null default '',
  created_at  timestamptz not null default now(),
  primary key (firm_id, user_id)
);
create index firm_members_user_idx on public.firm_members (user_id);

-- Is the signed-in person a member (or an admin) of this firm? security definer so policies on firm_members
-- itself don't recurse; search_path is pinned so it can't be hijacked.
create or replace function public.is_member(f uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.firm_members m where m.firm_id = f and m.user_id = auth.uid())
$$;
create or replace function public.is_admin(f uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.firm_members m where m.firm_id = f and m.user_id = auth.uid() and m.role = 'admin')
$$;
-- The firms the signed-in person belongs to (most people belong to exactly one).
create or replace function public.my_firm_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.firm_id from public.firm_members m where m.user_id = auth.uid()
$$;

alter table public.firms enable row level security;
alter table public.firm_members enable row level security;

create policy "members read their firm" on public.firms for select to authenticated using (public.is_member(id));
create policy "admins update their firm" on public.firms for update to authenticated using (public.is_admin(id)) with check (public.is_admin(id));
-- Firms are created and deleted by MGC (service role), never from the portal.

create policy "members see their team" on public.firm_members for select to authenticated using (public.is_member(firm_id));
create policy "admins change their team" on public.firm_members for update to authenticated using (public.is_admin(firm_id)) with check (public.is_admin(firm_id));
create policy "admins remove teammates" on public.firm_members for delete to authenticated using (public.is_admin(firm_id) and user_id <> auth.uid());
-- New members are added by the invite-member function (service role), which checks the inviter is an admin.

-- Everyone may edit their own name and title (not their role).
create or replace function public.update_my_profile(f uuid, new_name text, new_title text) returns void
language sql security definer set search_path = '' as $$
  update public.firm_members set full_name = coalesce(new_name, full_name), title = coalesce(new_title, title)
  where firm_id = f and user_id = auth.uid()
$$;

-- ---------- onboarding (MGC only) ----------

-- Creates a firm and makes an existing account its first admin. Run by MGC with the service role, e.g. from the
-- SQL editor after inviting the person from Authentication → Users:
--   select public.onboard_firm('Example Family Law LLP', 'sarah@examplelaw.com', 'Sarah Mitchell');
create or replace function public.onboard_firm(firm_name text, admin_email text, admin_name text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
  fid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(admin_email));
  if uid is null then
    raise exception 'No account for %. Invite them first (Authentication → Users → Invite).', admin_email;
  end if;
  insert into public.firms (name) values (trim(firm_name)) returning id into fid;
  insert into public.firm_members (firm_id, user_id, role, full_name) values (fid, uid, 'admin', coalesce(admin_name, ''));
  return fid;
end $$;
revoke all on function public.onboard_firm(text, text, text) from public, anon, authenticated;

-- Finds an existing account by email (for invites). Service role only.
create or replace function public.user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1
$$;
revoke all on function public.user_id_by_email(text) from public, anon, authenticated;
