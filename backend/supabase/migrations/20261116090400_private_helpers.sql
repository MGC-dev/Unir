-- Moves the internal helpers out of the API. Functions in "public" can be called through /rest/v1/rpc; these are only
-- for policies and triggers, so they live in a private schema the API doesn't expose. Policies and triggers keep
-- working because they point at the functions themselves, not their names.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
-- Leftovers from the first draft schema (its tables were dropped in replace_initial_schema).
drop function if exists private.can_edit(uuid), private.is_admin(uuid), private.is_member(uuid), private.lead_history(), private.lead_stage_guard();

alter function public.is_member(uuid) set schema private;
alter function public.is_admin(uuid) set schema private;
alter function public.my_firm_ids() set schema private;
alter function public.touch_updated_at() set schema private;
alter function public.audit_row() set schema private;
alter function public.check_member_ref() set schema private;
alter function public.check_same_firm() set schema private;

-- Policies run these as the signed-in person, so they need to be callable by authenticated (not by anon).
revoke all on function private.is_member(uuid), private.is_admin(uuid), private.my_firm_ids() from public, anon;
grant execute on function private.is_member(uuid), private.is_admin(uuid), private.my_firm_ids() to authenticated, service_role;
-- Trigger functions are never called directly.
revoke all on function private.touch_updated_at(), private.audit_row(), private.check_member_ref(), private.check_same_firm() from public, anon, authenticated;

-- The one helper meant to be called from the portal: a person editing their own name and title.
revoke all on function public.update_my_profile(uuid, text, text) from public, anon;
grant execute on function public.update_my_profile(uuid, text, text) to authenticated;
