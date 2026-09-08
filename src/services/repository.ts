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

/**
 * Phase 1 (data architecture fix): products.stock_qty is the authoritative
 * transactional number (updated inside the row-locked atomic RPCs), not the
 * JSON store_state blob, which only reaches a device on its next full save/
 * load cycle and is what caused the "0 ↔ 5" flicker. This is a lightweight
 * one-shot read of just {id, stock_qty} for every product — used to seed the
 * live-stock map on bootstrap, before the realtime subscription below takes
 * over keeping it current.
 *
 * 2026-09-06: reads from `products_staff_view` (a redacted, always-current
 * mirror of `products`, kept in sync by a trigger — see migration
 * 20260906130000_phase1_products_staff_view_v38.sql), not `products`
 * directly. `products` only has an owner/manager RLS policy, so a staff
 * session silently got zero rows here before — this function looked like it
 * worked (no thrown error reached the UI) while actually leaving staff on
 * the stale blob-only stock the whole time. The mirror carries no
 * confidential column, so it's safe for every role, staff included.
 */
export interface AuditLogRow {
  id: string;
  userId: string | null;
  action: string;
  details: any;
  createdAt: string;
}

// Phase 5: Audit Log viewer. audit_logs.user_id has no FK-based join
// available (kept deliberately loose so a deleted-later account doesn't
// break old log rows), so the caller resolves user_id -> a display name
// itself (e.g. via listStaffAccounts()) rather than this doing a second,
// wider profiles query it doesn't otherwise need.
export async function fetchAuditLogs(storeId: string, limit = 200): Promise<AuditLogRow[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id,user_id,action,details,created_at")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    action: row.action,
    details: row.details,
    createdAt: row.created_at,
  }));
}
export async function fetchLiveStock(storeId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("products_staff_view")
    .select("id,stock_qty")
    .eq("store_id", storeId);
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const row of data || []) map[row.id] = Number(row.stock_qty || 0);
  return map;
}

/**
 * Realtime companion to fetchLiveStock(): fires on every insert/update/delete
 * to this store's products (a sale, purchase, or stock adjustment on *any*
 * device updates stock_qty via its atomic RPC, which this picks up in
 * ~1 second) so every open device's live-stock map stays current without
 * waiting for the slower store_state blob save/load round trip.
 *
 * 2026-09-06: subscribes to `products_staff_view`, not `products` — see the
 * fetchLiveStock comment above. Realtime enforces the same RLS as a normal
 * SELECT, so a staff session subscribing directly to `products` never
 * receives a single event (no error either — it just silently never fires).
 */
