import { supabase, getCurrentProfile } from "./supabaseClient";
import type { Database } from "../types";
import { sqliteEnqueue, sqliteList, sqliteRemove } from "./localSqlite";

const LOCAL_KEY = "dsmdh_cache_v4";
const DEVICE_ID_KEY = "dsmdh_device_id";

function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export const deviceId = getDeviceId();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export type SyncOperation =
  | "sale"
  | "purchase"
  | "return"
  | "exchange"
  | "payment"
  | "expense"
  | "warranty"
  | "repair"
  | "product"
  | "stock_adjustment"
  | "customer"
  | "supplier"
  | "snapshot";

const STAFF_SAFE_STATE_RPC = "load_store_state_for_user";

export async function loadCloudState() {
  const profile = await getCurrentProfile();
  if (!profile?.store_id) return null;

  // SECURITY: staff never fetches the raw store_state row. The RPC projects
  // only fields permitted to staff before any data enters the browser.
  if (profile.role === "staff") {
    const { data, error } = await supabase.rpc(STAFF_SAFE_STATE_RPC);
    if (error) throw error;
    if (!data) return null;
    const { data: meta, error: metaError } = await supabase
      .from("store_state")
      .select("version,store_id")
      .eq("store_id", profile.store_id)
      .maybeSingle();
    if (metaError) throw metaError;
    return { state: data as Database, version: Number(meta?.version || 0), storeId: profile.store_id };
  }

  const { data: row, error } = await supabase
    .from("store_state")
    .select("state,version,store_id")
    .eq("store_id", profile.store_id)
    .maybeSingle();
  if (error || !row?.state) return null;
  return { state: row.state as Database, version: Number(row.version || 0), storeId: row.store_id };
}

export async function saveCloudState(state: Database, expectedVersion: number) {
  const profile = await getCurrentProfile();
  if (profile?.role === "staff") {
    const { data, error } = await supabase.rpc("save_store_state_for_user", {
      p_state: state,
      p_expected_version: expectedVersion,
    });
    if (error) throw error;
    return Number(data?.version ?? expectedVersion + 1);
  }
  const { data, error } = await supabase.rpc("save_store_state", {
    p_state: state,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return Number(data ?? expectedVersion + 1);
}

export function persistLocalState(state: Database) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
}

export function readLocalState(): Database | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) as Database : null;
  } catch {
    return null;
  }
}

export async function queueOfflineOperation(
  operation: SyncOperation | string,
  entity: string,
  payload: unknown,
  operationId = crypto.randomUUID()
) {
  const profile = await getCurrentProfile();
  await sqliteEnqueue(operation, entity, { operationId, deviceId, payload }, operationId);

  if (!profile?.store_id) return operationId;

  const { error } = await supabase.from("sync_queue").upsert({
    store_id: profile.store_id,
    client_id: deviceId,
    device_id: deviceId,
    operation,
    operation_id: operationId,
    operation_type: operation,
    entity,
    payload: payload as any,
    status: "pending",
    retry_count: 0,
    attempts: 0,
  }, { onConflict: "store_id,operation_id", ignoreDuplicates: true });

  if (error) console.warn("Cloud sync queue unavailable; operation remains local", error);
  return operationId;
}

async function markSync(id: string, patch: Record<string, unknown>) {
  await supabase.from("sync_queue").update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
}

