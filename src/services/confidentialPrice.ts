import { supabase } from './supabaseClient';
import { describeFunctionsError } from './telegram';

// Step 4.3 — Confidential Price: per-product Telegram request/approval flow.
//
// Flow: Staff taps "🔒 Confidential Price" on a product -> this calls the
// telegram-connect Edge Function (action: confidential_price_request), which
// creates a row here and messages the Owner on Telegram with Approve/Deny
// buttons. The Owner's tap is handled entirely server-side (Telegram
// callback_query -> the same Edge Function's webhook branch), which writes
// `revealed_price` + a 5-minute `reveal_expires_at` back onto this exact row.
// The staff device is listening on Supabase Realtime for that row to change,
// so the reveal appears the moment the Owner taps Approve — no polling.
//
// Table RLS only grants SELECT (never INSERT/UPDATE) to `authenticated` —
// every write happens through the Edge Function's service-role client, so
// a staff device can only ever read this one row's status, never fabricate
// an approval or read another product's confidential price.
export interface ConfidentialPriceRequestRow {
  id: string;
  store_id: string;
  product_id: string;
  product_name: string;
  product_category: string | null;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  revealed_price: number | null;
  reveal_expires_at: string | null;
  responded_at: string | null;
  created_at: string;
}

export async function requestConfidentialPrice(
  productId: string,
  productName: string,
  productCategory?: string | null
): Promise<{ ok: true; requestId: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in to request a Confidential Price.');
  const { data, error } = await supabase.functions.invoke('telegram-connect', {
    body: { action: 'confidential_price_request', productId, productName, productCategory: productCategory || null },
  });
  if (error) throw new Error(await describeFunctionsError(error));
  if (data?.error) throw new Error(String(data.error));
  return data as { ok: true; requestId: string };
}

export async function fetchConfidentialPriceRequest(requestId: string): Promise<ConfidentialPriceRequestRow | null> {
  const { data, error } = await supabase
    .from('confidential_price_requests')
    .select('id,store_id,product_id,product_name,product_category,status,revealed_price,reveal_expires_at,responded_at,created_at')
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw error;
  return (data as ConfidentialPriceRequestRow) || null;
}

// Realtime subscription for one specific request row. Returns an unsubscribe
// function — callers must invoke it on unmount/close so the channel doesn't
// leak (this modal opens/closes often, once per request).
export function subscribeToConfidentialPriceRequest(
  requestId: string,
  onChange: (row: ConfidentialPriceRequestRow) => void
): () => void {
  const channel = supabase
    .channel(`cpr-${requestId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'confidential_price_requests', filter: `id=eq.${requestId}` },
      (payload) => onChange(payload.new as ConfidentialPriceRequestRow)
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