export function subscribeToLiveStock(storeId: string, onChange: (productId: string, stockQty: number) => void) {
  const channel = supabase
    .channel(`live-stock-${storeId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "products_staff_view", filter: `store_id=eq.${storeId}` },
      (payload: any) => {
        const row = payload.new || payload.old;
        if (row?.id) onChange(row.id, Number(row.stock_qty || 0));
      }
    )
    .subscribe();
  return channel;
}

/**
 * Phase 1 completion (2026-09-06) — read-side companion to
 * upsertProductCatalog() above. That function already writes the full
 * catalog relationally on every Add/Edit Product save; this is what was
 * explicitly left undone at the time ("the read side still reads from the
 * JSON blob... a full rip-and-replace... not attempted in this pass").
 *
 * Deliberately EXCLUDES cost_price and confidential_price — those stay
 * blob-only/UI-gated exactly as before, untouched by this change, so the
 * existing owner-only / Telegram-approval-gated pricing flows keep working
 * exactly as they do today. This is display-catalog data only (photo, MRP,
 * selling price, warranty, notes, compatible models, screen size, etc.) —
 * the same fields `upsert_product_catalog()` accepts, minus the two
 * confidential price tiers.
 *
 * 2026-09-06: added `selling_price` — this was the one catalog field left
 * reading from the JSON blob after the rest of this migration, so every
 * device still saw a stale selling price until its next full blob sync.
 * Same non-confidential, safe-for-every-role field as everything else here.
 *
 * Keyed by `client_id` (the app's own product.id, which is what every
 * screen actually indexes by) with a `sku` fallback map for the small
 * number of pre-Phase-1 rows that predate client_id backfill.
 */
export interface LiveCatalogEntry {
  sku: string; barcode: string | null; brand: string; category: string;
  mrp: number | null; sellingPrice: number | null; photo: string; warrantyEnabled: boolean; warrantyMonths: number;
  requireCustomerDetails: boolean; supplier: string; notes: string;
  compatibleModels: string[]; screenSizeInches?: number; screenSizeMaxInches?: number;
  isMobilePhone?: boolean; isSparePart?: boolean; minStock: number;
}

function rowToLiveCatalogEntry(row: any): LiveCatalogEntry {
  return {
    sku: row.sku || "",
    barcode: row.barcode ?? null,
    brand: row.brand || "",
    category: row.category || "",
    mrp: row.mrp === null || row.mrp === undefined ? null : Number(row.mrp),
    sellingPrice: row.selling_price === null || row.selling_price === undefined ? null : Number(row.selling_price),
    photo: row.photo || "",
    warrantyEnabled: !!row.warranty_enabled,
    warrantyMonths: Number(row.warranty_months || 0),
    requireCustomerDetails: !!row.require_customer_details,
    supplier: row.supplier || "",
    notes: row.notes || "",
    compatibleModels: Array.isArray(row.compatible_models) ? row.compatible_models : [],
    screenSizeInches: row.screen_size_inches === null || row.screen_size_inches === undefined ? undefined : Number(row.screen_size_inches),
    screenSizeMaxInches: row.screen_size_max_inches === null || row.screen_size_max_inches === undefined ? undefined : Number(row.screen_size_max_inches),
    isMobilePhone: row.is_mobile_phone === null || row.is_mobile_phone === undefined ? undefined : !!row.is_mobile_phone,
    isSparePart: row.is_spare_part === null || row.is_spare_part === undefined ? undefined : !!row.is_spare_part,
    minStock: Number(row.min_stock || 0),
  };
}

const LIVE_CATALOG_COLUMNS =
  "id,client_id,sku,barcode,brand,model,category,mrp,selling_price,photo,warranty_enabled,warranty_months," +
  "require_customer_details,supplier,notes,compatible_models,screen_size_inches,screen_size_max_inches," +
  "is_mobile_phone,is_spare_part,min_stock";

export async function fetchLiveCatalog(storeId: string): Promise<{ byClientId: Record<string, LiveCatalogEntry>; bySku: Record<string, LiveCatalogEntry> }> {
  // 2026-09-06: reads from `products_staff_view`, same reasoning as
  // fetchLiveStock above — `products` has no staff SELECT policy at all, so
  // this silently returned zero rows for every staff session. The mirror
  // carries the exact same LIVE_CATALOG_COLUMNS set (still excluding
  // cost_price/confidential_price), so this is a like-for-like swap.
  const { data, error } = await supabase
    .from("products_staff_view")
    .select(LIVE_CATALOG_COLUMNS)
    .eq("store_id", storeId) as { data: any[] | null; error: any };
  if (error) throw error;
  const byClientId: Record<string, LiveCatalogEntry> = {};
  const bySku: Record<string, LiveCatalogEntry> = {};
  for (const row of data || []) {
    const entry = rowToLiveCatalogEntry(row);
    if (row.client_id) byClientId[row.client_id] = entry;
    else if (row.sku) bySku[row.sku] = entry;
  }
  return { byClientId, bySku };
}

/**
 * Realtime companion to fetchLiveCatalog() — separate channel from
 * subscribeToLiveStock() above (deliberately not merged into it) so this
 * addition can never regress the already-device-tested Phase 1 stock feed;
 * worst case if this one has a bug, stock sync keeps working unaffected.
 *
 * 2026-09-06: subscribes to `products_staff_view`, not `products` — same
 * "staff has no SELECT policy on the base table, so Realtime silently never
 * fires" issue as subscribeToLiveStock above.
 */
export function subscribeToLiveCatalog(storeId: string, onChange: (clientId: string | null, sku: string, entry: LiveCatalogEntry) => void) {
  const channel = supabase
    .channel(`live-catalog-${storeId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "products_staff_view", filter: `store_id=eq.${storeId}` },
      (payload: any) => {
        const row = payload.new || payload.old;
        if (!row) return;
        onChange(row.client_id || null, row.sku || "", rowToLiveCatalogEntry(row));
      }
    )
    .subscribe();
  return channel;
}

