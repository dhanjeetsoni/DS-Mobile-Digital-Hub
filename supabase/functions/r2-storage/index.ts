import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// STEP 7.1 — Storage Split (see DS_Mobile_Master_Plan.md).
//
// Heavy files (product photos, KYC photos, box-scan images, invoice PDFs)
// now live in Cloudflare R2, not Supabase Storage. Supabase keeps only text
// data (this function's job is just glue code — no file bytes are stored
// in the Supabase project itself).
//
// Why an edge function and not a direct-from-browser upload to R2:
// R2 has no per-user/RLS-style access control like Supabase Storage does,
// so the R2 account credentials can never reach the browser. This function
// holds those credentials (as Edge Function secrets) and does two things:
//   1. Checks the caller's Supabase session + store_id before touching R2
//      (same access boundary the old Supabase Storage RLS policies gave us).
//   2. Signs and forwards the request to R2's S3-compatible API using
//      AWS SigV4 (implemented by hand below — no aws-sdk dependency needed
//      for simple PUT/GET/DELETE against a known bucket+key).
//
// URL shape:  /r2-storage/<kind>/<storeId>/<filename...>
//   kind = "product" | "boxscan" | "invoice"  -> public-style bucket, no
//          auth required to GET (matches the old public bucket behaviour —
//          these are already shown on invoices/labels), auth required to
//          PUT/DELETE.
//   kind = "kyc" -> private bucket, auth + store match required for BOTH
//          GET and PUT/DELETE (Aadhaar/ID photos are sensitive).
//   kind = "app" -> Step 12 (App Update & OTA Push). Public-style bucket,
//          same as product/boxscan/invoice: installer/.apk downloads must
//          work with no auth (a fresh install checking for updates has no
//          session yet), auth required to PUT (only the uploading Owner's
//          own store namespace, exactly like every other kind — the
//          app_versions table in Supabase is what actually gates who is
//          allowed to mark a build "live" for everyone, this Edge Function
//          only gates who can write bytes to this path).

const CF_ACCOUNT_ID = Deno.env.get("CF_ACCOUNT_ID") || "";
const CF_ACCESS_KEY_ID = Deno.env.get("CF_R2_ACCESS_KEY_ID") || "";
const CF_SECRET_ACCESS_KEY = Deno.env.get("CF_R2_SECRET_ACCESS_KEY") || "";
const CF_BUCKET_PUBLIC = Deno.env.get("CF_R2_BUCKET_PUBLIC") || "ds-mobile-digital-hub";
const CF_BUCKET_PRIVATE = Deno.env.get("CF_R2_BUCKET_PRIVATE") || "ds-mobile-digital-hub-private";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
};

const PRIVATE_KINDS = new Set(["kyc"]);
const VALID_KINDS = new Set(["product", "boxscan", "invoice", "kyc", "app"]);

// Step 7.3 — Storage Usage Meter. Not a real storage "kind", just a
// second URL shape this same function understands: GET /usage/<storeId>.

function bucketFor(kind: string): string {
  return PRIVATE_KINDS.has(kind) ? CF_BUCKET_PRIVATE : CF_BUCKET_PUBLIC;
}

function isConfigured(): boolean {
  return Boolean(CF_ACCOUNT_ID && CF_ACCESS_KEY_ID && CF_SECRET_ACCESS_KEY);
}

// ---------- minimal AWS SigV4 signer (R2 is S3-API compatible) ----------

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacRaw(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(msg));
}

async function sha256Hex(msg: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg)));
}

