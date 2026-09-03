-- KYC photo capture (Improvement: SecondHandKycModal docPhoto/sellerPhoto).
-- Unlike product-photos, these are sensitive personal documents (ID proof /
-- Aadhaar photo, seller's face photo) tied to a buyback voucher — so this
-- bucket is PRIVATE. There is no public-read policy at all; the client must
-- request a short-lived signed URL (supabase.storage.from('kyc-photos')
-- .createSignedUrl(path, ttl)) to display one, and only a caller who is a
-- member of the owning store can even do that (see the select policy below).
--
-- Same path convention as product-photos: every object is stored as
-- "<store_id>/<anything>", so RLS can check the first path segment against
-- the caller's own store_id without a lookup table.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc-photos', 'kyc-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Read: NOT public. Only an authenticated member of the store that owns the
-- object can read it (needed both to create a signed URL server-side-style
-- via the client SDK, and for any direct select).
drop policy if exists "kyc_photos_store_read" on storage.objects;
create policy "kyc_photos_store_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'kyc-photos'
    and (storage.foldername(name))[1] = public.my_store_id()::text
  );

drop policy if exists "kyc_photos_store_write" on storage.objects;
create policy "kyc_photos_store_write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'kyc-photos'
    and (storage.foldername(name))[1] = public.my_store_id()::text
  );

drop policy if exists "kyc_photos_store_update" on storage.objects;
create policy "kyc_photos_store_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'kyc-photos'
    and (storage.foldername(name))[1] = public.my_store_id()::text
  );

drop policy if exists "kyc_photos_store_delete" on storage.objects;
create policy "kyc_photos_store_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'kyc-photos'
    and (storage.foldername(name))[1] = public.my_store_id()::text
  );
