// KYC photo capture (ID proof / Aadhaar photo + seller's face photo) for
// SecondHandKYC.docPhoto / SecondHandKYC.sellerPhoto.
//
// Deliberately NOT the same pattern as photoStorage.ts (product photos):
// these are sensitive personal documents, so they go to the PRIVATE R2
// bucket (`ds-mobile-digital-hub-private`, kind "kyc" in r2-storage). This
// service stores just the object PATH (e.g. "store123/doc-kyc456-171234.jpg")
// in the KYC record instead of a public URL, and callers must ask for an
// authenticated blob: URL to actually display the image
// (getKycPhotoSignedUrl — name kept for compatibility with call sites,
// even though it's now a blob: URL fetched with the caller's session
// rather than a Supabase "signed URL"). If cloud upload isn't possible
// (offline / not configured) it falls back to embedding a compressed
// data: URL directly, exactly like the product-photo path does — the
// feature never blocks a buyback from being completed.
import { isCloudConfigured } from "./supabaseClient";
import { compressImageToBlob } from "../utils/imageCompress";
import { r2Upload, r2FetchPrivateAsBlobUrl, r2Delete } from "./r2Client";

const KIND = "kyc" as const;
export type KycPhotoKind = "doc" | "seller";

// A stored value is either a data: URL (offline fallback, already directly
// renderable) or a bucket object path (needs an authenticated fetch to render).
export function isKycStoragePath(value: string | undefined | null): boolean {
  return !!value && !value.startsWith("data:");
}

export async function uploadKycPhotoBlob(
  storeId: string,
  kycId: string,
  kind: KycPhotoKind,
  blob: Blob
): Promise<string> {
  const filename = `${kind}-${kycId}-${Date.now()}.jpg`;
  return r2Upload(KIND, storeId, filename, blob, "image/jpeg");
}

// Compress + upload in one call. Returns either a storage path (uploaded)
// or a data: URL (fallback) — isKycStoragePath tells the caller which.
export async function uploadKycPhotoOrFallback(
  storeId: string | undefined,
  kycId: string,
  kind: KycPhotoKind,
  file: File | Blob
): Promise<{ value: string; uploaded: boolean }> {
  const blob = await compressImageToBlob(file);
  if (!isCloudConfigured || !storeId) {
    return { value: await blobToDataUrl(blob), uploaded: false };
  }
  try {
    const path = await uploadKycPhotoBlob(storeId, kycId, kind, blob);
    return { value: path, uploaded: true };
  } catch {
    return { value: await blobToDataUrl(blob), uploaded: false };
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

// Authenticated fetch of a private KYC photo, returned as a local blob: URL
// for display (voucher view/print). Returns null on any failure (offline,
// denied, deleted file, etc.) — callers should just skip rendering the
// image rather than throwing, since a missing photo shouldn't block
// viewing/printing the rest of the voucher.
export async function getKycPhotoSignedUrl(path: string): Promise<string | null> {
  if (!isKycStoragePath(path) || !isCloudConfigured) return null;
  return r2FetchPrivateAsBlobUrl(KIND, path);
}

// Best-effort delete (e.g. user removes/replaces a photo before saving).
export async function deleteKycPhotoByPath(path: string | undefined): Promise<void> {
  if (!isKycStoragePath(path)) return;
  await r2Delete(KIND, path!);
}
