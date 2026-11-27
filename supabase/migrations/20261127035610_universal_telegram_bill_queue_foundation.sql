alter table public.telegram_outbox add column bill_source_key text;
alter table public.telegram_outbox add column bill_payload jsonb;
create unique index telegram_outbox_bill_source_uq on public.telegram_outbox(store_id,bill_source_key) where bill_source_key is not null;
create function public.owner_bill_chat(p_store uuid) returns text language sql stable security definer set search_path='' as $$
select nullif(btrim(t.chat_id),'') from public.telegram_connections t join public.profiles p on p.id=t.user_id and p.store_id=t.store_id where t.store_id=p_store and p.role='owner' and nullif(btrim(t.chat_id),'') is not null order by t.updated_at desc nulls last,t.user_id limit 1
$$;
revoke all on function public.owner_bill_chat(uuid) from public,anon,authenticated;
grant execute on function public.owner_bill_chat(uuid) to service_role;
create function public.enqueue_xerox_bill() returns trigger language plpgsql security definer set search_path='' as $$
declare e jsonb;v_id text;v_chat text;v_qty numeric;v_rate numeric;v_total numeric;v_payload jsonb;v_actor text;v_old jsonb;
begin
 -- Operator reset/restore does not generate new external notifications.
 if auth.uid() is null or new.state->'xeroxEntries' is null or jsonb_typeof(new.state->'xeroxEntries')<>'array' then return new;end if;
 if not public.current_account_allowed() or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=new.store_id) then return new;end if;
 v_old:=case when tg_op='UPDATE' then coalesce(old.state->'xeroxEntries','[]'::jsonb) else '[]'::jsonb end;
 if jsonb_typeof(v_old)<>'array' then v_old:='[]'::jsonb;end if;
 if new.state->'xeroxEntries'=v_old then return new;end if;
 v_chat:=coalesce(public.owner_bill_chat(new.store_id),'');
 select coalesce(nullif(p.staff_name,''),nullif(p.full_name,''),p.role) into v_actor from public.profiles p where p.id=auth.uid() and p.store_id=new.store_id;
 for e in select x from jsonb_array_elements(new.state->'xeroxEntries') x where not exists(select 1 from jsonb_array_elements(v_old) o where o->>'id'=x->>'id') loop
 v_id:=e->>'id';
 if v_id is null or length(v_id) not between 1 and 150 or jsonb_typeof(e->'copies') is distinct from 'number' or jsonb_typeof(e->'ratePerUnit') is distinct from 'number' or jsonb_typeof(e->'totalAmount') is distinct from 'number' then continue;end if;
 v_qty:=(e->>'copies')::numeric;v_rate:=(e->>'ratePerUnit')::numeric;v_total:=(e->>'totalAmount')::numeric;
 if v_qty<=0 or v_rate<0 or v_total<=0 or round(v_qty*v_rate,2)<>round(v_total,2) or e->>'paymentMethod' not in ('Cash','UPI') then continue;end if;
 v_payload:=jsonb_build_object('reference','CYBER-'||v_id,'kind','Cybercafe service','date',left(coalesce(e->>'date',''),20),'time',left(coalesce(e->>'time',''),20),'soldBy',coalesce(v_actor,'Staff'),'payment',e->>'paymentMethod','total',v_total,'items',jsonb_build_array(jsonb_build_object('name',left(coalesce(nullif(e->>'serviceType',''),'Cybercafe service'),180),'quantity',v_qty,'unitPrice',v_rate)));
 insert into public.telegram_outbox(store_id,chat_id,message,status,attempts,next_attempt_at,bill_source_key,bill_payload,last_error)
 values(new.store_id,v_chat,format('Cybercafe bill %s',v_id),'pending',0,now(),'xerox:'||v_id,v_payload,case when v_chat='' then 'OWNER_TELEGRAM_NOT_CONNECTED' else null end)
 on conflict(store_id,bill_source_key) where bill_source_key is not null do nothing;
 end loop;
 return new;
end $$;
revoke all on function public.enqueue_xerox_bill() from public,anon,authenticated;
-- New trigger installed only after the compatible worker is deployed.