async function processOperation(row: any, storeId: string) {
  const type = String(row.operation_type || row.operation || "");
  const payload: any = row.payload || {};

  if (type === "sale") {
    const sale = payload.sale || payload;
    let invoiceNo = sale.invoiceNo as string | undefined;

    // Offline invoices may have a temporary number. The server allocates the
    // authoritative number before replay, preventing device collisions.
    if (!invoiceNo || invoiceNo.startsWith("OFF-")) {
      const { data: prefixState } = await supabase.from("store_state")
        .select("state").eq("store_id", storeId).maybeSingle();
      const prefix = prefixState?.state?.settings?.invoicePrefix || "DSM";
      const { data: reserved, error: reserveError } = await supabase.rpc("reserve_invoice_number", {
        p_store_id: storeId,
        p_prefix: prefix,
        p_idempotency_key: row.operation_id,
      });
      if (reserveError) throw reserveError;
      invoiceNo = String(reserved);
    }

    // Locally-created products only ever have a client id (e.g. "p_<uuid>"),
    // never a row in public.products — resolve (find-or-create) the real
    // product id before replaying the sale, or it fails permanently with an
    // invalid-uuid error (see resolve_product_for_sale()).
    const resolvedItems = await Promise.all((sale.items || []).map(async (item: any) => {
      const { data: realId, error: resolveError } = await supabase.rpc("resolve_product_for_sale", {
        p_store_id: storeId,
        p_local_id: String(item.productId),
        p_sku: item.sku ?? null,
        p_model: item.name ?? null,
        p_brand: item.brand ?? null,
        p_category: item.category ?? null,
        p_cost_price: item.costPrice ?? item.purchasePrice ?? 0,
        p_selling_price: item.price,
        p_stock_qty: item.stockAtSale ?? 0,
        p_min_stock: item.minStock ?? 0,
      });
      if (resolveError) throw resolveError;
      return { product_id: realId, quantity: item.qty, unit_price: item.price };
    }));

    const { data: saleId, error } = await supabase.rpc("atomic_complete_sale", {
      p_store_id: storeId,
      p_invoice_no: invoiceNo,
      p_customer_name: sale.customer?.name || null,
      p_customer_phone: sale.customer?.phone || null,
      p_payment_method: sale.payment || "Cash",
      p_discount: Number(sale.discount || 0),
      p_tax: Number(sale.taxAmount || 0),
      p_idempotency_key: row.operation_id,
      p_items: resolvedItems,
    });
    if (error) throw error;
    return { serverId: saleId, invoiceNo };
  }

  if (type === "purchase") {
    const purchase = payload.purchase || payload;
    const { data: purchaseId, error } = await supabase.rpc("atomic_complete_purchase", {
      p_store_id: storeId,
      p_supplier: purchase.supplier || null,
      p_supplier_id: isUuid(purchase.supplierId) ? purchase.supplierId : null,
      p_invoice_ref: purchase.invoiceRef || null,
      p_notes: purchase.notes || null,
      p_payment_status: purchase.paymentStatus || null,
      p_idempotency_key: row.operation_id,
      p_items: (purchase.items || []).map((item: any) => ({
        product_id: item.productId,
        quantity: item.qty,
        purchase_price: item.purchasePrice,
      })),
    });
    if (error) throw error;
    return { serverId: purchaseId };
  }

  if (type === "stock_adjustment") {
    const adj = payload.adjustment || payload;
    const { data: movementId, error } = await supabase.rpc("atomic_apply_stock_adjustment", {
      p_store_id: storeId,
      p_product_id: adj.productId,
      p_delta: adj.delta,
      p_reason: adj.reason || null,
      p_idempotency_key: row.operation_id,
    });
    if (error) throw error;
    return { serverId: movementId };
  }

  if (type === "supplier") {
    // Two shapes share this operation type: an "upsert" (new/edited supplier
    // record) or a "payment" (money paid to the supplier). Distinguished by
    // payload.kind since both are cheap, non-balance-owning mirror writes —
    // see the migration comment on the suppliers table for why the client
    // stays authoritative for totalPayable.
    if (payload.kind === "payment") {
      const p = payload.payment || {};
      const { data: id, error } = await supabase.rpc("record_supplier_payment", {
        p_store_id: storeId,
        p_supplier_id: isUuid(p.supplierId) ? p.supplierId : null,
        p_amount: Number(p.amount || 0),
        p_method: p.method || null,
        p_invoice_ref: p.invoiceRef || null,
        p_notes: p.notes || null,
        p_idempotency_key: row.operation_id,
        p_supplier_name: isUuid(p.supplierId) ? null : (p.supplierName || null),
      });
      if (error) throw error;
      return { serverId: id };
    }
    const s = payload.supplier || {};
    const { data: id, error } = await supabase.rpc("upsert_supplier", {
      p_store_id: storeId,
      p_client_id: s.id || null,
      p_name: s.name,
      p_phone: s.phone || null,
      p_category: s.category || null,
      p_address: s.address || null,
      p_gstin: s.gstin || null,
      p_opening_payable: Number(s.openingPayable ?? s.totalPayable ?? 0),
    });
    if (error) throw error;
    return { serverId: id };
  }

  if (type === "customer") {
    // Same two-shapes-in-one-operation pattern as "supplier" above.
    if (payload.kind === "payment") {
      const p = payload.payment || {};
      const { data: id, error } = await supabase.rpc("record_customer_payment", {
        p_store_id: storeId,
        p_customer_id: isUuid(p.customerId) ? p.customerId : null,
        p_amount: Number(p.amount || 0),
        p_method: p.method || null,
        p_note: p.note || null,
        p_idempotency_key: row.operation_id,
        p_customer_name: isUuid(p.customerId) ? null : (p.customerName || null),
        p_customer_phone: isUuid(p.customerId) ? null : (p.customerPhone || null),
      });
      if (error) throw error;
      return { serverId: id };
    }
    const c = payload.customer || {};
    const { data: id, error } = await supabase.rpc("upsert_customer", {
      p_store_id: storeId,
      p_client_id: c.id || null,
      p_name: c.name,
      p_phone: c.phone || null,
      p_address: c.address || null,
      p_email: c.email || null,
      p_opening_due: Number(c.openingDue ?? 0),
    });
    if (error) throw error;
    return { serverId: id };
  }

  if (type === "return") {
    const r = payload.returnRecord || payload;
    const { data: returnNo, error } = await supabase.rpc("record_return", {
      p_store_id: storeId,
      p_sale_id: isUuid(r.saleId) ? r.saleId : null,
      p_return_no: r.returnNo || null,
      p_customer_id: isUuid(r.customerId) ? r.customerId : null,
      p_return_type: r.type || null,
      p_reason: r.reason || null,
      p_refund_method: r.refundMethod || null,
      p_notes: r.notes || null,
      p_idempotency_key: row.operation_id,
      p_items: (r.items || []).map((item: any) => ({
        product_id: isUuid(item.productId) ? item.productId : null,
        quantity: item.qty,
        unit_price: item.price,
        purchase_price: item.purchasePrice,
        refund_amount: item.refund,
      })),
    });
    if (error) throw error;
    return { serverId: returnNo };
  }

  if (type === "exchange") {
    const ex = payload.exchangeRecord || payload;
    const { data: exchangeId, error } = await supabase.rpc("record_exchange", {
      p_store_id: storeId,
      p_sale_id: isUuid(ex.saleId) ? ex.saleId : null,
      p_exchange_no: ex.exchangeNo || null,
      p_customer_id: isUuid(ex.customerId) ? ex.customerId : null,
      p_returned_value: Number(ex.returnedValue || 0),
      p_replacement_value: Number(ex.replacementValue || 0),
      p_difference_amount: Number(ex.differenceAmount || 0),
      p_settlement_method: ex.settlementMethod || null,
      p_reason: ex.reason || null,
      p_idempotency_key: row.operation_id,
      p_returned_items: (ex.returnedItems || []).map((item: any) => ({
        product_id: isUuid(item.productId) ? item.productId : null,
        quantity: item.qty,
        unit_price: item.price,
        purchase_price: item.purchasePrice,
      })),
      p_replacement_items: (ex.replacementItems || []).map((item: any) => ({
        product_id: isUuid(item.productId) ? item.productId : null,
        quantity: item.qty,
        unit_price: item.price,
        purchase_price: item.purchasePrice,
      })),
    });
    if (error) throw error;
    return { serverId: exchangeId };
  }

  if (type === "warranty") {
    // Two shapes, same pattern as supplier/customer: a new claim, or a
    // status update on an existing claim (looked up by claim_no, since the
    // local claim id never reconciles with the server row's uuid — same
    // reasoning as returns/exchanges).
    if (payload.kind === "status_by_no") {
      const s = payload.statusUpdate || {};
      const { data: id, error } = await supabase.rpc("update_warranty_claim_status_by_no", {
        p_store_id: storeId,
        p_claim_no: s.claimNo,
        p_status: s.status,
        p_resolution: s.resolution || null,
      });
      if (error) throw error;
      return { serverId: id };
    }
    const c = payload.claim || {};
    const { data: id, error } = await supabase.rpc("record_warranty_claim", {
      p_store_id: storeId,
      p_sale_id: isUuid(c.saleId) ? c.saleId : null,
      p_product_id: isUuid(c.productId) ? c.productId : null,
      p_customer_id: isUuid(c.customerId) ? c.customerId : null,
      p_claim_no: c.claimNo || null,
      p_issue_description: c.issueDescription || null,
      p_idempotency_key: row.operation_id,
    });
    if (error) throw error;
    return { serverId: id };
  }

  if (type === "snapshot") {
    // Compatibility bridge for legacy modules that still persist the aggregate state.
    // Server-side version checking prevents silent last-write-wins overwrites.
    const profile = await getCurrentProfile();
    if (profile?.role === "staff") {
      const { data: current, error: currentError } = await supabase
        .from("store_state").select("version").eq("store_id", storeId).maybeSingle();
      if (currentError) throw currentError;
      const { data, error } = await supabase.rpc("save_store_state_for_user", {
        p_state: payload as any,
        p_expected_version: Number(current?.version || 0),
      });
      if (error) throw error;
      return { serverId: data?.store_id, version: data?.version };
    }
    const { data: current, error: currentError } = await supabase
      .from("store_state").select("version").eq("store_id", storeId).maybeSingle();
    if (currentError) throw currentError;
    const version = Number(current?.version || 0);
    const next = await saveCloudState(payload as Database, version);
    return { serverId: storeId, version: next };
  }

  // Other entity types are deliberately explicit. A module must register a
  // repository operation before it can replay writes to PostgreSQL.
  throw new Error(`SYNC_OPERATION_NOT_IMPLEMENTED:${type}`);
}

