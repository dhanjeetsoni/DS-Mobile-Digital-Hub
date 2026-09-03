-- Local warranty_claims.id is a device-local id (uid("wcl")), not the
-- server row's uuid — same "local stays authoritative, ids don't reconcile"
-- philosophy as returns/exchanges (see record_return returning return_no,
-- not a uuid, for the same reason). So status updates need a lookup key
-- that's identical on both sides: claim_no, which the client generates
-- once (WCL-0001, ...) and sends to record_warranty_claim as-is.
create or replace function public.update_warranty_claim_status_by_no(
  p_store_id uuid,
  p_claim_no text,
  p_status text,
  p_resolution text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text;
  v_id uuid;
begin
  select role into v_role from public.profiles where id = auth.uid() and store_id = p_store_id;
  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'not authorized';
  end if;
  if p_status not in ('Open','In Progress','Resolved','Rejected') then
    raise exception 'invalid status';
  end if;

  update public.warranty_claims
    set status = p_status,
        resolution = coalesce(p_resolution, resolution),
        resolved_at = case when p_status in ('Resolved','Rejected') then now() else resolved_at end
    where store_id = p_store_id and claim_no = p_claim_no
    returning id into v_id;

  return v_id;
end;
$function$;

revoke execute on function public.update_warranty_claim_status_by_no(uuid,text,text,text) from anon;
