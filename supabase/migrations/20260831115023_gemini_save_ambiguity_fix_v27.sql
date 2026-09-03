drop function if exists public.save_gemini_api_key(smallint, text, text);

create function public.save_gemini_api_key(p_slot smallint, p_api_key text, p_label text default null)
returns table (out_slot smallint, out_status text, out_label text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_role text;
  v_clean_key text;
begin
  select p.store_id, p.role into v_store_id, v_role from public.profiles p where p.id = auth.uid();
  if v_store_id is null or v_role not in ('owner', 'manager') then
    raise exception 'Only the Owner/Manager can manage AI keys.' using errcode = '42501';
  end if;
  if p_slot is null or p_slot < 1 or p_slot > 10 then
    raise exception 'Invalid key slot (must be 1-10).' using errcode = '22023';
  end if;

  v_clean_key := nullif(trim(coalesce(p_api_key, '')), '');

  insert into public.gemini_api_keys (store_id, slot, api_key, label, status, cooldown_until, last_error)
  values (v_store_id, p_slot, v_clean_key, nullif(trim(coalesce(p_label, '')), ''),
          case when v_clean_key is null then 'unset' else 'active' end, null, null)
  on conflict (store_id, slot) do update
    set api_key = excluded.api_key,
        label = coalesce(excluded.label, public.gemini_api_keys.label),
        status = excluded.status,
        cooldown_until = null,
        last_error = null
  returning gemini_api_keys.slot, gemini_api_keys.status, gemini_api_keys.label into out_slot, out_status, out_label;

  return next;
end;
$$;

revoke all on function public.save_gemini_api_key(smallint, text, text) from public;
grant execute on function public.save_gemini_api_key(smallint, text, text) to authenticated;
revoke execute on function public.save_gemini_api_key(smallint, text, text) from anon;
