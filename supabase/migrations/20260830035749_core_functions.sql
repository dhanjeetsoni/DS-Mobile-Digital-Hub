-- ---------------------------------------------------------------------------
-- FUNCTIONS
-- ---------------------------------------------------------------------------

create or replace function public.my_store_id()
returns uuid language sql stable as $$
  select store_id from public.profiles where id = auth.uid();
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_store_id uuid; v_meta jsonb;
begin
  v_meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  if v_meta ? 'store_id' then
    return new;
  end if;
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;
  insert into public.stores(name) values (coalesce(nullif(trim(v_meta->>'shop_name'), ''), 'My Shop'))
    returning id into v_store_id;
  insert into public.profiles(id, email, full_name, store_id, role)
    values (new.id, new.email, coalesce(nullif(trim(v_meta->>'full_name'), ''), split_part(new.email,'@',1)), v_store_id, 'owner');
  insert into public.store_state(store_id, state, version) values (v_store_id, '{}'::jsonb, 1);
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.reserve_invoice_number(p_store_id uuid,p_prefix text,p_idempotency_key text)
returns text language plpgsql security definer set search_path=public as $$
declare v_role text; v_existing text; v_prefix text := upper(regexp_replace(coalesce(nullif(trim(p_prefix),''),'DSM'),'[^A-Z0-9_-]','','g')); v_next bigint; v_invoice text;
begin
 select role into v_role from public.profiles where id=auth.uid() and store_id=p_store_id limit 1;
 if v_role is null or v_role not in ('owner','manager','staff') then raise exception 'not authorized'; end if;
 if nullif(trim(p_idempotency_key),'') is null then raise exception 'idempotency key required'; end if;
 select invoice_no into v_existing from public.invoice_reservations where store_id=p_store_id and idempotency_key=p_idempotency_key limit 1;
 if v_existing is not null then return v_existing; end if;
 insert into public.invoice_sequences(store_id,prefix,next_number) values(p_store_id,v_prefix,1) on conflict(store_id,prefix) do nothing;
 select next_number into v_next from public.invoice_sequences where store_id=p_store_id and prefix=v_prefix for update;
 v_invoice := v_prefix||'-'||lpad(v_next::text,6,'0');
 update public.invoice_sequences set next_number=v_next+1,updated_at=now() where store_id=p_store_id and prefix=v_prefix;
 insert into public.invoice_reservations(store_id,idempotency_key,prefix,invoice_no,created_by) values(p_store_id,p_idempotency_key,v_prefix,v_invoice,auth.uid());
 return v_invoice;
exception when unique_violation then
 select invoice_no into v_existing from public.invoice_reservations where store_id=p_store_id and idempotency_key=p_idempotency_key limit 1;
 if v_existing is not null then return v_existing; end if;
 raise;
end; $$;
revoke all on function public.reserve_invoice_number(uuid,text,text) from anon;
grant execute on function public.reserve_invoice_number(uuid,text,text) to authenticated;