/**
 * Phase 1 (continued) — writes a product's FULL catalog (photo, MRP,
 * confidential price, warranty, notes, compatible models, screen size,
 * etc.), not just the minimal scalar fields resolve_product_for_sale
 * captures in passing during a sale/adjustment/purchase. Called by Add/Edit
 * Product on save, in addition to (not instead of) the existing local blob
 * write — the relational row becomes the durable, queryable record; the
 * blob stays the app's fast read cache.
 */
export async function upsertProductCatalog(storeId: string, product: any): Promise<string> {
  const { data, error } = await supabase.rpc("upsert_product_catalog", {
    p_store_id: storeId,
    p_local_id: String(product.id),
    p_sku: product.sku ?? null,
    p_name: product.name ?? null,
    p_brand: product.brand ?? null,
    p_category: product.category ?? null,
    p_barcode: product.barcode ?? null,
    p_photo: product.photo ?? null,
    p_cost_price: product.purchasePrice ?? 0,
    p_confidential_price: product.confidentialPrice ?? null,
    p_selling_price: product.sellingPrice ?? 0,
    p_mrp: product.mrp ?? null,
    p_pending_cost: !!product.pendingCost,
    p_min_stock: product.minStock ?? 0,
    p_warranty_enabled: !!product.warrantyEnabled,
    p_warranty_months: product.warrantyMonths ?? 0,
    p_require_customer_details: !!product.requireCustomerDetails,
    p_supplier: product.supplier ?? null,
    p_notes: product.notes ?? null,
    p_compatible_models: product.compatibleModels ?? [],
    p_screen_size_inches: product.screenSizeInches ?? null,
    p_screen_size_max_inches: product.screenSizeMaxInches ?? null,
    p_is_mobile_phone: !!product.isMobilePhone,
    p_is_spare_part: !!product.isSparePart,
    // 2026-09-06 bug fix (see accompanying migration): only ever used on
    // first-creation INSERT inside the RPC, never on an UPDATE of an
    // existing product — so this can never clobber a stock count that's
    // changed since via a sale/adjustment on another device.
    p_stock_qty: product.stock ?? 0,
  });
  if (error) throw error;
  return data as string;
}

