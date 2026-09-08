-- Phase 5: instant low-stock alert -> Telegram. In-app is already
-- effectively instant (Phase 1's stockOf()/subscribeToLiveStock realtime
-- feed updates the header's "LOW STOCK: N SKUs" badge within ~1s of any
-- sale/adjustment/purchase on any device) — this closes the Telegram half.
--
-- DB trigger rather than client-side code so it catches every path that
-- can change stock_qty (sale, stock adjustment, purchase return, manual
-- product edit) without needing every one of those call sites to
-- separately remember to check and send. Only fires on the transition
-- INTO low stock (was above min_stock, now at/below it) — not on every
-- subsequent sale while it's already low, so it doesn't spam.
create or replace function public.notify_low_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_chat_id text;
  v_was_ok boolean;
  v_is_low boolean;
begin
  v_was_ok := coalesce(old.stock_qty, 0) > coalesce(old.min_stock, 0);
  v_is_low := coalesce(new.stock_qty, 0) <= coalesce(new.min_stock, 0);
  if v_was_ok and v_is_low then
    select chat_id into v_chat_id from public.telegram_connections where store_id = new.store_id;
    if v_chat_id is not null then
      insert into public.telegram_outbox(store_id, chat_id, message, status)
      values (
        new.store_id,
        v_chat_id,
        format(
          E'⚠️ Low Stock Alert\n\n%s (%s) ab sirf %s bache hain (minimum %s tha).\nReorder karna zaroori hai.',
          coalesce(nullif(new.model, ''), 'Product'),
          coalesce(nullif(new.brand, ''), new.category, ''),
          new.stock_qty,
          new.min_stock
        ),
        'pending'
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_low_stock on public.products;
create trigger trg_notify_low_stock
  after update of stock_qty on public.products
  for each row execute function public.notify_low_stock();
