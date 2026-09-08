-- Closes drift found while working on Phase 5's "Instant low-stock alerts
-- -> Telegram" item: notify_low_stock() / trg_notify_low_stock were
-- ALREADY live on Supabase (built by a parallel session) and already fully
-- working -- confirmed by testing directly against the live DB (a single
-- stock crossing fires exactly one telegram_outbox row; staying low or
-- restocking fires none). No matching migration file existed for it.
--
-- This session independently built an equivalent trigger before
-- discovering the existing one (same crossing-detection logic, same
-- telegram_outbox insert pattern, only the message wording differed) --
-- having both live at once caused every crossing to queue TWO duplicate
-- Telegram alerts, caught during this session's own verification testing.
-- The duplicate (products_low_stock_telegram_alert /
-- notify_low_stock_telegram) was dropped; this migration documents and
-- keeps only the original, pre-existing one.

create or replace function public.notify_low_stock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
