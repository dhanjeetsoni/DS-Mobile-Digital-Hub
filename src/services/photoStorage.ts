// Architecture: product photos used to be stored as compressed base64 JPEG
// strings directly inside Product.photo, which lives inside the single
// store_state JSON blob that syncs on every save. That meant editing one
// product's stock count re-uploaded every product's photo, every time —
// slow and failure-prone on weak mobile data.
//
// STEP 7.1 update: this now uploads to Cloudflare R2 (via the r2-storage
// edge function — see services/r2Client.ts) instead of Supabase Storage.
// Supabase keeps text data only; heavy files (this) live in Cloudflare.
// The caller still just stores the returned URL string in Product.photo —
// nothing downstream that reads product.photo (invoices, barcode labels,
// product cards) needed to change.
import { isCloudConfigured } from "./supabaseClient";
import { compressImageToBlob } from "../utils/imageCompress";
import { Database, Product } from "../types";
import { r2Upload, r2PublicUrl, r2Delete } from "./r2Client";

const KIND = "product" as const;

// Step 7.2 — Delete Policy: a product's photo is auto-cleaned only after
// it has been continuously out of stock for this many days. The product
// record itself is never touched — only the (potentially large) photo
// file, to keep R2 storage usage down. `outOfStockSince` is maintained by
// utils/outOfStockTracker.ts on every save.
const OUT_OF_STOCK_PHOTO_CLEANUP_DAYS = 90;

export function isStorageUrl(value: string | undefined | null): boolean {
  return !!value && !value.startsWith("data:");
}

// Uploads one already-compressed Blob for a given store+product and returns
// its (public, no-auth-needed) URL. Throws on failure (offline, denied,
// etc.) — callers decide the fallback (see uploadProductPhotoOrFallback).
export async function uploadProductPhotoBlob(
  storeId: string,
  productId: string,
  blob: Blob
): Promise<string> {
  const filename = `${productId}-${Date.now()}.jpg`;
  const path = await r2Upload(KIND, storeId, filename, blob, "image/jpeg");
  return r2PublicUrl(KIND, path);
}

// Compress + upload in one call. If cloud isn't configured or the upload
// fails (offline, not logged in yet, etc.), falls back to the old
// data-URL-in-state behaviour so the photo feature never breaks — it just
// stays "unmigrated" for that one photo until the next successful sync,
// when the background backfill below picks it up.
export async function uploadProductPhotoOrFallback(
  storeId: string | undefined,
  productId: string,
  file: File | Blob
): Promise<{ url: string; uploaded: boolean }> {
  const blob = await compressImageToBlob(file);
  if (!isCloudConfigured || !storeId) {
    return { url: await blobToDataUrl(blob), uploaded: false };
  }
  try {
    const url = await uploadProductPhotoBlob(storeId, productId, blob);
    return { url, uploaded: true };
  } catch {
    return { url: await blobToDataUrl(blob), uploaded: false };
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Photo read fail ho gaya"));
    reader.readAsDataURL(blob);
  });
}

// Best-effort delete of a previously-uploaded photo (e.g. when a product's
// photo is replaced or removed). Never throws — an orphaned file in R2
// costs a few KB and is not worth failing the user's save over.
export async function deleteProductPhotoByUrl(url: string | undefined): Promise<void> {
  if (!isStorageUrl(url)) return;
  try {
    const marker = `/${KIND}/`;
    const idx = url!.indexOf(marker);
    if (idx === -1) return;
    const path = decodeURIComponent(url!.slice(idx + marker.length).split("?")[0]);
    await r2Delete(KIND, path);
  } catch {
    // best-effort — ignore
  }
}

// Step 7.2 — Delete Policy: finds every product that has been
// continuously out of stock for 90+ days and still has a real (R2-hosted,
// non-data-URL) photo, deletes just that photo file from R2, and returns
// which product IDs were cleaned so the caller can clear `photo` on those
// products and save. Best-effort per-product — one failed delete (e.g.
// offline mid-loop) never stops the rest, and this never touches the
// product record itself, matching the plan's "photo cleanup, not product
// deletion" wording.
export async function cleanupStaleOutOfStockPhotos(
  storeId: string | undefined,
  products: Product[]
): Promise<string[]> {
  if (!isCloudConfigured || !storeId) return [];
  const cutoffMs = Date.now() - OUT_OF_STOCK_PHOTO_CLEANUP_DAYS * 24 * 60 * 60 * 1000;
  const stale = products.filter((p) => {
    if (p.stock > 0 || !p.outOfStockSince || !isStorageUrl(p.photo)) return false;
    const since = new Date(p.outOfStockSince).getTime();
    return Number.isFinite(since) && since <= cutoffMs;
  });
  const cleanedIds: string[] = [];
  for (const p of stale) {
    try {
      await deleteProductPhotoByUrl(p.photo);
      cleanedIds.push(p.id);
    } catch {
      // best-effort — try this one again on the next daily pass
    }
  }
  return cleanedIds;
}

// Backfill: on any store that still has legacy base64 photos sitting in
// state (from before this migration, or saved while offline), upload them
// one at a time in the background and replace the field with the resulting
// URL. Called opportunistically whenever the app is online and idle (see
// App.tsx's connectivity-sync effect) — never blocks the UI, never runs
// more than one upload at a time, and gives up quietly on any single photo
// that fails so one bad image can't stall the rest.
let backfillRunning = false;
export async function backfillLegacyProductPhotos(
  storeId: string | undefined,
  db: Database,
  onProductPhotoMigrated: (productId: string, url: string) => void
): Promise<void> {
  if (!isCloudConfigured || !storeId || backfillRunning) return;
  const pending = (db.products || []).filter((p) => p.photo && p.photo.startsWith("data:"));
  if (!pending.length) return;
  backfillRunning = true;
  try {
    for (const product of pending) {
      try {
        const res = await fetch(product.photo);
        const blob = await res.blob();
        const url = await uploadProductPhotoBlob(storeId, product.id, blob);
        onProductPhotoMigrated(product.id, url);
      } catch {
        // leave this one as data: URL — will retry on the next backfill pass
      }
    }
  } finally {
    backfillRunning = false;
  }
}
