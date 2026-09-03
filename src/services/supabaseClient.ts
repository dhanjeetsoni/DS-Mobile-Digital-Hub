import { createClient, type SupabaseClient } from '@supabase/supabase-js';
const env = (import.meta as any).env || {};
export const SUPABASE_URL = String(env.VITE_SUPABASE_URL || "").trim();
export const SUPABASE_PUBLISHABLE_KEY = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();

// True whenever a real Supabase project is configured via .env. When false, the app
// runs in local-only/offline mode instead of crashing — see makeOfflineClient() below.
export const isCloudConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

function offlineError(action: string) {
  return { name: "OfflineError", message: `Cloud not configured — ${action} needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY set in .env, then a restart.` };
}

// A chainable, awaitable stand-in for the Postgrest/RPC query builder
// (supabase.from(...).select().eq().maybeSingle(), supabase.rpc(...), etc).
// Every method call keeps returning the same kind of chain, and awaiting the
// chain at any depth resolves to { data: null, error }, matching supabase-js's
// own shape so existing `if (error)` / try-catch call sites work unchanged.
function offlineQueryChain(label: string): any {
  const result = { data: null, error: offlineError(label) };
  return new Proxy(() => {}, {
    get(_target, prop: string) {
      if (prop === "then") return (resolve: (v: typeof result) => void) => resolve(result);
      if (prop === "catch" || prop === "finally") return () => offlineQueryChain(label);
      return (..._args: unknown[]) => offlineQueryChain(label);
    },
    apply() { return offlineQueryChain(label); },
  });
}

// A chainable, sync stand-in for realtime channels (supabase.channel(x).on(...).subscribe()).
function offlineChannel(): any {
  return new Proxy({}, { get: (_t, prop: string) => (prop === "subscribe" ? () => offlineChannel() : () => offlineChannel()) });
}

// Local-only fallback used when .env has no Supabase project configured. It implements
// just enough of the SupabaseClient surface that this app calls (auth, from, rpc,
// channel/removeChannel, functions.invoke) so the app boots normally and every screen
// that already has offline handling (local storage cache, local sqlite queue) works as
// designed, instead of a blank white screen before React even mounts.
// Stand-in for supabase.storage.from(bucket) so any code that tries to
// upload/read a photo (see services/photoStorage.ts) fails gracefully with
// the same offline-mode message instead of throwing "cannot read property
// of undefined" when .storage doesn't exist at all.
function offlineStorageBucket(): any {
  return {
    upload: async () => ({ data: null, error: offlineError("photo upload") }),
    remove: async () => ({ data: null, error: offlineError("photo delete") }),
    getPublicUrl: (path: string) => ({ data: { publicUrl: path } }),
  };
}

function makeOfflineClient(): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ data: { user: null, session: null }, error: offlineError("cloud sign-in") }),
      signUp: async () => ({ data: { user: null, session: null }, error: offlineError("cloud sign-up") }),
      signOut: async () => ({ error: null }),
    },
    from: (_table: string) => offlineQueryChain("this database call"),
    rpc: (_fn: string, _args?: unknown) => offlineQueryChain("this cloud action"),
    channel: (_name: string) => offlineChannel(),
    removeChannel: (_channel: unknown) => {},
    functions: { invoke: async (_name: string, _opts?: unknown) => ({ data: null, error: offlineError("this cloud function") }) },
    storage: { from: (_bucket: string) => offlineStorageBucket() },
  } as unknown as SupabaseClient;
}

export const supabase: SupabaseClient = isCloudConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : makeOfflineClient();

if (!isCloudConfigured && typeof console !== "undefined") {
  console.info("DS Mobile & Digital Hub: no Supabase config found — running fully offline (local storage/local sqlite only). See .env.example to enable cloud sync.");
}

export async function getCurrentUser(){ const {data}=await supabase.auth.getUser(); return data.user ?? null; }
export async function getCurrentProfile(){ const user=await getCurrentUser(); if(!user)return null; const {data}=await supabase.from('profiles').select('id,email,full_name,store_id,role,staff_login_id,staff_name,access_enabled,access_mode,access_expires_at,access_granted_at,visibility_from').eq('id',user.id).maybeSingle(); return data ?? null; }