function amzDateNow(): { amzDate: string; dateStamp: string } {
  const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/** Signs + sends a request straight to R2's S3-compatible endpoint. Body is streamed through unread (UNSIGNED-PAYLOAD) so uploads never get buffered in memory here. */
async function r2Fetch(method: "PUT" | "GET" | "DELETE", bucket: string, key: string, opts: { body?: BodyInit | null; contentType?: string } = {}): Promise<Response> {
  const host = `${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const region = "auto";
  const service = "s3";
  const { amzDate, dateStamp } = amzDateNow();
  const canonicalUri = "/" + bucket + "/" + key.split("/").map(encodeURIComponent).join("/");
  const payloadHash = "UNSIGNED-PAYLOAD";

  const headersToSign: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (method === "PUT" && opts.contentType) headersToSign["content-type"] = opts.contentType;

  const sortedKeys = Object.keys(headersToSign).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headersToSign[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");

  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

  let signingKey: ArrayBuffer | Uint8Array = new TextEncoder().encode("AWS4" + CF_SECRET_ACCESS_KEY);
  signingKey = await hmacRaw(signingKey, dateStamp);
  signingKey = await hmacRaw(signingKey, region);
  signingKey = await hmacRaw(signingKey, service);
  signingKey = await hmacRaw(signingKey, "aws4_request");
  const signature = toHex(await hmacRaw(signingKey, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${CF_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const fetchHeaders: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization: authorization,
  };
  if (method === "PUT" && opts.contentType) fetchHeaders["content-type"] = opts.contentType;

  return fetch(`https://${host}${canonicalUri}`, { method, headers: fetchHeaders, body: opts.body ?? undefined });
}

/** Lists objects under `${storeId}/` in a bucket via R2's S3-compatible ListObjectsV2, paging through all continuation tokens, and returns total byte count + object count. Used only by the Step 7.3 usage route — never exposed to clients directly (they only see the summed totals). */
async function r2ListPrefixTotal(bucket: string, prefix: string): Promise<{ bytes: number; count: number }> {
  const host = `${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const region = "auto";
  const service = "s3";
  let bytes = 0;
  let count = 0;
  let continuationToken: string | null = null;

  do {
    const { amzDate, dateStamp } = amzDateNow();
    const canonicalUri = "/" + bucket + "/";
    const queryParams: Record<string, string> = {
      "list-type": "2",
      prefix,
      "max-keys": "1000",
    };
    if (continuationToken) queryParams["continuation-token"] = continuationToken;
    const sortedQueryKeys = Object.keys(queryParams).sort();
    const canonicalQuery = sortedQueryKeys
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
      .join("&");
    const payloadHash = await sha256Hex("");

    const headersToSign: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    const sortedHeaderKeys = Object.keys(headersToSign).sort();
    const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headersToSign[k]}\n`).join("");
    const signedHeaders = sortedHeaderKeys.join(";");

    const canonicalRequest = ["GET", canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

    let signingKey: ArrayBuffer | Uint8Array = new TextEncoder().encode("AWS4" + CF_SECRET_ACCESS_KEY);
    signingKey = await hmacRaw(signingKey, dateStamp);
    signingKey = await hmacRaw(signingKey, region);
    signingKey = await hmacRaw(signingKey, service);
    signingKey = await hmacRaw(signingKey, "aws4_request");
    const signature = toHex(await hmacRaw(signingKey, stringToSign));

    const authorization = `AWS4-HMAC-SHA256 Credential=${CF_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(`https://${host}${canonicalUri}?${canonicalQuery}`, {
      method: "GET",
      headers: { "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, Authorization: authorization },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`R2 list failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const xml = await res.text();
    for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) {
      bytes += Number(m[1]) || 0;
      count += 1;
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const tokenMatch = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/);
    continuationToken = truncated && tokenMatch ? tokenMatch[1] : null;
  } while (continuationToken);

  return { bytes, count };
}

// ---------- auth: who is calling, which store do they belong to ----------

async function getCallerStoreId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt || !SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return null;
  const { data: profile } = await admin
    .from("profiles")
    .select("store_id")
    .eq("id", userData.user.id)
    .maybeSingle();
  return (profile as { store_id?: string } | null)?.store_id ?? null;
}

/** Same as getCallerStoreId, but also returns role — the Step 7.3 usage route is Owner/Manager-only (matches every other Status/Settings-style RPC in this project), not just same-store. */
async function getCallerStoreAndRole(req: Request): Promise<{ storeId: string; role: string } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt || !SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return null;
  const { data: profile } = await admin
    .from("profiles")
    .select("store_id,role")
    .eq("id", userData.user.id)
    .maybeSingle();
  const p = profile as { store_id?: string; role?: string } | null;
  if (!p?.store_id) return null;
  return { storeId: p.store_id, role: p.role || "staff" };
}

