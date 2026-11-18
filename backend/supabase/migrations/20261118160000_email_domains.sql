-- Email domain setup from Settings. A firm admin types their domain; the `email-domain` function adds it to MGC's
-- Resend account, stores the DNS records to show, and keeps the status in step (on "Check now", and automatically
-- when Resend's webhook reports the domain verified).

alter table public.firms
  add column resend_domain_id text unique,
  add column domain_records jsonb not null default '[]'::jsonb,
  add column domain_checked_at timestamptz;

-- One firm per domain: nobody can claim another firm's domain and send as them.
create unique index firms_domain_lower_idx on public.firms (lower(domain)) where domain is not null;

-- The sending setup (domain, its status and records, texting status) changes only through the server, so a firm
-- can't mark itself verified, and a stale browser tab can't undo a verification when it saves the firm's branding.
create or replace function private.guard_firm_sending() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce((select auth.role()), '') = 'authenticated' and (
       new.domain is distinct from old.domain or new.domain_status is distinct from old.domain_status
    or new.resend_domain_id is distinct from old.resend_domain_id or new.domain_records is distinct from old.domain_records
    or new.domain_checked_at is distinct from old.domain_checked_at or new.text_status is distinct from old.text_status
    or new.phone_number is distinct from old.phone_number or new.addons is distinct from old.addons) then
    raise exception 'The email domain, texting and add-ons are set up through Settings, not edited directly'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists firms_guard_sending on public.firms;
create trigger firms_guard_sending before update on public.firms
  for each row execute function private.guard_firm_sending();
