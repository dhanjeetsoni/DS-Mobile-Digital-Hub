import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Owner-only staff account management. Creating another auth user, or
// resetting their password, requires the Supabase service-role key — which
// can never be shipped to the Android/browser client — so those two actions
// live here. Everyday actions that don't need admin privileges (toggling
// access_enabled on/off, listing staff, setting the access window) are done
// directly from the client against `profiles`, guarded by the
// profiles_owner_manager_update_staff RLS policy from the matching migration.

// Same cross-origin situation as telegram-connect (Step 1.4): the web app's
// origin is never the same as this function's *.supabase.co URL, so every
// browser call here is cross-origin too. Without these headers "Add Staff"/
// "Reset Password"/"Delete" from the Owner's Staff Access Manager fail the
// exact same way Telegram Connect did — a blocked preflight, surfaced by
// supabase-js as "Failed to send a request to the Edge Function."
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });
const url = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";

// Staff sign in with a short login ID, not an email, so we mint a synthetic
// address behind the scenes. login IDs are globally unique (enforced by the
// profiles_staff_login_id_key index) so this can't collide across stores.
const STAFF_EMAIL_DOMAIN = "staff.dsmdh.internal";
const loginIdToEmail = (loginId: string) => `${loginId.trim().toLowerCase()}@${STAFF_EMAIL_DOMAIN}`;

function validateLoginId(id: string) {
  const v = String(id || "").trim();
  if (!/^[a-zA-Z0-9._-]{3,24}$/.test(v)) {
    throw new Error("Login ID must be 3-24 characters: letters, numbers, dot, underscore or hyphen only.");
  }
  return v;
}

function validatePassword(pw: string) {
  const v = String(pw || "");
  if (v.length < 4) throw new Error("Password must be at least 4 characters.");
  return v;
}

async function getCaller(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth || !anonKey) return null;
  const client = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const { data } = await client.auth.getUser();
  return data.user || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  try {
    const user = await getCaller(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(url, serviceKey);
    const { data: callerProfile } = await admin.from("profiles").select("store_id,role").eq("id", user.id).maybeSingle();
    if (!callerProfile?.store_id || !["owner", "manager"].includes(callerProfile.role)) {
      return json({ error: "Only the shop owner or a manager can manage staff accounts." }, 403);
    }
    const storeId = callerProfile.store_id;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "create") {
      const loginId = validateLoginId(body.loginId);
      const password = validatePassword(body.password);
      const staffName = String(body.staffName || "").trim() || loginId;

      const { data: existing } = await admin.from("profiles").select("id").ilike("staff_login_id", loginId).maybeSingle();
      if (existing) return json({ error: `Login ID "${loginId}" is already taken. Choose a different one.` }, 409);

      const email = loginIdToEmail(loginId);
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { staff_login_id: loginId, staff_name: staffName, store_id: storeId },
      });
      if (createErr || !created?.user) return json({ error: createErr?.message || "Could not create staff account." }, 400);

      const { error: profileErr } = await admin.from("profiles").upsert({
        id: created.user.id,
        email,
        full_name: staffName,
        store_id: storeId,
        role: "staff",
        staff_login_id: loginId,
        staff_name: staffName,
        access_enabled: true,
        access_mode: "no_restriction",
        access_granted_at: new Date().toISOString(),
        visibility_from: new Date().toISOString(),
        created_by: user.id,
      });
      if (profileErr) {
        // Roll back the orphaned auth user so a failed profile write doesn't
        // leave an unusable, un-listable staff login behind.
        await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
        return json({ error: profileErr.message }, 400);
      }

      return json({ ok: true, staffId: created.user.id, loginId, staffName });
    }

    if (action === "reset_password") {
      const staffId = String(body.staffId || "");
      const password = validatePassword(body.password);
      const { data: target } = await admin.from("profiles").select("id,store_id,role").eq("id", staffId).maybeSingle();
      if (!target || target.store_id !== storeId || target.role !== "staff") {
        return json({ error: "Staff member not found in your shop." }, 404);
      }
      const { error } = await admin.auth.admin.updateUserById(staffId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "delete") {
      const staffId = String(body.staffId || "");
      const { data: target } = await admin.from("profiles").select("id,store_id,role").eq("id", staffId).maybeSingle();
      if (!target || target.store_id !== storeId || target.role !== "staff") {
        return json({ error: "Staff member not found in your shop." }, 404);
      }
      await admin.from("profiles").delete().eq("id", staffId);
      await admin.auth.admin.deleteUser(staffId).catch(() => {});
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    return json({ error: String(error instanceof Error ? error.message : error) }, 500);
  }
});