// path must be "<storeId>/<safe-filename>" — blocks path traversal / cross-store access
function parsePath(kind: string, rest: string): { storeId: string; path: string } | null {
  const parts = rest.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const storeId = parts[0];
  const filename = parts.slice(1).join("/");
  if (!/^[a-zA-Z0-9_-]+$/.test(storeId)) return null;
  if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) return null;
  return { storeId, path: `${storeId}/${filename}` };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  if (!isConfigured()) {
    return Response.json(
      { error: "Cloudflare R2 abhi configure nahi hai — CF_ACCOUNT_ID, CF_R2_ACCESS_KEY_ID, CF_R2_SECRET_ACCESS_KEY secrets set karo (README: STEP7.1-CLOUDFLARE-SETUP.md)." },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  const url = new URL(req.url);
  // Strip the function's own path prefix ("/r2-storage") however it was invoked.
  const trimmed = url.pathname.replace(/^\/+/, "").replace(/^r2-storage\/?/, "").replace(/^functions\/v1\/r2-storage\/?/, "");
  const [kind, ...restParts] = trimmed.split("/");
  const rest = restParts.join("/");

  // Step 7.3 — Storage Usage Meter: GET /usage/<storeId> (Owner/Manager only).
  if (kind === "usage") {
    if (req.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
    }
    const requestedStoreId = restParts[0];
    if (!requestedStoreId || !/^[a-zA-Z0-9_-]+$/.test(requestedStoreId)) {
      return Response.json({ error: "Invalid path. Expected /usage/<storeId>." }, { status: 400, headers: CORS_HEADERS });
    }
    const caller = await getCallerStoreAndRole(req);
    if (!caller || caller.storeId !== requestedStoreId || !["owner", "manager"].includes(caller.role)) {
      return Response.json({ error: "Access denied — Owner/Manager only." }, { status: 403, headers: CORS_HEADERS });
    }
    try {
      const [publicUsage, privateUsage] = await Promise.all([
        r2ListPrefixTotal(CF_BUCKET_PUBLIC, `${requestedStoreId}/`),
        r2ListPrefixTotal(CF_BUCKET_PRIVATE, `${requestedStoreId}/`),
      ]);
      return Response.json(
        {
          publicBucketBytes: publicUsage.bytes,
          publicBucketCount: publicUsage.count,
          privateBucketBytes: privateUsage.bytes,
          privateBucketCount: privateUsage.count,
          totalBytes: publicUsage.bytes + privateUsage.bytes,
        },
        { headers: CORS_HEADERS }
      );
    } catch (e) {
      return Response.json({ error: String((e as Error)?.message || e) }, { status: 502, headers: CORS_HEADERS });
    }
  }

  if (!kind || !VALID_KINDS.has(kind)) {
    return Response.json({ error: "Unknown storage kind. Use one of: product, boxscan, invoice, kyc, app." }, { status: 400, headers: CORS_HEADERS });
  }

  const parsed = parsePath(kind, rest);
  if (!parsed) {
    return Response.json({ error: "Invalid path. Expected /<kind>/<storeId>/<filename>." }, { status: 400, headers: CORS_HEADERS });
  }
  const bucket = bucketFor(kind);
  const isPrivate = PRIVATE_KINDS.has(kind);

  // Auth is required for every PUT/DELETE, and for every GET on the private (kyc) kind.
  const needsAuth = req.method === "PUT" || req.method === "DELETE" || isPrivate;
  if (needsAuth) {
    const storeId = await getCallerStoreId(req);
    if (!storeId || storeId !== parsed.storeId) {
      return Response.json({ error: "Access denied — login/store mismatch." }, { status: 403, headers: CORS_HEADERS });
    }
  }

  try {
    if (req.method === "PUT") {
      const contentType = req.headers.get("content-type") || "application/octet-stream";
      const r2res = await r2Fetch("PUT", bucket, parsed.path, { body: req.body, contentType });
      if (!r2res.ok) {
        const text = await r2res.text().catch(() => "");
        return Response.json({ error: `R2 upload failed (${r2res.status}): ${text.slice(0, 300)}` }, { status: 502, headers: CORS_HEADERS });
      }
      return Response.json({ path: parsed.path }, { headers: CORS_HEADERS });
    }

    if (req.method === "GET") {
      const r2res = await r2Fetch("GET", bucket, parsed.path);
      if (!r2res.ok) {
        return Response.json({ error: "File not found" }, { status: r2res.status === 404 ? 404 : 502, headers: CORS_HEADERS });
      }
      const headers = new Headers(CORS_HEADERS);
      headers.set("Content-Type", r2res.headers.get("content-type") || "application/octet-stream");
      headers.set("Cache-Control", isPrivate ? "private, max-age=60" : "public, max-age=31536000, immutable");
      return new Response(r2res.body, { status: 200, headers });
    }

    if (req.method === "DELETE") {
      const r2res = await r2Fetch("DELETE", bucket, parsed.path);
      if (!r2res.ok && r2res.status !== 404) {
        const text = await r2res.text().catch(() => "");
        return Response.json({ error: `R2 delete failed (${r2res.status}): ${text.slice(0, 300)}` }, { status: 502, headers: CORS_HEADERS });
      }
      return Response.json({ deleted: true }, { headers: CORS_HEADERS });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS_HEADERS });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500, headers: CORS_HEADERS });
  }
});