create or replace function public.atomic_complete_sale(
  p_store_id uuid,
  p_invoice_no text,
  p_customer_name text,
  p_customer_phone text,
  p_payment_method text,
  p_discount numeric,
  p_tax numeric,
  p_idempotency_key text,
  p_items jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_sale_id uuid;
  v_existing_sale_id uuid;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric;
  v_unit_price numeric;
  v_line_cost numeric;
  v_remaining numeric;
  v_batch record;
  v_take numeric;
begin
  select role into v_role from public.profiles where id = auth.uid() and store_id = p_store_id;
  if v_role is null or v_role not in ('owner','manager','staff') then
    raise exception 'not authorized';
  end if;

  if p_idempotency_key is null or trim(p_idempotency_key) = '' then
    raise exception 'idempotency key required';
  end if;

  select id into v_existing_sale_id from public.sales where store_id = p_store_id and idempotency_key = p_idempotency_key;
  if v_existing_sale_id is not null then
    return v_existing_sale_id;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'invalid quantity: no items';
  end if;

  if exists (select 1 from public.sales where store_id = p_store_id and invoice_no = p_invoice_no) then
    raise exception 'invoice number already exists';
  end if;

  v_sale_id := gen_random_uuid();

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid quantity'; end if;
    if v_unit_price is null or v_unit_price < 0 then raise exception 'selling price invalid'; end if;

    select * into v_product from public.products
      where id = (v_item->>'product_id')::uuid and store_id = p_store_id for update;
    if v_product.id is null then raise exception 'invalid quantity: unknown product'; end if;
    if v_product.stock_qty < v_qty then
      raise exception 'insufficient inventory for %', coalesce(v_product.model, v_product.brand, v_product.id::text);
    end if;

    v_subtotal := v_subtotal + (v_qty * v_unit_price);
  end loop;

  v_total := greatest(0, v_subtotal - coalesce(p_discount,0) + coalesce(p_tax,0));

  insert into public.sales(id, store_id, invoice_no, customer_name, customer_phone, payment_method, subtotal, discount, tax, total, status, idempotency_key, created_by)
  values (v_sale_id, p_store_id, p_invoice_no, p_customer_name, p_customer_phone, p_payment_method, v_subtotal, coalesce(p_discount,0), coalesce(p_tax,0), v_total, 'Paid', p_idempotency_key, auth.uid());

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_remaining := v_qty;
    v_line_cost := 0;

    for v_batch in
      select * from public.stock_batches
      where product_id = (v_item->>'product_id')::uuid and store_id = p_store_id and remaining_qty > 0
      order by created_at asc
      for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_batch.remaining_qty);
      update public.stock_batches set remaining_qty = remaining_qty - v_take where id = v_batch.id;
      v_line_cost := v_line_cost + (v_take * coalesce(v_batch.purchase_price,0));
      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      select cost_price into v_line_cost from public.products where id = (v_item->>'product_id')::uuid;
      v_line_cost := coalesce(v_line_cost,0) * v_qty;
    end if;

    update public.products set stock_qty = stock_qty - v_qty
      where id = (v_item->>'product_id')::uuid and store_id = p_store_id;

    insert into public.stock_movements(store_id, product_id, movement_type, quantity, reference, created_by)
    values (p_store_id, (v_item->>'product_id')::uuid, 'sale', -v_qty, p_invoice_no, auth.uid());

    insert into public.sale_items(sale_id, product_id, quantity, unit_price, cost_price)
    values (v_sale_id, (v_item->>'product_id')::uuid, v_qty, v_unit_price, case when v_qty > 0 then v_line_cost / v_qty else 0 end);
  end loop;

  insert into public.invoices(store_id, sale_id, invoice_no) values (p_store_id, v_sale_id, p_invoice_no);

  return v_sale_id;
exception
  when unique_violation then
    select id into v_existing_sale_id from public.sales where store_id = p_store_id and idempotency_key = p_idempotency_key;
    if v_existing_sale_id is not null then return v_existing_sale_id; end if;
    raise;
end;
$$;
revoke all on function public.atomic_complete_sale(uuid,text,text,text,text,numeric,numeric,text,jsonb) from public, anon;
grant execute on function public.atomic_complete_sale(uuid,text,text,text,text,numeric,numeric,text,jsonb) to authenticated;

create or replace function public.save_store_state(p_state jsonb, p_expected_version bigint default null)
returns bigint language plpgsql security definer set search_path=public as $$
declare v_store uuid; v_role text; v_row public.store_state;
begin
  v_store := public.my_store_id();
  select role into v_role from public.profiles where id=auth.uid() and store_id=v_store;
  if v_store is null or v_role not in ('owner','manager') then raise exception 'Not authorized'; end if;
  if p_expected_version is null then
    update public.store_state set state=p_state, updated_by=auth.uid(), version=version+1, updated_at=now()
    where store_id=v_store returning * into v_row;
  else
    update public.store_state set state=p_state, updated_by=auth.uid(), version=version+1, updated_at=now()
    where store_id=v_store and version=p_expected_version returning * into v_row;
  end if;
  if v_row.store_id is null then raise exception 'VERSION_CONFLICT'; end if;
  return v_row.version;
end; $$;
revoke all on function public.save_store_state(jsonb,bigint) from anon;
grant execute on function public.save_store_state(jsonb,bigint) to authenticated;

create or replace function public.merge_staff_json_array(p_current jsonb, p_incoming jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(value), '[]'::jsonb)
  from jsonb_each(
    coalesce(
      (select jsonb_object_agg(coalesce(e->>'id', md5(e::text)), e)
       from jsonb_array_elements(coalesce(p_current,'[]'::jsonb)) e)
      ||
      (select jsonb_object_agg(coalesce(e->>'id', md5(e::text)), e)
       from jsonb_array_elements(coalesce(p_incoming,'[]'::jsonb)) e),
      '{}'::jsonb
    )
  );
$$;
revoke all on function public.merge_staff_json_array(jsonb,jsonb) from public,anon,authenticated;