export async function flushOfflineQueue() {
  const profile = await getCurrentProfile();
  if (!profile?.store_id) return { processed: 0, failed: 0 };

  const { data: rows, error } = await supabase
    .from("sync_queue")
    .select("id,operation_id,operation,operation_type,entity,payload,retry_count,attempts")
    .eq("store_id", profile.store_id)
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) throw error;

  let processed = 0, failed = 0;
  for (const row of rows || []) {
    try {
      await markSync(row.id, {
        status: "syncing",
        retry_count: Number(row.retry_count || 0) + 1,
        attempts: Number(row.attempts || 0) + 1,
        last_attempt_at: new Date().toISOString(),
      });

      const result = await processOperation(row, profile.store_id);
      await markSync(row.id, {
        status: "processed",
        last_error: null,
        server_reference: result?.serverId || null,
      });

      const localRows = await sqliteList();
      const local = localRows.find((r: any[]) => r[0] === row.operation_id);
      if (local) await sqliteRemove(String(local[0]));
      processed++;
    } catch (err: any) {
      failed++;
      await markSync(row.id, {
        status: "failed",
        last_error: String(err?.message || err),
      });
    }
  }
  return { processed, failed };
}

export function startConnectivitySync(onResult?: (result: { processed: number; failed: number }) => void) {
  let busy = false;
  const run = async () => {
    if (busy || !navigator.onLine) return;
    busy = true;
    try {
      const result = await flushOfflineQueue();
      onResult?.(result);
    } catch (error) {
      console.warn("Background sync failed", error);
    } finally {
      busy = false;
    }
  };
  window.addEventListener("online", run);
  const timer = window.setInterval(run, 15000);
  void run();
  return () => {
    window.removeEventListener("online", run);
    window.clearInterval(timer);
  };
}
