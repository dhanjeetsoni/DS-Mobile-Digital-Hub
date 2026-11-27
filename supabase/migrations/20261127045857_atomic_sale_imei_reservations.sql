create table ds_recovery.sale_imei_reservations(
 store_id uuid not null references public.stores(id) on delete cascade,
 sale_id uuid not null references public.sales(id) on delete cascade,
 product_id uuid not null references public.products(id),
 imei text not null check(imei ~ '^[0-9]{15}$'),
 reserved_at timestamptz not null default now(),
 released_at timestamptz,
 primary key(sale_id,imei)
);
alter table ds_recovery.sale_imei_reservations enable row level security;
revoke all on table ds_recovery.sale_imei_reservations from public,anon,authenticated;
create unique index sale_imei_active_unique on ds_recovery.sale_imei_reservations(store_id,imei) where released_at is null;
CREATE OR REPLACE FUNCTION ds_recovery.reserve_sale_imeis(p_store uuid, p_sale uuid, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare i jsonb; ident text; v_product uuid; v_state jsonb; v_qty numeric;
begin
 select state into v_state from public.store_state where store_id=p_store;
 for i in select x from jsonb_array_elements(p_items) x loop
  if not (i ? 'selected_imeis') then continue;end if;
  if jsonb_typeof(i->'selected_imeis') is distinct from 'array' then raise exception 'IMEI reservation: invalid identifier list';end if;
  if coalesce((i->>'is_service')::boolean,false) then
   if jsonb_array_length(i->'selected_imeis')>0 then raise exception 'IMEI reservation: service cannot reserve device';end if;continue;
  end if;
  v_product:=(i->>'product_id')::uuid;v_qty:=(i->>'quantity')::numeric;
  if not exists(select 1 from public.products p where p.id=v_product and p.store_id=p_store) then raise exception 'IMEI reservation: product missing';end if;
  if jsonb_array_length(i->'selected_imeis')=0 then
   if exists(select 1 from public.products p where p.id=v_product and (p.is_mobile_phone or p.category in ('New Mobile','Second-Hand Mobile'))) then raise exception 'IMEI reservation: select a device';end if;continue;
  end if;
  if jsonb_array_length(i->'selected_imeis')<>v_qty then raise exception 'IMEI reservation: quantity mismatch';end if;
  for ident in select x from jsonb_array_elements_text(i->'selected_imeis') x order by x loop
   if ident is null or ident !~ '^[0-9]{15}$' then raise exception 'IMEI reservation: invalid identifier';end if;
   if not exists(
    select 1 from public.products rp
    cross join lateral jsonb_array_elements(case when jsonb_typeof(v_state->'products')='array' then v_state->'products' else '[]'::jsonb end) sp
    cross join lateral jsonb_array_elements(case when jsonb_typeof(sp->'units')='array' then sp->'units' else '[]'::jsonb end) u
    where rp.id=v_product and rp.store_id=p_store and (sp->>'id'=rp.client_id or sp->>'id'=rp.id::text or (nullif(sp->>'sku','') is not null and sp->>'sku'=rp.sku))
    and u->>'imei1'=ident and u->>'status'='In Stock'
   ) then raise exception 'IMEI reservation: device not available in synchronized inventory';end if;
   begin
    insert into ds_recovery.sale_imei_reservations(store_id,sale_id,product_id,imei) values(p_store,p_sale,v_product,ident);
   exception when unique_violation then raise exception 'IMEI reservation: device already reserved or sold';end;
  end loop;
 end loop;
end $function$
;
revoke all on function ds_recovery.reserve_sale_imeis(uuid,uuid,jsonb) from public,anon,authenticated;
do $patch$
declare f text;a text:='  return v_sale_id;';
begin
 f:=pg_get_functiondef('public.atomic_complete_sale(uuid,text,text,text,text,numeric,numeric,text,jsonb)'::regprocedure);
 if position(a in f)=0 then raise exception 'atomic sale anchor missing';end if;
 execute replace(f,a,'  PERFORM ds_recovery.reserve_sale_imeis(p_store_id,v_sale_id,p_items);'||chr(10)||a);
end $patch$;
CREATE OR REPLACE FUNCTION ds_recovery.release_cancelled_sale_imeis()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.status='Cancelled' and old.status is distinct from new.status then
 update ds_recovery.sale_imei_reservations set released_at=now() where sale_id=new.id and store_id=new.store_id and released_at is null;
 end if;return new;
end $function$
;
revoke all on function ds_recovery.release_cancelled_sale_imeis() from public,anon,authenticated;
create trigger release_cancelled_sale_imeis after update of status on public.sales for each row execute function ds_recovery.release_cancelled_sale_imeis();
do $patch$
declare f text;a text:=' if auth.uid() is null or not public.current_account_allowed() then return new;end if;';
begin
 f:=pg_get_functiondef('public.enqueue_sale_correction_bill()'::regprocedure);
 if position(a in f)=0 then raise exception 'correction anchor missing';end if;
 execute replace(f,a,a||chr(10)||' if old.amount_paid is null and old.due_amount is null and old.created_at>=transaction_timestamp() and new.status<>''Cancelled'' then return new;end if;');
end $patch$;
