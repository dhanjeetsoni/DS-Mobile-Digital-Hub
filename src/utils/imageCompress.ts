// Compresses a photo (from camera or gallery) into a small JPEG data URL
// before it is ever stored. This is what makes it safe to keep a permanent
// product photo inside the synced app state (db.products[].photo) instead of
// bloating every save/sync with multi-MB camera originals.
//
// Used for:
//  1) The permanent product photo (AddProductModal / EditProductModal)
//  2) The same compressed image is what gets sent to the AI scanner —
//     so "one photo" serves both purposes, exactly once, with no separate
//     raw upload ever touching storage.

export interface CompressOptions {
  maxDimension?: number; // longest side, px
  quality?: number;      // 0..1 initial JPEG quality
  maxBytes?: number;     // hard cap; quality is stepped down until under this
}

// Tuned so a full-size phone camera photo (12MP+, often 3-15MB, sometimes
// sideways because of EXIF rotation) still ends up small AND legible —
// price tags / model numbers / labels in the photo should stay readable
// after compression, not turn into mush. See compressToCanvas for the
// two-stage strategy (quality first, then dimension) that keeps it that way.
const DEFAULTS: Required<CompressOptions> = {
  maxDimension: 1280,
  quality: 0.8,
  maxBytes: 220 * 1024, // ~220KB — sharp enough to read small print, still tiny for sync
};

const MIN_QUALITY = 0.5; // below this, text starts smearing — shrink dimension instead of dropping further
const MIN_DIMENSION = 480; // never go below this even for a huge/noisy original — stays readable

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Photo load fail ho gaya"));
    img.src = src;
  });
}

function readFileAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("File read fail ho gaya"));
    reader.readAsDataURL(file);
  });
}

// Decodes the source file into something we can draw to a canvas, correcting
// for EXIF orientation along the way. Phones (Android + iPhone) very often
// save camera shots with the pixels in landscape plus an EXIF "rotate 90°"
// tag — plain `new Image()` + canvas ignores that tag, so without this the
// compressed photo can come out sideways, which is the #1 real-world cause
// of an "unreadable" product photo, not compression quality.
//
// createImageBitmap with imageOrientation:"from-image" applies that tag for
// us and decodes off the main thread — it's also far more memory-efficient
// for a 10-15MB camera original than round-tripping through a base64 data
// URL. Falls back to the old Image()-based path on older WebViews that
// don't support it (orientation may be off there, but it still works).
async function decodeSource(file: File | Blob): Promise<{
  draw: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { draw: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // fall through to the Image()-based path below (e.g. HEIC the browser can't decode,
      // or an old WebView without createImageBitmap options support)
    }
  }
  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(rawDataUrl);
  return { draw: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
}

function drawAtSize(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  targetLongSide: number
): HTMLCanvasElement {
  const scale = Math.min(1, targetLongSide / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
  }
  return canvas;
}

// Resizes + JPEG-compresses the given file/blob onto an in-memory canvas —
// works no matter how large the original is (any phone resolution, any file
// size), and stays legible by favouring a smaller-but-crisper image over a
// full-size-but-mushy one:
//   1) draw at maxDimension, step quality down (never below MIN_QUALITY);
//   2) if it's STILL over maxBytes at the quality floor (huge/busy photo),
//      shrink the dimension instead and retry — small and sharp beats
//      full-size and blurry for reading text/labels.
// Shared by both output helpers below so the data: URL (used transiently for
// the AI scanner) and the Blob (uploaded to Supabase Storage) are pixel-identical.
async function compressToCanvas(
  file: File | Blob,
  opts: CompressOptions
): Promise<{ canvas: HTMLCanvasElement; quality: number }> {
  const { maxDimension, quality, maxBytes } = { ...DEFAULTS, ...opts };
  const source = await decodeSource(file);
  try {
    let dimension = maxDimension;
    let canvas = drawAtSize(source.draw, source.width, source.height, dimension);
    let q = quality;
    let out = canvas.toDataURL("image/jpeg", q);

    let guard = 0;
    while (out.length * 0.75 > maxBytes && guard < 10) {
      if (q > MIN_QUALITY) {
        q -= 0.1;
      } else if (dimension > MIN_DIMENSION) {
        // quality floor reached and it's still too big — the photo itself
        // is huge/detailed, so shrink it instead of degrading it further
        dimension = Math.max(MIN_DIMENSION, Math.round(dimension * 0.85));
        canvas = drawAtSize(source.draw, source.width, source.height, dimension);
        q = quality; // give the smaller canvas a fresh shot at good quality
      } else {
        break; // hit both floors — ship what we have rather than loop forever
      }
      out = canvas.toDataURL("image/jpeg", q);
      guard++;
    }
    return { canvas, quality: q };
  } finally {
    source.close?.();
  }
}

// Returns a compressed data: URL. Used ONLY for things that need the bytes
// inline in memory right now (feeding the AI OCR scanner) — no longer used
// to build the permanent value stored on a product/record, since a data:
// URL embedded in synced JSON state re-uploads the full image on every
// unrelated save (see compressImageToBlob below for the replacement path).
export async function compressImageToDataUrl(
  file: File | Blob,
  opts: CompressOptions = {}
): Promise<string> {
  try {
    const { canvas, quality } = await compressToCanvas(file, opts);
    return canvas.toDataURL("image/jpeg", quality);
  } catch (err) {
    throw friendlyDecodeError(file, err);
  }
}

// Returns a compressed JPEG Blob, ready to hand to Supabase Storage's
// upload(). This is the permanent-photo path: the Blob goes to the
// `product-photos` bucket and only the short resulting URL is ever stored
// in the synced JSON state, instead of the multi-KB base64 string itself.
export async function compressImageToBlob(
  file: File | Blob,
  opts: CompressOptions = {}
): Promise<Blob> {
  try {
    const { canvas, quality } = await compressToCanvas(file, opts);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (!blob) throw new Error("Photo compress karte waqt fail ho gaya");
    return blob;
  } catch (err) {
    throw friendlyDecodeError(file, err);
  }
}

// Most real-world decode failures on a phone are an iPhone photo saved as
// HEIC/HEIF (Camera app default under Settings > Camera > Formats > "High
// Efficiency") — browsers generally can't decode that format at all, with or
// without this app's help. Everything else about "any size photo" already
// just works (see decodeSource/compressToCanvas above), so surface the one
// failure mode that's actually a device setting, not a bug here.
function friendlyDecodeError(file: File | Blob, err: unknown): Error {
  const name = file instanceof File ? file.name.toLowerCase() : "";
  const type = (file.type || "").toLowerCase();
  if (name.endsWith(".heic") || name.endsWith(".heif") || type.includes("heic") || type.includes("heif")) {
    return new Error(
      "Ye HEIC/HEIF photo hai jo browser padh nahi sakta. iPhone mein Settings → Camera → Formats → \"Most Compatible\" karke dobara try karein, ya gallery se JPEG/PNG photo chunein."
    );
  }
  return err instanceof Error ? err : new Error("Photo process nahi ho payi, dobara try karein");
}

// Rough estimate of a data URL's byte size, for showing a friendly "≈45 KB" hint.
export function estimateDataUrlBytes(dataUrl: string): number {
  return Math.round((dataUrl.length * 3) / 4);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
