-- Step 7.3 — Storage Usage Meter (Owner-only Status Dashboard piece, see
-- DS_Mobile_Master_Plan.md STEP 7.3). This migration adds the Supabase-side
-- half: a single RPC that reports how many bytes of "text data" the calling
-- Owner/Manager's store is currently using across the Supabase project.
--
-- Cloudflare's half (R2 bucket usage for the same store) is reported by the
-- existing r2-storage Edge Function's new GET /usage/<storeId> route — see
-- supabase/functions/r2-storage/index.ts.
--
-- Design: rather than hard-coding a list of store-scoped tables (which would
-- silently go stale every time a future step adds a new table), this walks
-- information_schema for every public.* base table that has a store_id
-- column and sums pg_column_size(row) for that store's rows. store_state
-- (the main app-state JSON blob) is reported separately too, since it's
-- usually the single biggest contributor and Owners will want to see it
-- called out on its own.
--
-- pg_column_size is an approximation (actual on-disk/WAL/index overhead is
-- higher) but that's fine for a usage *meter* — it's meant to warn well
-- before a real limit is hit, not to be a billing-grade byte count.

create or replace function public.get_storage_usage_summary()
returns table (
  total_bytes bigint,
  store_state_bytes bigint,
  other_tables_bytes bigint,
  table_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_role text;
  v_state_bytes bigint := 0;
  v_other_bytes bigint := 0;
  v_table_count int := 0;
  r record;
  v_sql text;
  v_sum bigint;
begin
  select p.store_id, p.role into v_store_id, v_role from public.profiles p where p.id = auth.uid();
  if v_store_id is null or v_role not in ('owner', 'manager') then
    raise exception 'Only the Owner/Manager can view storage usage.' using errcode = '42501';
  end if;

  select coalesce(pg_column_size(s.state), 0) into v_state_bytes
  from public.store_state s where s.store_id = v_store_id;
  v_state_bytes := coalesce(v_state_bytes, 0);

  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'store_id'
      and t.table_type = 'BASE TABLE'
      and c.table_name <> 'store_state'
  loop
    v_sql := format('select coalesce(sum(pg_column_size(t.*)), 0) from public.%I t where t.store_id = $1', r.table_name);
    execute v_sql into v_sum using v_store_id;
    v_other_bytes := v_other_bytes + coalesce(v_sum, 0);
    v_table_count := v_table_count + 1;
  end loop;

  return query select (v_state_bytes + v_other_bytes), v_state_bytes, v_other_bytes, v_table_count;
end;
$$;

revoke all on function public.get_storage_usage_summary() from public;
grant execute on function public.get_storage_usage_summary() to authenticated;
