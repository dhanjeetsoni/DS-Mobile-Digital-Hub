create function ds_recovery.merge_staff_xerox_receipts(p_store uuid,p_old jsonb,p_incoming jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;e jsonb;v_id text;qty numeric;rate numeric;amount numeric;
begin
 result:=case when jsonb_typeof(p_old)='array' then p_old else '[]'::jsonb end;
 if jsonb_typeof(p_incoming) is distinct from 'array' then return result;end if;
 for e in select x from jsonb_array_elements(p_incoming) x loop
 v_id:=e->>'id';
 if v_id is null or length(v_id) not between 1 and 150 then raise exception 'invalid cybercafe receipt identifier';end if;
 -- Retain canonical existing entries, including hidden history and owner-only cost.
 if exists(select 1 from jsonb_array_elements(result) x where x->>'id'=v_id) then continue;end if;
 -- A previously billed, owner-removed receipt must not be resurrected by stale staff data.
 if exists(select 1 from public.telegram_outbox o where o.store_id=p_store and o.bill_source_key='xerox:'||v_id) then continue;end if;
 if jsonb_typeof(e->'copies') is distinct from 'number' or jsonb_typeof(e->'ratePerUnit') is distinct from 'number' or jsonb_typeof(e->'totalAmount') is distinct from 'number' then raise exception 'invalid cybercafe receipt amounts';end if;
 qty:=(e->>'copies')::numeric;rate:=(e->>'ratePerUnit')::numeric;amount:=(e->>'totalAmount')::numeric;
 if qty<=0 or qty<>trunc(qty) or rate<=0 or amount<=0 or amount>1000000000 or round(qty*rate,2)<>round(amount,2) or coalesce(e->>'paymentMethod','') not in ('Cash','UPI') then raise exception 'invalid cybercafe receipt amounts';end if;
 result:=result||jsonb_build_array(e);
 end loop;
 return result;
end $$;
revoke all on function ds_recovery.merge_staff_xerox_receipts(uuid,jsonb,jsonb) from public,anon,authenticated;
do $patch$
declare f text;a text;
begin
 f:=pg_get_functiondef('public.save_store_state_for_user(jsonb,bigint)'::regprocedure);
 a:='v_state:=ds_recovery.preserve_hidden_history(v_current,v_state,(SELECT visibility_from FROM public.profiles WHERE id=auth.uid()));';
 if position(a in f)=0 then raise exception 'staff state guard anchor missing';end if;
 -- Apply after visibility filtering to preserve staff transactions created just before
 -- a new visibility window, rather than treating a missing record as deletion.
 execute replace(f,a,a||'
 v_state:=jsonb_set(v_state,''{xeroxEntries}'',ds_recovery.merge_staff_xerox_receipts(v_store,v_current->''xeroxEntries'',v_state->''xeroxEntries''),true);');
end $patch$;
