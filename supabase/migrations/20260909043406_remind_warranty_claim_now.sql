-- Phase 6: "Remind Now" manual trigger for a single warranty claim. Mirrors
-- one iteration of dispatch_due_warranty_reminders()'s loop body exactly
-- (same message format, same next_reminder_at/reminder_count bump) but
-- runs immediately for one specific claim rather than waiting for the next
-- due date, so the owner/manager can nudge a claim right now if needed.
create or replace function public.remind_warranty_claim_now(p_claim_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_claim record;
  v_chat text;
  v_message text;
begin
  select c.*, coalesce(p.brand||' '||p.model,p.model,p.brand,'Product') as product_label
  into v_claim
  from public.warranty_claims c
  left join public.products p on p.id = c.product_id
  where c.id = p_claim_id;

  if v_claim.id is null then
    raise exception 'Claim not found';
  end if;

  select role into v_role from public.profiles where id = auth.uid() and store_id = v_claim.store_id;
  if v_role is null or v_role not in ('owner','manager') then
    raise exception 'not authorized';
  end if;

  select tc.chat_id into v_chat
  from public.telegram_connections tc
  join public.profiles op on op.id = tc.user_id
  where tc.store_id = v_claim.store_id and op.role = 'owner' and tc.chat_id is not null
  order by tc.updated_at desc nulls last limit 1;

  if v_chat is null then
    return jsonb_build_object('sent', false, 'reason', 'no_telegram_connected');
  end if;

  v_message := format(
    E'🛡️ Warranty reminder (manual)\nClaim: %s\nProduct: %s\nStatus: %s\nIssue: %s\n\nOpen DS Mobile & Digital Hub to update the claim.',
    coalesce(v_claim.claim_no, v_claim.id::text), v_claim.product_label, v_claim.status, coalesce(v_claim.issue_description,'—')
  );
  insert into public.telegram_outbox(store_id, chat_id, message, status, next_attempt_at)
  values (v_claim.store_id, v_chat, v_message, 'pending', now());

  update public.warranty_claims
  set last_reminder_at = now(), reminder_count = coalesce(reminder_count,0) + 1,
      next_reminder_at = now() + make_interval(days => greatest(coalesce(reminder_interval_days,7),1))
  where id = v_claim.id;

  return jsonb_build_object('sent', true);
end;
$$;

revoke all on function public.remind_warranty_claim_now(uuid) from public, anon;
grant execute on function public.remind_warranty_claim_now(uuid) to authenticated;
