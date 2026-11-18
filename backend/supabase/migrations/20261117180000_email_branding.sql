-- Each firm's email design: a logo, a brand colour, a signature and a footer (usually the firm's address). Every email
-- the firm sends (campaigns, one-to-one emails, agent reports) is wrapped in this design by the server functions.

alter table public.firms
  add column email_logo_url text check (email_logo_url is null or email_logo_url ~ '^https://'),
  add column email_brand_color text not null default '#0f2347' check (email_brand_color ~ '^#[0-9a-fA-F]{6}$'),
  add column email_signature text not null default '',
  add column email_footer text not null default '';

-- Logos have to load in anyone's inbox, so they live in a public bucket. Only a firm's admins can put files in their
-- firm's folder (<firm id>/...), and only images up to 1 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 1048576, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

create policy "admins upload branding" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and private.is_admin(((storage.foldername(name))[1])::uuid));
create policy "admins replace branding" on storage.objects for update to authenticated
  using (bucket_id = 'branding' and private.is_admin(((storage.foldername(name))[1])::uuid));
create policy "admins delete branding" on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and private.is_admin(((storage.foldername(name))[1])::uuid));
