create or replace function public.record_gemini_key_usage(
  p_store_id uuid,
  p_slot smallint,
  p_success boolean,
  p_status text,
  p_cooldown_until timestamptz,
  p_error text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if auth.role() is distinct from 'service_role' then
    if v_uid is null then
      raise exception 'Not authorized to update AI key status.' using errcode = '42501';
    end if;
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
$function$;
