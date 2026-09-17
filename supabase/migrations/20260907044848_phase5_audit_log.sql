-- Phase 5 (Operational features): "Audit log (who added/edited/deleted
-- what, and when)". The `audit_logs` table has existed since the very
-- first base schema migration but nothing has ever written to it or read
-- from it — confirmed by grepping the whole frontend for "audit_logs"
-- (zero matches) and by its live row count (0). This migration makes it
-- actually work, via triggers on the tables that matter most for a shop
-- owner reviewing "what happened" (products, sales, and the
-- security-sensitive parts of staff profiles), rather than relying on
-- every UI call site remembering to log an action by hand — a trigger
-- can't be silently skipped by a future code path the way a manual log
-- call can.

-- ---------------------------------------------------------------------
-- Generic trigger: logs INSERT/UPDATE/DELETE on products and sales.
-- Excludes the `photo` column from the logged snapshot (can be a large
-- base64 string — would bloat audit_logs for no real audit value; the
-- product row's own current photo is always visible in the app itself).
-- ---------------------------------------------------------------------
create or replace function public.log_table_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_store_id uuid;
  v_old jsonb;
  v_new jsonb;
begin
  v_store_id := coalesce(
    case when TG_OP = 'DELETE' then (to_jsonb(old)->>'store_id')::uuid else (to_jsonb(new)->>'store_id')::uuid end,
    case when TG_OP = 'DELETE' then (to_jsonb(old)->>'store_id')::uuid else (to_jsonb(new)->>'store_id')::uuid end
  );

  if TG_OP in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old) - 'photo';
  end if;
  if TG_OP in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new) - 'photo';
  end if;

  insert into public.audit_logs (store_id, user_id, action, details)
  values (
    v_store_id,
    auth.uid(),
    TG_TABLE_NAME || '_' || lower(TG_OP),
    jsonb_build_object('old', v_old, 'new', v_new)
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists products_audit on public.products;
create trigger products_audit
  after insert or update or delete on public.products
  for each row execute function public.log_table_audit();

drop trigger if exists sales_audit on public.sales;
create trigger sales_audit
  after insert or update or delete on public.sales
  for each row execute function public.log_table_audit();

-- ---------------------------------------------------------------------
-- Profiles: only log the security-sensitive fields actually changing
-- (role, access on/off, access mode/expiry) — NOT every touch_last_active
-- heartbeat, which would otherwise flood the log with noise on every
-- single staff sign-in with zero audit value.
-- ---------------------------------------------------------------------
create or replace function public.log_profile_access_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.role is distinct from old.role)
     or (new.access_enabled is distinct from old.access_enabled)
     or (new.access_mode is distinct from old.access_mode)
     or (new.access_expires_at is distinct from old.access_expires_at) then
    insert into public.audit_logs (store_id, user_id, action, details)
    values (
      new.store_id,
      auth.uid(),
      'profile_access_update',
      jsonb_build_object(
        'target_profile_id', new.id,
        'target_name', coalesce(new.staff_name, new.full_name),
        'old', jsonb_build_object('role', old.role, 'access_enabled', old.access_enabled, 'access_mode', old.access_mode, 'access_expires_at', old.access_expires_at),
        'new', jsonb_build_object('role', new.role, 'access_enabled', new.access_enabled, 'access_mode', new.access_mode, 'access_expires_at', new.access_expires_at)
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_access_audit on public.profiles;
create trigger profiles_access_audit
  after update on public.profiles
  for each row execute function public.log_profile_access_audit();

-- ---------------------------------------------------------------------
-- Read access: owner/manager only, own store only. Staff never sees the
-- audit log (per the same "staff sees selling prices only" boundary used
-- everywhere else in this app).
-- ---------------------------------------------------------------------
create policy audit_logs_owner_manager_select on public.audit_logs
  for select
  using (
    store_id = public.current_profile_store_id()
    and public.current_profile_role() in ('owner', 'manager')
  );
