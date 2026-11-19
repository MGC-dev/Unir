-- The firm's team with each person's email and invite status, for the Team list.
-- An invite is accepted once the person opens the link in their invite email (Supabase then confirms their email).
-- People added with an account they already had count as accepted. Only the firm's own members can see it.
create or replace function public.firm_member_status(f uuid)
returns table (user_id uuid, email text, invited_at timestamptz, accepted boolean)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, u.invited_at, u.email_confirmed_at is not null
  from public.firm_members m
  join auth.users u on u.id = m.user_id
  where m.firm_id = f and private.is_member(f)
$$;
revoke all on function public.firm_member_status(uuid) from public, anon;
grant execute on function public.firm_member_status(uuid) to authenticated;
