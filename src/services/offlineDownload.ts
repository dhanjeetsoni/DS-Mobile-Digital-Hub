// Step 3.5 — Offline-First Data Sync: "Download Area".
//
// Everything else in the app was already "offline-tolerant" by accident:
// the last-loaded store_state gets cached in localStorage (repository.ts),
// and writes made while offline queue into the local sql.js DB
// (localSqlite.ts) and replay once the connection returns. What was
// missing was (a) an explicit, staff-visible action to *guarantee* the
// device is offline-ready before the staff member walks into a dead zone,
// and (b) product photos, which live on Supabase Storage and were never
// cached at all — see the public/sw.js rewrite for why.
//
// This module is the glue: it reads the current Database, finds every
// photo that needs caching, and drives the service worker's message API
// to fetch + store them, reporting progress back to DownloadAreaView.

import type { Database } from "../types";
import { isStorageUrl } from "./photoStorage";
import { sqliteList } from "./localSqlite";

const LAST_DOWNLOAD_KEY = "dsmdh_last_offline_download_at";

export interface PrecacheProgress {
  done: number;
  failed: number;
  total: number;
}

export interface OfflineStatus {
  photosCached: number;
  photosTotal: number;
  pendingQueueCount: number;
  lastDownloadAt: string | null;
  storageUsedMb: number | null;
  storageQuotaMb: number | null;
  serviceWorkerReady: boolean;
}

/** Every distinct Supabase Storage photo URL currently referenced by this store's data. */
export function collectPhotoUrls(db: Database): string[] {
  const urls = new Set<string>();
  for (const p of db.products || []) {
    if (isStorageUrl(p.photo)) urls.add(p.photo as string);
  }
  return Array.from(urls);
}

function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.ready.then((r) => r).catch(() => null);
}

function messageWorker<T>(payload: Record<string, unknown>, onMessage?: (data: any) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
      reject(new Error("Offline download service abhi ready nahi hai — page ek baar reload karein."));
      return;
    }
    const requestId = crypto.randomUUID();
    const handleMessage = (event: MessageEvent) => {
      const data = event.data || {};
      if (data.requestId !== requestId) return;
      onMessage?.(data);
      if (data.type === "PRECACHE_DONE" || data.type === "CACHE_STATUS_RESULT" || data.type === "CLEAR_PHOTO_CACHE_DONE") {
        navigator.serviceWorker.removeEventListener("message", handleMessage);
        resolve(data as T);
      }
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);
    navigator.serviceWorker.controller.postMessage({ ...payload, requestId });
  });
}

/**
 * Downloads (caches) every product photo for offline viewing. Resolves once
 * every URL has been attempted — some may fail (e.g. genuinely unreachable)
 * without aborting the rest. Also stamps the "last downloaded" timestamp
 * used by the status panel and (best-effort) the Owner's Staff Access view.
 */
export async function downloadPhotosForOffline(
  db: Database,
  onProgress?: (progress: PrecacheProgress) => void
): Promise<PrecacheProgress> {
  const urls = collectPhotoUrls(db);
  if (urls.length === 0) {
    const empty = { done: 0, failed: 0, total: 0 };
    onProgress?.(empty);
    localStorage.setItem(LAST_DOWNLOAD_KEY, new Date().toISOString());
    return empty;
  }
  const result = await messageWorker<{ done: number; failed: number; total: number }>(
    { type: "PRECACHE_PHOTOS", urls },
    (data) => {
      if (data.type === "PRECACHE_PROGRESS") onProgress?.({ done: data.done, failed: data.failed, total: data.total });
    }
  );
  localStorage.setItem(LAST_DOWNLOAD_KEY, new Date().toISOString());
  return { done: result.done, failed: result.failed, total: result.total };
}

export async function clearDownloadedPhotos(): Promise<void> {
  await messageWorker({ type: "CLEAR_PHOTO_CACHE" });
  localStorage.removeItem(LAST_DOWNLOAD_KEY);
}

export async function getOfflineStatus(db: Database): Promise<OfflineStatus> {
  const photosTotal = collectPhotoUrls(db).length;
  const registration = await getRegistration();
  const serviceWorkerReady = Boolean(registration && navigator.serviceWorker.controller);

  let photosCached = 0;
  if (serviceWorkerReady) {
    try {
      const result = await messageWorker<{ photosCached: number }>({ type: "CACHE_STATUS" });
      photosCached = result.photosCached || 0;
    } catch {
      // worker not controlling yet (first load) — treat as 0 cached, not an error
    }
  }

  let pendingQueueCount = 0;
  try {
    pendingQueueCount = (await sqliteList()).length;
  } catch {
    // sql.js not initialised yet — fine, just report 0
  }

  let storageUsedMb: number | null = null;
  let storageQuotaMb: number | null = null;
  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      storageUsedMb = estimate.usage != null ? Math.round((estimate.usage / (1024 * 1024)) * 10) / 10 : null;
      storageQuotaMb = estimate.quota != null ? Math.round(estimate.quota / (1024 * 1024)) : null;
    } catch {
      // storage estimate not supported — leave null, UI shows "—"
    }
  }

  return {
    photosCached,
    photosTotal,
    pendingQueueCount,
    lastDownloadAt: localStorage.getItem(LAST_DOWNLOAD_KEY),
    storageUsedMb,
    storageQuotaMb,
    serviceWorkerReady,
  };
}