create or replace function public.load_store_state_for_user()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_store uuid; v_role text; v_state jsonb;
begin
 v_store:=public.my_store_id(); select role into v_role from public.profiles where id=auth.uid() and store_id=v_store; select state into v_state from public.store_state where store_id=v_store;
 if v_role in ('owner','manager') then return v_state; end if;
 v_state:=jsonb_set(v_state,'{products}',coalesce((select jsonb_agg(p-'purchasePrice'-'pendingCost'-'supplier'-'units') from jsonb_array_elements(coalesce(v_state->'products','[]'::jsonb)) p),'[]'::jsonb),true);
 v_state:=jsonb_set(v_state,'{stockBatches}',coalesce((select jsonb_agg(b-'purchasePrice') from jsonb_array_elements(coalesce(v_state->'stockBatches','[]'::jsonb)) b),'[]'::jsonb),true);
 v_state:=jsonb_set(v_state,'{sales}',coalesce((select jsonb_agg((s-'items'-'financeDetails') || jsonb_build_object('items',coalesce((select jsonb_agg(i-'purchasePrice'-'cost'-'batchConsumption') from jsonb_array_elements(coalesce(s->'items','[]'::jsonb)) i),'[]'::jsonb))) from jsonb_array_elements(coalesce(v_state->'sales','[]'::jsonb)) s),'[]'::jsonb),true);
 v_state:=jsonb_set(v_state,'{purchases}','[]'::jsonb,true); v_state:=jsonb_set(v_state,'{suppliers}','[]'::jsonb,true); v_state:=jsonb_set(v_state,'{supplierPayments}','[]'::jsonb,true); v_state:=jsonb_set(v_state,'{expenses}',jsonb_build_object('shop','[]'::jsonb,'personal','[]'::jsonb,'other','[]'::jsonb),true); v_state:=jsonb_set(v_state,'{secondHandKYCs}','[]'::jsonb,true); v_state:=jsonb_set(v_state,'{imeiRegistry}','[]'::jsonb,true); v_state:=jsonb_set(v_state,'{gallaClosings}','[]'::jsonb,true);
 v_state:=jsonb_set(v_state,'{moneyLenders}','[]'::jsonb,true); v_state:=jsonb_set(v_state,'{lenderTransactions}','[]'::jsonb,true);
 return v_state;
end; $$;
revoke all on function public.load_store_state_for_user() from anon;
grant execute on function public.load_store_state_for_user() to authenticated;

create or replace function public.save_store_state_for_user(p_state jsonb,p_expected_version bigint default null)
returns public.store_state language plpgsql security definer set search_path=public as $$
declare
  v_store uuid; v_role text; v_current jsonb; v_state jsonb;
  v_products jsonb; v_batches jsonb; v_sales jsonb; v_row public.store_state;
