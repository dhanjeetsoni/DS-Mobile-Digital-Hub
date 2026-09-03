create or replace function public.get_gemini_key_status()
returns table (
  slot smallint,
  has_key boolean,
  status text,
  label text,
  cooldown_until timestamptz,
  last_used_at timestamptz,
  usage_count_today integer,
  last_error text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_role text;
begin
  select p.store_id, p.role into v_store_id, v_role from public.profiles p where p.id = auth.uid();
  if v_store_id is null or v_role not in ('owner', 'manager') then
    raise exception 'Only the Owner/Manager can view AI key status.' using errcode = '42501';
  end if;

  return query
  select
    s.slot::smallint,
    (k.api_key is not null) as has_key,
    coalesce(k.status, 'unset') as status,
    k.label,
    k.cooldown_until,
    k.last_used_at,
    case when k.usage_date = current_date then coalesce(k.usage_count_today, 0) else 0 end as usage_count_today,
    k.last_error
  from generate_series(1, 10) as s(slot)
  left join public.gemini_api_keys k on k.store_id = v_store_id and k.slot = s.slot::smallint
  order by s.slot;
end;
$$;

revoke all on function public.get_gemini_key_status() from public;
grant execute on function public.get_gemini_key_status() to authenticated;
revoke execute on function public.get_gemini_key_status() from anon;
