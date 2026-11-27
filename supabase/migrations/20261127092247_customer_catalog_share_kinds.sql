alter table public.customer_share_links drop constraint customer_share_links_kind_check;
alter table public.customer_share_links add constraint customer_share_links_kind_check check(kind in ('receipt','repair','catalog','catalog-price'));