begin
  v_store:=public.my_store_id();
  select role into v_role from public.profiles where id=auth.uid() and store_id=v_store;
  if v_store is null or v_role <> 'staff' then raise exception 'Not authorized'; end if;

  select state into v_current from public.store_state where store_id=v_store for update;
  v_state:=coalesce(p_state,'{}'::jsonb);

  select coalesce(jsonb_agg(
    (incoming-'purchasePrice'-'pendingCost'-'supplier'-'units') ||
    jsonb_build_object(
      'purchasePrice',coalesce(oldp->'purchasePrice','null'::jsonb),
      'pendingCost',coalesce(oldp->'pendingCost','null'::jsonb),
      'supplier',coalesce(oldp->'supplier','null'::jsonb),
      'units',coalesce(oldp->'units','[]'::jsonb)
    )
  ),'[]'::jsonb)
  into v_products
  from jsonb_array_elements(coalesce(v_state->'products','[]'::jsonb)) incoming
  left join lateral (
    select p as oldp from jsonb_array_elements(coalesce(v_current->'products','[]'::jsonb)) p
    where p->>'id'=incoming->>'id' limit 1
  ) x on true;

  select coalesce(jsonb_agg(b-'purchasePrice'),'[]'::jsonb)
  into v_batches from jsonb_array_elements(coalesce(v_state->'stockBatches','[]'::jsonb)) b;

  select coalesce(jsonb_agg(
    (s-'items'-'financeDetails') ||
    jsonb_build_object('items',coalesce((
      select jsonb_agg(i-'purchasePrice'-'cost'-'batchConsumption')
      from jsonb_array_elements(coalesce(s->'items','[]'::jsonb)) i
    ),'[]'::jsonb))
  ),'[]'::jsonb)
  into v_sales from jsonb_array_elements(coalesce(v_state->'sales','[]'::jsonb)) s;

  v_state:=jsonb_set(v_state,'{products}',v_products,true);
  v_state:=jsonb_set(v_state,'{stockBatches}',v_batches,true);
  v_state:=jsonb_set(v_state,'{sales}',v_sales,true);

  v_state:=jsonb_set(v_state,'{purchases}',public.merge_staff_json_array(v_current->'purchases',v_state->'purchases'),true);
  v_state:=jsonb_set(v_state,'{suppliers}',public.merge_staff_json_array(v_current->'suppliers',v_state->'suppliers'),true);
  v_state:=jsonb_set(v_state,'{supplierPayments}',public.merge_staff_json_array(v_current->'supplierPayments',v_state->'supplierPayments'),true);
  v_state:=jsonb_set(v_state,'{secondHandKYCs}',public.merge_staff_json_array(v_current->'secondHandKYCs',v_state->'secondHandKYCs'),true);
  v_state:=jsonb_set(v_state,'{imeiRegistry}',public.merge_staff_json_array(v_current->'imeiRegistry',v_state->'imeiRegistry'),true);
  v_state:=jsonb_set(v_state,'{gallaClosings}',public.merge_staff_json_array(v_current->'gallaClosings',v_state->'gallaClosings'),true);
  v_state:=jsonb_set(v_state,'{exchanges}',public.merge_staff_json_array(v_current->'exchanges',v_state->'exchanges'),true);

  v_state:=jsonb_set(v_state,'{expenses}',jsonb_build_object(
    'shop',public.merge_staff_json_array(v_current->'expenses'->'shop',v_state->'expenses'->'shop'),
    'personal',public.merge_staff_json_array(v_current->'expenses'->'personal',v_state->'expenses'->'personal'),
    'other',public.merge_staff_json_array(v_current->'expenses'->'other',v_state->'expenses'->'other')
  ),true);

  v_state:=jsonb_set(v_state,'{moneyLenders}',coalesce(v_current->'moneyLenders','[]'::jsonb),true);
  v_state:=jsonb_set(v_state,'{lenderTransactions}',coalesce(v_current->'lenderTransactions','[]'::jsonb),true);

  if p_expected_version is null then
    update public.store_state set state=v_state,updated_by=auth.uid(),version=version+1,updated_at=now()
    where store_id=v_store returning * into v_row;
  else
    update public.store_state set state=v_state,updated_by=auth.uid(),version=version+1,updated_at=now()
    where store_id=v_store and version=p_expected_version returning * into v_row;
  end if;

  if v_row.store_id is null then raise exception 'VERSION_CONFLICT'; end if;
  return v_row;
end;
$$;
revoke all on function public.save_store_state_for_user(jsonb,bigint) from anon;
grant execute on function public.save_store_state_for_user(jsonb,bigint) to authenticated;

create or replace function public.enqueue_invoice_telegram()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_chat text; v_sale public.sales%rowtype; v_items text; v_message text;
begin
 select * into v_sale from public.sales where id=new.sale_id;
 if v_sale.id is null then return new; end if;
 select tc.chat_id into v_chat
 from public.telegram_connections tc join public.profiles p on p.id=tc.user_id
 where tc.store_id=v_sale.store_id and p.role in ('owner','manager') and tc.chat_id is not null
 order by tc.updated_at desc nulls last limit 1;
 if v_chat is null then return new; end if;
 select string_agg(format('%s x %s @ %s',coalesce(nullif(p.model,''),nullif(p.brand,''),'Product'),si.quantity,si.unit_price),E'\n' order by si.id)
 into v_items from public.sale_items si join public.products p on p.id=si.product_id where si.sale_id=v_sale.id;
 v_message := format(E'DS MOBILE & DIGITAL HUB\nInvoice: %s\nDate: %s\nCustomer: %s\nPhone: %s\nSold By: %s\nProducts:\n%s\nTotal: %s\nPayment: %s',
 v_sale.invoice_no,to_char(v_sale.created_at,'YYYY-MM-DD HH24:MI'),coalesce(v_sale.customer_name,'Walk-in'),coalesce(v_sale.customer_phone,'-'),
 coalesce((select full_name from public.profiles where id=v_sale.created_by),'Staff'),coalesce(v_items,'-'),v_sale.total,v_sale.payment_method);
 insert into public.telegram_outbox(store_id,chat_id,message,status,attempts,sale_id,invoice_id,next_attempt_at)
 values(v_sale.store_id,v_chat,v_message,'pending',0,v_sale.id,new.id,now())
 on conflict(sale_id) where sale_id is not null do nothing;
 return new;
end; $$;
drop trigger if exists invoices_telegram_outbox_trigger on public.invoices;
create trigger invoices_telegram_outbox_trigger after insert on public.invoices for each row execute function public.enqueue_invoice_telegram();
