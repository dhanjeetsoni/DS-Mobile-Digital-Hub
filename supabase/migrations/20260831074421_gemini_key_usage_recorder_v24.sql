-- Step 2.1 (Gemini 10-key auto-rotation pool): server-side usage/status
-- recorder. server.ts (holding the service-role key, never shipped to any
-- client) reads raw key values directly from gemini_api_keys (service role
-- bypasses RLS; the table has zero policies so it is otherwise unreachable).
-- After each Gemini attempt it calls this function to persist the outcome:
-- success -> bump today's usage counter + last_used_at, failure -> mark the
-- key exhausted (with a cooldown until next-day IST reset) or invalid, so
-- Step 2.2's status widget (get_gemini_key_status) reflects reality and the
-- pool skips a bad key on the next request without re-trying it every time.
--
-- Callable by: (a) the service-role connection used by server.ts, where
-- auth.uid() is null -- allowed unconditionally, since only server-side code
-- ever holds the service-role key; (b) a logged-in owner/manager of the
-- store in question, in case a future in-app diagnostic ever needs to call
-- it directly. No one else (anon, other stores' staff) can reach it: the
-- EXECUTE grant excludes anon, and the ownership check blocks cross-store
-- calls for real (non-service-role) sessions.
create or replace function public.record_gemini_key_usage(
  p_store_id uuid,
  p_slot smallint,
  p_success boolean,
  p_status text,
  p_cooldown_until timestamptz,
  p_error text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is not null then
    select role into v_role from public.profiles where id = v_uid and store_id = p_store_id;
    if v_role is null or v_role not in ('owner', 'manager') then
      raise exception 'Not authorized to update AI key status.' using errcode = '42501';
    end if;
  end if;

  if p_status not in ('active', 'exhausted', 'invalid') then
    raise exception 'Invalid status value.' using errcode = '22023';
  end if;

  update public.gemini_api_keys
  set
    status = p_status,
    cooldown_until = p_cooldown_until,
    last_error = nullif(trim(coalesce(p_error, '')), ''),
    last_used_at = case when p_success then now() else last_used_at end,
    usage_count_today = case
      when p_success and usage_date = current_date then usage_count_today + 1
      when p_success then 1
      else usage_count_today
    end,
    usage_date = case when p_success then current_date else usage_date end,
    updated_at = now()
  where store_id = p_store_id and slot = p_slot;
end;
$$;

revoke all on function public.record_gemini_key_usage(uuid, smallint, boolean, text, timestamptz, text) from public;
grant execute on function public.record_gemini_key_usage(uuid, smallint, boolean, text, timestamptz, text) to authenticated, service_role;
