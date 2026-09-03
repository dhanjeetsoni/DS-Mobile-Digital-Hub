-- Server-authoritative invoice allocation + idempotent reservations.
create table if not exists public.invoice_reservations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  idempotency_key text not null,
  prefix text not null,
  invoice_no text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(store_id,idempotency_key),
  unique(store_id,invoice_no)
);
alter table public.invoice_reservations enable row level security;
drop policy if exists invoice_reservations_owner_manager on public.invoice_reservations;
create policy invoice_reservations_owner_manager on public.invoice_reservations for select
using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=store_id and p.role in ('owner','manager')));

create table if not exists public.invoice_sequences (
  store_id uuid not null references public.stores(id) on delete cascade,
  prefix text not null,
  next_number bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key(store_id,prefix)
);
alter table public.invoice_sequences enable row level security;
drop policy if exists invoice_sequences_owner_manager on public.invoice_sequences;
create policy invoice_sequences_owner_manager on public.invoice_sequences for select
using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.store_id=store_id and p.role in ('owner','manager')));

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
grant execute on function public.reserve_invoice_number(uuid,text,text) to authenticated;
