-- Architecture improvement #1: product photos currently live as compressed
-- base64 JPEG strings inside the store_state JSON blob (Product.photo).
-- Result: changing ONE product's stock count re-syncs the ENTIRE blob,
-- including every photo of every product, on every save. On slow mobile
-- data this is the single biggest cause of slow/failed sync.
--
-- Fix: a dedicated Supabase Storage bucket. The client now uploads the
-- compressed JPEG there and stores only a short public URL string in
-- Product.photo (same field, same type — no schema change needed on the
-- JSON side, no other screen that reads product.photo needs to change).
--
-- Path convention enforced by the RLS policies below: every object must be
-- stored as "<store_id>/<anything>", so a policy can check the first path
-- segment against the caller's own store_id without a lookup table.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read (photos are shown in-app to owner AND staff, and the bucket
-- being "public" just means anyone with the exact URL can view — nothing
-- listable, no directory browsing, and no sensitive data belongs in a
-- product photo). This is what makes the URL usable directly in <img src>
-- with no signed-URL round trip needed.
drop policy if exists "product_photos_public_read" on storage.objects;
create policy "product_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'product-photos');

-- Writes (insert/update/delete) restricted to signed-in users whose own
-- store_id matches the first path segment of the object key, and who are
-- owner/manager/staff of that store (any active store member — product
-- photos are a normal catalog edit, same permission level as editing a
-- product itself already requires client-side).
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
