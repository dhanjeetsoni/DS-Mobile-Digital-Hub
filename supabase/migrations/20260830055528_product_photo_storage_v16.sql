insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product_photos_public_read" on storage.objects;
create policy "product_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'product-photos');

drop policy if exists "product_photos_store_write" on storage.objects;
create policy "product_photos_store_write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = public.my_store_id()::text
  );

drop policy if exists "product_photos_store_update" on storage.objects;
create policy "product_photos_store_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = public.my_store_id()::text
  );

drop policy if exists "product_photos_store_delete" on storage.objects;
create policy "product_photos_store_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-photos'
    and (storage.foldername(name))[1] = public.my_store_id()::text
  );
