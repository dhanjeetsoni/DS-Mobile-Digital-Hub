-- KYC photo capture (SecondHandKycModal docPhoto/sellerPhoto). Unlike
-- product-photos, these are sensitive personal documents (ID proof /
-- Aadhaar photo, seller's face photo) tied to a buyback voucher — so this
-- bucket is PRIVATE. No public-read policy; client requests a short-lived
-- signed URL to display one, and only a member of the owning store can.
-- Same path convention as product-photos: "<store_id>/<anything>".

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc-photos', 'kyc-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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
