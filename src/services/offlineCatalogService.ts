import { supabase } from "./supabaseClient";
import type { Product } from "../types";

export interface CatalogDownloadMeta {
  lastDownloadedAt: string | null;
  itemCount: number;
  categoriesCount: number;
  sizeBytes: number;
  status: "cached" | "empty" | "downloading";
}

// A single atomic cache record prevents metadata from describing a different snapshot.
const CACHE_PREFIX = "dsmdh_offline_catalog_v2:";
export interface CatalogScope { storeId: string; profileId: string }
interface CatalogSnapshot { products: Partial<Product>[]; meta: CatalogDownloadMeta }
const emptyMeta = (): CatalogDownloadMeta => ({
  lastDownloadedAt: null, itemCount: 0, categoriesCount: 0, sizeBytes: 0, status: "empty",
});
const cacheKey = (scope: CatalogScope) => CACHE_PREFIX + encodeURIComponent(scope.storeId) + ":" + encodeURIComponent(scope.profileId);
function readSnapshot(scope?: CatalogScope | null): CatalogSnapshot | null {
  if (!scope?.storeId || !scope.profileId) return null;
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey(scope)) || "null");
    return value && Array.isArray(value.products) && value.meta?.itemCount === value.products.length ? value : null;
  } catch { return null; }
}
export function getOfflineCatalogMeta(scope?: CatalogScope | null): CatalogDownloadMeta {
  return readSnapshot(scope)?.meta ?? emptyMeta();
}
async function assertCurrentProfile(scope: CatalogScope) {
  const { data, error } = await supabase.auth.getSession();
  if (error || data.session?.user.id !== scope.profileId) throw new Error("Account changed. Sign in again before downloading.");
}

export async function downloadFullCatalogForOffline(
  scope: CatalogScope,
  onProgress?: (step: string, percent: number) => void
): Promise<{ success: boolean; itemCount: number; message: string }> {
  try {
    onProgress?.("Connecting to cloud server...", 10);

    if (!scope.storeId || !scope.profileId) throw new Error("Sign in to download the catalog.");
    await assertCurrentProfile(scope);
    // Only the staff-safe projection. Never fall back to the private products table.
    onProgress?.("Downloading product catalog...", 30);
    const catalogRows: any[] = [];
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from("products_staff_view")
        .select("*").eq("store_id", scope.storeId).order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error || !data) throw new Error(error?.message || "Catalog download returned no response.");
      catalogRows.push(...data);
      if (data.length < pageSize) break;
    }
    await assertCurrentProfile(scope);

    onProgress?.(`Processing ${catalogRows.length} catalog items...`, 60);

    // Group categories
    const categoriesSet = new Set<string>();
    const normalizedProducts: Partial<Product>[] = catalogRows.map((r: any) => {
      const cat = r.category || "General";
      categoriesSet.add(cat);
      return {
        id: r.client_id || r.id,
        name: r.model || r.brand || "Product",
        category: cat,
        brand: r.brand || "",
        model: r.model || "",
        sku: r.sku || "",
        barcode: r.barcode || "",
        sellingPrice: Number(r.selling_price || 0),
        mrp: Number(r.mrp || 0),
        costPrice: 0, // safe
        stock: Number(r.stock_qty || 0),
        photo: r.photo || "",
        warrantyEnabled: !!r.warranty_enabled,
        warrantyMonths: Number(r.warranty_months || 0),
        compatibleModels: Array.isArray(r.compatible_models) ? r.compatible_models : [],
        screenSizeInches: r.screen_size_inches ? Number(r.screen_size_inches) : undefined,
        screenSizeMaxInches: r.screen_size_max_inches ? Number(r.screen_size_max_inches) : undefined,
        isMobilePhone: !!r.is_mobile_phone,
        isSparePart: !!r.is_spare_part,
        supplier: r.supplier || "",
        notes: r.notes || "",
        customTerms: r.custom_terms || undefined,
        customQuote: r.custom_quote || undefined,
      };
    });

    onProgress?.("Saving the catalog to this device...", 85);
    const save = (products: Partial<Product>[]) => {
      const meta: CatalogDownloadMeta = {
        lastDownloadedAt: new Date().toISOString(),
        itemCount: products.length,
        categoriesCount: categoriesSet.size,
        sizeBytes: JSON.stringify(products).length * 2,
        status: products.length ? "cached" : "empty",
      };
      localStorage.setItem(cacheKey(scope), JSON.stringify({ products, meta }));
    };
    let photosOmitted = false;
    try { save(normalizedProducts); }
    catch {
      save(normalizedProducts.map(p => ({ ...p, photo: "" })));
      photosOmitted = true;
    }
    onProgress?.("Catalog records saved.", 100);
    return {
      success: true,
      itemCount: normalizedProducts.length,
      message: `Saved ${normalizedProducts.length} catalog items (${categoriesSet.size} categories).${photosOmitted ? " Photo references omitted due to storage limits." : ""} Download photos separately for offline viewing.`,
    };
  } catch (err: any) {
    console.error("Failed to download catalog:", err);
    return {
      success: false,
      itemCount: 0,
      message: err?.message || "Failed to download catalog for offline use.",
    };
  }
}

export function getCachedOfflineCatalog(scope?: CatalogScope | null): Partial<Product>[] | null {
  return readSnapshot(scope)?.products ?? null;
}
export function clearOfflineCatalogCache(scope?: CatalogScope | null) {
  if (scope?.storeId && scope.profileId) localStorage.removeItem(cacheKey(scope));
}
