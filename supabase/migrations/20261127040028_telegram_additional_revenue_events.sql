-- Additional paid/recorded service events, without manufacturing a second sale.
create function public.enqueue_other_service_bills() returns trigger language plpgsql security definer set search_path='' as $$
declare e jsonb;old_arr jsonb;new_arr jsonb;k text;v_id text;v_key text;v_ref text;v_kind text;v_name text;v_date text;v_amount numeric;v_payment text;v_chat text;v_actor text;v_payload jsonb;previous jsonb;
begin
 if auth.uid() is null or not public.current_account_allowed() then return new;end if;
 select coalesce(nullif(p.staff_name,''),nullif(p.full_name,''),p.role) into v_actor from public.profiles p where p.id=auth.uid() and p.store_id=new.store_id;
 if v_actor is null then return new;end if;
 v_chat:=coalesce(public.owner_bill_chat(new.store_id),'');
 foreach k in array array['extraIncome','simActivations','jobs'] loop
 new_arr:=new.state->k;
 if jsonb_typeof(new_arr) is distinct from 'array' then continue;end if;
 old_arr:=case when tg_op='UPDATE' then coalesce(old.state->k,'[]'::jsonb) else '[]'::jsonb end;
 if jsonb_typeof(old_arr)<>'array' then old_arr:='[]'::jsonb;end if;
 if new_arr=old_arr then continue;end if;
 for e in select x from jsonb_array_elements(new_arr) x loop
 v_id:=e->>'id';if v_id is null or length(v_id) not between 1 and 150 then continue;end if;
 select x into previous from jsonb_array_elements(old_arr) x where x->>'id'=v_id limit 1;
 if previous is not null and previous=e then continue;end if;
 v_amount:=null;v_key:=null;
 if k='extraIncome' and previous is null and jsonb_typeof(e->'amount')='number' then
 v_amount:=(e->>'amount')::numeric;v_key:='income:'||v_id;v_ref:='INCOME-'||v_id;v_kind:='Other income receipt';v_name:=left(coalesce(e->>'category','Other income'),180);v_payment:=coalesce(nullif(e->>'method',''),'Not recorded');v_date:=e->>'date';
 elsif k='simActivations' and previous is null and jsonb_typeof(e->'frcAmount')='number' then
 v_amount:=(e->>'frcAmount')::numeric;v_key:='sim:'||v_id;v_ref:=coalesce(nullif(e->>'actNo',''),'SIM-'||v_id);v_kind:='SIM activation record - plan value, not proof of payment';v_name:=left(coalesce(e->>'operator','SIM')||' '||coalesce(e->>'type','Activation'),180);v_payment:='Customer payment not recorded';v_date:=e->>'date';
 elsif k='jobs' then
 if previous is null and jsonb_typeof(e->'advance')='number' and (e->>'advance')::numeric>0 then
 v_amount:=(e->>'advance')::numeric;v_key:='repair-advance:'||v_id;v_ref:=coalesce(nullif(e->>'jobNo',''),'REPAIR-'||v_id)||'-ADV';v_kind:='Repair advance receipt';v_name:='Repair/service advance';v_payment:='Method not recorded';v_date:=e->>'receivedDate';
 if v_amount>0 and v_amount<=1000000000 then
 v_payload:=jsonb_build_object('reference',left(v_ref,180),'kind',v_kind,'date',left(coalesce(v_date,''),20),'soldBy',v_actor,'payment',v_payment,'total',v_amount,'items',jsonb_build_array(jsonb_build_object('name',v_name,'quantity',1,'unitPrice',v_amount)));
 insert into public.telegram_outbox(store_id,chat_id,message,bill_source_key,bill_payload,last_error) values(new.store_id,v_chat,'Repair advance receipt',v_key,v_payload,case when v_chat='' then 'OWNER_TELEGRAM_NOT_CONNECTED' else null end) on conflict(store_id,bill_source_key) where bill_source_key is not null do nothing;
 end if;v_amount:=null;v_key:=null;
 end if;
 if e->>'status'='Delivered' and (previous is null or previous->>'status' is distinct from 'Delivered') and (jsonb_typeof(e->'finalCharge')='number' or jsonb_typeof(e->'estCost')='number') then
 v_amount:=case when jsonb_typeof(e->'finalCharge')='number' then (e->>'finalCharge')::numeric else (e->>'estCost')::numeric end;
 v_key:='repair-delivery:'||v_id;v_ref:=coalesce(nullif(e->>'jobNo',''),'REPAIR-'||v_id)||'-DEL';v_kind:='Repair delivery bill - full charge, advance is included, not additional income';v_name:='Completed repair/service';v_payment:=coalesce(nullif(e->>'deliveryPaymentMethod',''),'Not recorded');v_date:=e->>'deliveredDate';
 if jsonb_typeof(e->'advance')='number' then v_kind:=v_kind||'; advance INR '||(e->>'advance');end if;
 end if;
 end if;
 if v_key is null or v_amount is null or v_amount<0 or v_amount>1000000000 then continue;end if;
 v_payload:=jsonb_build_object('reference',left(v_ref,180),'kind',v_kind,'date',left(coalesce(v_date,''),20),'soldBy',v_actor,'payment',left(v_payment,120),'total',v_amount,'items',jsonb_build_array(jsonb_build_object('name',v_name,'quantity',1,'unitPrice',v_amount)));
 insert into public.telegram_outbox(store_id,chat_id,message,bill_source_key,bill_payload,last_error) values(new.store_id,v_chat,'Recorded service or income bill',v_key,v_payload,case when v_chat='' then 'OWNER_TELEGRAM_NOT_CONNECTED' else null end) on conflict(store_id,bill_source_key) where bill_source_key is not null do nothing;
 end loop;
 end loop;
 return new;
end $$;
revoke all on function public.enqueue_other_service_bills() from public,anon,authenticated;
create trigger other_service_telegram_bill_enqueue after insert or update of state on public.store_state for each row execute function public.enqueue_other_service_bills();
-- Browser users may not delete, redirect or mark queue records sent.
revoke insert,update,delete,truncate on public.telegram_outbox from anon,authenticated;