export async function saveCloudState(state: Database, expectedVersion: number) {  const profile = await getCurrentProfile();
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
    // Same class of bug as "sale"/"stock_adjustment" above — a queued
    // purchase's items only ever carry the client-local product id.
    const resolvedItems = await Promise.all((purchase.items || []).map(async (item: any) => {
      const { data: realId, error: resolveError } = await supabase.rpc("resolve_product_for_sale", {
        p_store_id: storeId,
        p_local_id: String(item.productId),
        p_sku: item.sku ?? null,
        p_model: item.name ?? null,
        p_brand: item.brand ?? null,
        p_category: item.category ?? null,
        p_cost_price: item.purchasePrice ?? 0,
        p_selling_price: item.sellingPrice ?? 0,
        p_stock_qty: item.stockAtPurchase ?? 0,
        p_min_stock: item.minStock ?? 0,
      });
      if (resolveError) throw resolveError;
      return { product_id: realId, quantity: item.qty, purchase_price: item.purchasePrice };
    }));
    const { data: purchaseId, error } = await supabase.rpc("atomic_complete_purchase", {
      p_store_id: storeId,
      p_supplier: purchase.supplier || null,
      p_supplier_id: isUuid(purchase.supplierId) ? purchase.supplierId : null,
      p_invoice_ref: purchase.invoiceRef || null,
      p_notes: purchase.notes || null,
      p_payment_status: purchase.paymentStatus || null,
      p_idempotency_key: row.operation_id,
      p_items: resolvedItems,
    });
    if (error) throw error;
    return { serverId: purchaseId };
  }

  if (type === "stock_adjustment") {
    const adj = payload.adjustment || payload;

    // BUG FIX (2026-09-04): adj.productId is the client-local id (e.g.
    // "p_<uuid>") for any product created offline / not yet synced — never
    // a real public.products row. atomic_apply_stock_adjustment's
    // p_product_id is a strict `uuid` column, so passing it straight
    // through failed at the parameter-cast boundary with "invalid input
    // syntax for type uuid" on every single retry (one queued row hit 311
    // attempts, all identical failures) and never actually adjusted stock.
    // Resolve/find-or-create the real product uuid first, same as "sale".
    const { data: realProductId, error: resolveError } = await supabase.rpc("resolve_product_for_sale", {
      p_store_id: storeId,
      p_local_id: String(adj.productId),
      p_sku: adj.sku ?? null,
      p_model: adj.model ?? null,
      p_brand: adj.brand ?? null,
      p_category: adj.category ?? null,
      p_cost_price: adj.costPrice ?? 0,
      p_selling_price: adj.sellingPrice ?? 0,
      p_stock_qty: adj.stockQty ?? 0,
      p_min_stock: adj.minStock ?? 0,
    });
    if (resolveError) throw resolveError;

    const { data: movementId, error } = await supabase.rpc("atomic_apply_stock_adjustment", {
      p_store_id: storeId,
      p_product_id: realProductId,
      p_delta: adj.delta,
      p_reason: adj.reason || null,
      p_idempotency_key: row.operation_id,
    });
    if (error) throw error;
    return { serverId: movementId };
  }

  if (type === "product") {
    // Offline-queued Add/Edit Product catalog write (see
    // upsertProductCatalog) — replayed once connectivity returns.
    const product = payload.product || payload;
    const id = await upsertProductCatalog(storeId, product);
    return { serverId: id };
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

let flushInFlight: Promise<{ processed: number; failed: number }> | null = null;

export async function flushOfflineQueue() {
  // Prevent concurrent flushes from anywhere in the app (bootstrap, the
  // periodic background timer, tab-resume, and the manual "Retry Sync"
  // button all call this independently with no shared guard before this
  // fix). Racing flushes could both read the same store_state version for
  // a queued 'snapshot' row and both attempt to save it -- one would win,
  // the other would fail as VERSION_CONFLICT and sit there to be retried
  // forever on the next cycle, indefinitely re-attempting to overwrite
  // live data with an old full-state payload. Callers now just await
  // whichever flush is already running instead of starting a second one.
  if (flushInFlight) return flushInFlight;
  flushInFlight = flushOfflineQueueInner().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function flushOfflineQueueInner() {
  const profile = await getCurrentProfile();
  if (!profile?.store_id) return { processed: 0, failed: 0 };

  // BUG FIX (2026-09-04): a row is marked "syncing" the instant a flush
  // attempt starts (see markSync below), *before* the RPC call — if the
  // app/tab closes, crashes, or loses network at exactly that moment, the
  // row never reaches "processed" or "failed" and was permanently orphaned,
  // since this query used to only look at "pending"/"failed". Live data
  // showed 83 rows stuck this way, some untouched for hours. A genuinely
  // in-flight row's last_attempt_at is only ever a few seconds old, so
  // treating "syncing" rows stuck for 2+ minutes as abandoned and re-queuing
  // them is safe — every operation here is idempotent (idempotency_key).
  const staleThreshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from("sync_queue")
    .select("id,operation_id,operation,operation_type,entity,payload,retry_count,attempts,status,last_attempt_at")
    .eq("store_id", profile.store_id)
    .or(`status.in.(pending,failed),and(status.eq.syncing,last_attempt_at.lt.${staleThreshold})`)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) throw error;

  // A row that has failed this many times in a row is treated as permanently
  // broken (e.g. a sale referencing a product record that's missing data it
  // needs to resolve, or a stale full-state snapshot that will never stop
  // conflicting) rather than retried forever. It's marked "abandoned" (kept
  // for a human to look at, but excluded from the query above going
  // forward) instead of silently retrying on every sync cycle indefinitely.
  const MAX_RETRIES = 20;

  let processed = 0, failed = 0;
  for (const row of rows || []) {
    if (Number(row.retry_count || 0) >= MAX_RETRIES) {
      const giveUpNote = `Gave up after ${MAX_RETRIES} failed attempts — needs manual review.`;
      try {
        await markSync(row.id, { status: "abandoned", last_error: giveUpNote });
      } catch {
        // status.in.(...) filters this query by "pending"/"failed"/stale-"syncing"
        // only, so if the DB's status CHECK constraint doesn't (yet) allow
        // "abandoned" and this write rejects, falling back to "failed" here
        // would put the row right back in front of this same MAX_RETRIES gate
        // next cycle -- which correctly skips it again without ever calling
        // processOperation, so it still stops hammering the DB.
        await markSync(row.id, { status: "failed", last_error: giveUpNote }).catch(() => {});
      }
      failed++;
      continue;
    }
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
