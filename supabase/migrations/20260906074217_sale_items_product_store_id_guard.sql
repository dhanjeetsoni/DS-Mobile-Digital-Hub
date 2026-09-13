-- Phase 1 (carried-over item): defence-in-depth guard so a sale_item can
-- never reference a product belonging to a DIFFERENT store than its own
-- sale. There's no direct store_id column on sale_items to express this as
-- a plain composite foreign key against two joined tables, so this is
-- enforced with a BEFORE INSERT/UPDATE trigger instead (a real constraint,
-- not just an application-level check -- it runs no matter which RPC/path
-- writes the row).
--
-- Verified against live data before adding this: 0 of 8 existing sale_items
-- rows with a non-null product_id currently mismatch their sale's store_id,
-- so this trigger has nothing to break on rollout.
--
-- Single-store-per-shop is the current reality (per the locked-in product
-- decision: "Multi-store support | Not needed — single store only, for
-- now"), so this can never fire in today's actual usage -- it's insurance
-- against a future bug (or future multi-store support) silently mixing
-- another store's product into a sale, not a fix for an active problem.

create or replace function public.enforce_sale_item_product_store_match()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sale_store_id uuid;
  v_product_store_id uuid;
begin
  if new.product_id is null then
    return new;
  end if;

  select store_id into v_sale_store_id from public.sales where id = new.sale_id;
  select store_id into v_product_store_id from public.products where id = new.product_id;

  if v_sale_store_id is not null and v_product_store_id is not null
     and v_sale_store_id <> v_product_store_id then
    raise exception 'sale_items store mismatch: product % belongs to a different store than sale %', new.product_id, new.sale_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sale_items_product_store_match on public.sale_items;
create trigger sale_items_product_store_match
  before insert or update of sale_id, product_id on public.sale_items
  for each row
  execute function public.enforce_sale_item_product_store_match();
