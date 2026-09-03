import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "npm:pdf-lib@1.17.1";

// The web app (Cloudflare/Tauri/localhost) is always a different origin than
// this function's *.supabase.co URL, so every browser call is cross-origin.
// Without these headers the browser's CORS preflight (OPTIONS) gets no
// Access-Control-Allow-Origin back, the real POST never even leaves the
// browser, and supabase-js surfaces that as the generic, unhelpful
// "Failed to send a request to the Edge Function" — which is exactly the
// bug reported in the plan. This was missing entirely before.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-telegram-bot-api-secret-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS_HEADERS });
const url = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";

async function telegram(method: string, body?: Record<string, unknown>) {
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const r = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

// The live webhook (registered by a past `action: "begin"` call) was set up
// with `allowed_updates: ["message"]` only — Telegram will NOT deliver
// inline-button taps (`callback_query` updates) to a webhook that hasn't
// opted into them, it just silently drops them. Since setWebhook is a
// single bot-wide (not per-user) registration, the existing connected
// Owner would never see their Approve/Deny taps land unless they manually
// reconnected Telegram. To avoid depending on that, this is called
// best-effort right before we ever send a message with inline buttons —
// it's idempotent (Telegram no-ops a setWebhook call with the same URL),
// cheap, and guarantees callback_query delivery starts working immediately
// without asking the Owner to do anything.
async function ensureCallbackWebhook() {
  try {
    const functionUrl = `${url}/functions/v1/telegram-connect`;
    await telegram("setWebhook", {
      url: functionUrl,
      ...(webhookSecret ? { secret_token: webhookSecret } : {}),
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
  } catch {
    // Non-fatal — worst case the Approve/Deny buttons don't register this
    // one time and the Owner can tap again; never block the actual request.
  }
}

async function getUser(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth || !anonKey) return null;
  const client = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
  const { data } = await client.auth.getUser();
  return data.user || null;
}

// ---------------------------------------------------------------------------
// Weekly report PDF
// The report numbers are computed client-side (src/utils/weeklyReport.ts) from
// the exact same in-memory state the app itself displays — this function's
// only job is to lay it out as a clean, designed PDF and hand it to Telegram.
// ---------------------------------------------------------------------------

interface WeeklyPaymentBreakdown { method: string; total: number; count: number }
interface WeeklyLowStockItem { name: string; category: string; stock: number; minStock: number }
interface WeeklyReportPayload {
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  invoiceCount: number;
  totalSales: number;
  totalDiscount: number;
  paymentBreakdown: WeeklyPaymentBreakdown[];
  totalCost: number;
  grossProfit: number;
  totalPurchases: number;
  purchaseCount: number;
  totalShopExpenses: number;
  totalPersonalDrawings: number;
  totalOtherExpenses: number;
  totalProducts: number;
  totalStockUnits: number;
  stockValuation: number;
  lowStockItems: WeeklyLowStockItem[];
  shopName: string;
}

const money = (n: number) => `Rs. ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const NAVY = rgb(0.11, 0.16, 0.32);
const BLUE = rgb(0.16, 0.42, 0.85);
const GREEN = rgb(0.11, 0.55, 0.25);
const RED = rgb(0.75, 0.14, 0.14);
const GREY = rgb(0.45, 0.47, 0.52);
const LIGHT = rgb(0.95, 0.96, 0.98);
const LIGHT_RED = rgb(1, 0.93, 0.93);
const WHITE = rgb(1, 1, 1);

// Small stateful layout helper so section-drawing code doesn't have to juggle
// page/y-cursor/page-break logic by hand every time.
class PdfWriter {
  doc: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  y = 0;
  readonly margin = 40;
  readonly width = 595.28;
  readonly height = 841.89;

  static async create(): Promise<PdfWriter> {
    const w = new PdfWriter();
    w.doc = await PDFDocument.create();
    w.font = await w.doc.embedFont(StandardFonts.Helvetica);
    w.bold = await w.doc.embedFont(StandardFonts.HelveticaBold);
    w.addPage();
    return w;
  }

  addPage() {
    this.page = this.doc.addPage([this.width, this.height]);
    this.y = this.height - this.margin;
  }

  // Returns true if a new page was started (so callers like table() can
  // redraw a repeating header instead of leaving a headerless continuation).
  ensureSpace(needed: number): boolean {
    if (this.y - needed < this.margin) {
      this.addPage();
      return true;
    }
    return false;
  }

  text(str: string, x: number, size: number, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    this.page.drawText(str, { x, y: this.y, size, font: opts.bold ? this.bold : this.font, color: opts.color || NAVY });
  }

  sectionTitle(title: string) {
    this.ensureSpace(30);
    this.y -= 6;
    this.page.drawRectangle({ x: this.margin, y: this.y - 4, width: 4, height: 16, color: BLUE });
    this.text(title.toUpperCase(), this.margin + 12, 12, { bold: true, color: NAVY });
    this.y -= 20;
  }

  // Three (or fewer) evenly-spaced stat cards on one row.
  statRow(cards: { label: string; value: string; color?: ReturnType<typeof rgb> }[]) {
    this.ensureSpace(56);
    const gap = 10;
    const cardW = (this.width - this.margin * 2 - gap * (cards.length - 1)) / cards.length;
    const cardH = 46;
    cards.forEach((c, i) => {
      const x = this.margin + i * (cardW + gap);
      this.page.drawRectangle({ x, y: this.y - cardH, width: cardW, height: cardH, color: LIGHT, borderColor: rgb(0.85, 0.87, 0.9), borderWidth: 1 });
      this.page.drawText(c.label, { x: x + 10, y: this.y - 18, size: 8.5, font: this.font, color: GREY });
      this.page.drawText(c.value, { x: x + 10, y: this.y - 35, size: 14, font: this.bold, color: c.color || NAVY });
    });
    this.y -= cardH + 14;
  }

  table(headers: string[], colWidths: number[], rows: { cells: string[]; highlight?: boolean }[]) {
    const rowH = 20;
    const drawHeader = () => {
      let hx = this.margin;
      this.page.drawRectangle({ x: this.margin, y: this.y - rowH, width: this.width - this.margin * 2, height: rowH, color: NAVY });
      headers.forEach((h, i) => {
        this.page.drawText(h, { x: hx + 6, y: this.y - rowH + 6, size: 9, font: this.bold, color: WHITE });
        hx += colWidths[i];
      });
      this.y -= rowH;
    };

    this.ensureSpace(rowH * 2);
    drawHeader();

    let x = this.margin;
    for (const row of rows) {
      if (this.ensureSpace(rowH)) drawHeader();
      if (row.highlight) {
        this.page.drawRectangle({ x: this.margin, y: this.y - rowH, width: this.width - this.margin * 2, height: rowH, color: LIGHT_RED });
      }
      x = this.margin;
      row.cells.forEach((cell, i) => {
        this.page.drawText(cell.slice(0, 44), { x: x + 6, y: this.y - rowH + 6, size: 9, font: this.font, color: row.highlight ? RED : NAVY });
        x += colWidths[i];
      });
      this.page.drawLine({ start: { x: this.margin, y: this.y - rowH }, end: { x: this.width - this.margin, y: this.y - rowH }, thickness: 0.5, color: rgb(0.88, 0.89, 0.92) });
      this.y -= rowH;
    }
    this.y -= 12;
  }
}

async function buildWeeklyReportPdf(r: WeeklyReportPayload): Promise<Uint8Array> {
  const w = await PdfWriter.create();

  // Header banner
  w.page.drawRectangle({ x: 0, y: w.height - 90, width: w.width, height: 90, color: NAVY });
  w.page.drawText(r.shopName || "My Shop", { x: w.margin, y: w.height - 40, size: 20, font: w.bold, color: WHITE });
  w.page.drawText("Weekly Business Report", { x: w.margin, y: w.height - 60, size: 11, font: w.font, color: rgb(0.8, 0.85, 0.95) });
  const rangeLabel = `${r.periodStart} to ${r.periodEnd}`;
  const rangeWidth = w.bold.widthOfTextAtSize(rangeLabel, 11);
  w.page.drawText(rangeLabel, { x: w.width - w.margin - rangeWidth, y: w.height - 40, size: 11, font: w.bold, color: WHITE });
  w.y = w.height - 90 - 24;

  w.sectionTitle("Sales This Week");
  w.statRow([
    { label: "TOTAL SALES", value: money(r.totalSales) },
    { label: "INVOICES", value: String(r.invoiceCount) },
    { label: "DISCOUNT GIVEN", value: money(r.totalDiscount) },
  ]);
  if (r.paymentBreakdown.length) {
    w.table(
      ["Payment Method", "Amount", "Invoices"],
      [(w.width - w.margin * 2) * 0.5, (w.width - w.margin * 2) * 0.3, (w.width - w.margin * 2) * 0.2],
      r.paymentBreakdown.map((p) => ({ cells: [p.method, money(p.total), String(p.count)] }))
    );
  }

  w.sectionTitle("Profit");
  w.statRow([
    { label: "COST OF GOODS SOLD", value: money(r.totalCost) },
    { label: "GROSS PROFIT", value: money(r.grossProfit), color: r.grossProfit >= 0 ? GREEN : RED },
  ]);

  w.sectionTitle("Purchases & Expenses This Week");
  w.statRow([
    { label: "PURCHASES", value: `${money(r.totalPurchases)} (${r.purchaseCount})` },
    { label: "SHOP EXPENSES", value: money(r.totalShopExpenses) },
    { label: "PERSONAL DRAWINGS", value: money(r.totalPersonalDrawings) },
  ]);
  if (r.totalOtherExpenses) {
    w.statRow([{ label: "OTHER EXPENSES", value: money(r.totalOtherExpenses) }]);
  }

  w.sectionTitle("Current Stock Snapshot");
  w.statRow([
    { label: "TOTAL PRODUCTS", value: String(r.totalProducts) },
    { label: "TOTAL UNITS IN STOCK", value: String(r.totalStockUnits) },
    { label: "STOCK VALUE (COST)", value: money(r.stockValuation) },
  ]);

  if (r.lowStockItems.length) {
    w.sectionTitle(`Low Stock Alert (${r.lowStockItems.length} item${r.lowStockItems.length > 1 ? "s" : ""})`);
    w.table(
      ["Product", "Category", "Stock", "Min"],
      [(w.width - w.margin * 2) * 0.45, (w.width - w.margin * 2) * 0.3, (w.width - w.margin * 2) * 0.125, (w.width - w.margin * 2) * 0.125],
      r.lowStockItems.map((i) => ({ cells: [i.name, i.category || "-", String(i.stock), String(i.minStock)], highlight: true }))
    );
  } else {
    w.sectionTitle("Low Stock Alert");
    w.text("All stock levels look healthy this week.", w.margin, 10, { color: GREEN });
    w.y -= 20;
  }

  w.ensureSpace(20);
  w.text(`Generated ${new Date(r.generatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} — DS Mobile & Digital Hub`, w.margin, 8, { color: GREY });

  return w.doc.save();
}

Deno.serve(async (req) => {
  // Browser preflight for the POST call below — must return before any auth/
  // body parsing, and with no body, or the actual request never gets sent.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  try {
    // Telegram webhook path: Telegram cannot send a Supabase Auth header.
    // If a webhook secret is configured, the request MUST present it — a missing
    // header must not be treated as an implicit pass, or the secret is a no-op.
    const telegramSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    const looksLikeWebhookCall = req.method === "POST" && !req.headers.get("Authorization");
    if (looksLikeWebhookCall && (webhookSecret ? telegramSecret === webhookSecret : true)) {
      const update = await req.json().catch(() => ({}));

      // Step 4.3 — Owner tapping "✅ Approve" / "❌ Deny" on a Confidential
      // Price request arrives here as a `callback_query` update, never a
      // `message`. Handled first/separately since a callback_query has no
      // `.message.text` typed by a human — it's a button tap on a message
      // this function itself sent.
      const cb = update?.callback_query;
      if (cb) {
        const admin = createClient(url, serviceKey);
        const cbChatId = cb.message?.chat?.id;
        const cbMessageId = cb.message?.message_id;
        const originalText = String(cb.message?.text || "");
        const match = /^cpr_(a|d)_([0-9a-fA-F-]{36})$/.exec(String(cb.data || ""));
        let answerText = "Request nahi mili (shayad already expire ho chuki hai).";
        let footer = "";
        if (match) {
          const decision = match[1] === "a" ? "approved" : "denied";
          const requestId = match[2];
          const { data: reqRow } = await admin.from("confidential_price_requests")
            .select("id,store_id,product_id,status,telegram_chat_id")
            .eq("id", requestId).maybeSingle();
          if (!reqRow) {
            answerText = "Request nahi mili (shayad already expire ho chuki hai).";
          } else if (reqRow.status !== "pending") {
            answerText = "Yeh request pehle hi resolve ho chuki hai.";
            footer = `\n\n— Pehle hi ${reqRow.status === "approved" ? "approve" : reqRow.status} ho chuka hai.`;
          } else if (String(reqRow.telegram_chat_id) !== String(cbChatId)) {
            // Should never happen in practice (the button only exists in the
            // message sent to this exact chat), but never trust callback_data
            // alone to authorize a state change without this check.
            answerText = "Aap is request ko approve/deny karne ke liye authorized nahi hain.";
          } else if (decision === "denied") {
            await admin.from("confidential_price_requests")
              .update({ status: "denied", responded_at: new Date().toISOString() })
              .eq("id", requestId);
            answerText = "❌ Deny kar diya.";
            footer = "\n\n❌ Denied.";
          } else {
            const { data: stateRow } = await admin.from("store_state")
              .select("state").eq("store_id", reqRow.store_id).maybeSingle();
            const products = (stateRow?.state as { products?: unknown[] } | null)?.products;
            const prod = Array.isArray(products)
              ? (products as Array<Record<string, unknown>>).find((p) => p?.id === reqRow.product_id)
              : undefined;
            const price = prod && typeof prod.confidentialPrice === "number" ? prod.confidentialPrice : null;
            if (price == null) {
              await admin.from("confidential_price_requests")
                .update({ status: "denied", responded_at: new Date().toISOString() })
                .eq("id", requestId);
              answerText = "Is product ka Confidential Price set nahi hai — request auto-deny ho gayi.";
              footer = "\n\n⚠️ Confidential Price set nahi thi, isliye auto-deny ho gaya.";
            } else {
              await admin.from("confidential_price_requests").update({
                status: "approved",
                revealed_price: price,
                reveal_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
                responded_at: new Date().toISOString(),
              }).eq("id", requestId);
              answerText = "✅ Approve kar diya — staff ko 5 minute ke liye price dikhega.";
              footer = "\n\n✅ Approved — staff ko ab 5 minute ke liye price dikhega.";
            }
          }
        }
        await telegram("answerCallbackQuery", { callback_query_id: cb.id, text: answerText }).catch(() => {});
        if (cbChatId && cbMessageId && footer) {
          await telegram("editMessageText", {
            chat_id: cbChatId, message_id: cbMessageId, text: `${originalText}${footer}`,
          }).catch(() => {});
          await telegram("editMessageReplyMarkup", {
            chat_id: cbChatId, message_id: cbMessageId, reply_markup: { inline_keyboard: [] },
          }).catch(() => {});
        }
        return json({ ok: true });
      }

      const message = update?.message;
      const text = String(message?.text || "");
      const chatId = message?.chat?.id;
      const from = message?.from;
      if (chatId && text.startsWith("/start ")) {
        const nonce = text.slice(7).trim();
        const admin = createClient(url, serviceKey);
        const { data: session } = await admin.from("telegram_connect_sessions")
          .select("id,user_id,store_id,status,expires_at").eq("nonce", nonce)
          .eq("status", "pending").gt("expires_at", new Date().toISOString()).maybeSingle();
        if (session) {
          await admin.from("telegram_connections").upsert({
            user_id: session.user_id,
            store_id: session.store_id,
            chat_id: String(chatId),
            username: from?.username || null,
            first_name: from?.first_name || null,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" });
          await admin.from("telegram_connect_sessions").update({ status: "connected" }).eq("id", session.id);
          await telegram("sendMessage", { chat_id: chatId, text: "✅ DS Mobile & Digital Hub connected successfully." });
        }
      }
      return json({ ok: true });
    }

    // Cron path: pg_cron (public.send_due_weekly_reports, Monday 9:00 AM IST)
    // calls this over pg_net once a week per connected store. There is no
    // user session in that context, so it authenticates with the same
    // shared secret already used by telegram-outbox-worker's sweep instead.
    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    const providedCronSecret = req.headers.get("x-cron-secret") || "";
    const isCronCall = cronSecret.length > 0 && providedCronSecret === cronSecret;
    if (isCronCall) {
      const body = await req.json().catch(() => ({}));
      if (String(body.action) === "cron_send_weekly_report") {
        const chatId = String(body.chatId || "");
        const report = body.report as WeeklyReportPayload | undefined;
        if (!chatId || !report || typeof report !== "object") {
          return json({ error: "chatId/report missing" }, 400);
        }
        const pdfBytes = await buildWeeklyReportPdf(report);
        const filename = `weekly-report-${report.periodEnd || "latest"}.pdf`;
        const f = new FormData();
        f.append("chat_id", chatId);
        f.append("caption", `📊 ${report.shopName || "Shop"} — Weekly Report (${report.periodStart} to ${report.periodEnd})`);
        f.append("document", new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" }), filename);
        const d = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: "POST", body: f });
        const dres = await d.json().catch(() => ({}));
        if (!d.ok || !dres.ok) throw new Error(dres.description || `Telegram document HTTP ${d.status}`);
        return json({ ok: true, telegramMessageId: dres.result?.message_id });
      }
      return json({ error: "Unknown cron action" }, 400);
    }

    const user = await getUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(url, serviceKey);
    const { data: profile } = await admin.from("profiles")
      .select("store_id,role,full_name,staff_name").eq("id", user.id).maybeSingle();
    if (!profile?.store_id) return json({ error: "Not authorized" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "status");

    // Step 4.3 — Confidential Price request. Unlike every other action in
    // this function (which are Owner/Manager-only, per Step 1.4: "Telegram
    // is sirf Owner ka kaam"), this is the one action Staff must be able to
    // call — it's the entire point of the feature. It never touches the
    // Owner's Telegram connection state directly (no begin/poll/test), it
    // only asks this function to relay one message on the Owner's behalf.
    if (action === "confidential_price_request") {
      const productId = String(body.productId || "").trim();
      const productName = String(body.productName || "").trim();
      const productCategory = body.productCategory ? String(body.productCategory).trim() : null;
      if (!productId || !productName) return json({ error: "Product detail missing." }, 400);

      const { data: connection } = await admin.from("telegram_connections")
        .select("chat_id").eq("store_id", profile.store_id).maybeSingle();
      if (!connection?.chat_id) {
        return json({ error: "Owner ka Telegram connected nahi hai — Owner ko pehle Telegram connect karna hoga." }, 400);
      }

      await ensureCallbackWebhook();

      const requesterName = profile.full_name || profile.staff_name || "Staff";
      const id = crypto.randomUUID();
      const { error: insertErr } = await admin.from("confidential_price_requests").insert({
        id,
        store_id: profile.store_id,
        product_id: productId,
        product_name: productName,
        product_category: productCategory,
        requested_by: user.id,
        requested_by_name: requesterName,
        telegram_chat_id: connection.chat_id,
        status: "pending",
      });
      if (insertErr) throw insertErr;

      const categoryPart = productCategory ? `, Category-${productCategory}` : "";
      const text = `🔒 Confidential Price Request\n\n"${productName}"${categoryPart} ka Confidential Price dekhna chahta hai: ${requesterName}\n\nApprove karne ke baad staff ko sirf yeh ek price, 5 minute ke liye dikhega — permanent nahi.`;
      let result: { message_id?: number };
      try {
        result = await telegram("sendMessage", {
          chat_id: connection.chat_id,
          text,
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Approve", callback_data: `cpr_a_${id}` },
              { text: "❌ Deny", callback_data: `cpr_d_${id}` },
            ]],
          },
        });
      } catch (sendErr) {
        // Message failed to go out — don't leave an orphaned pending request
        // the staff device would wait on forever.
        await admin.from("confidential_price_requests").update({ status: "denied" }).eq("id", id);
        throw sendErr;
      }
      await admin.from("confidential_price_requests")
        .update({ telegram_message_id: String(result?.message_id || "") }).eq("id", id);

      return json({ ok: true, requestId: id });
    }

    if (!["owner", "manager"].includes(profile.role)) return json({ error: "Not authorized" }, 403);

    if (action === "begin") {
      const nonce = crypto.randomUUID().replace(/-/g, "");
      const id = crypto.randomUUID();
      await admin.from("telegram_connect_sessions").update({ status: "expired" }).eq("user_id", user.id).eq("status", "pending");
      const { error } = await admin.from("telegram_connect_sessions").insert({
        id, user_id: user.id, store_id: profile.store_id, nonce, status: "pending",
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      if (error) throw error;

      const me = await telegram("getMe");
      const functionUrl = `${url}/functions/v1/telegram-connect`;
      await telegram("setWebhook", {
        url: functionUrl,
        ...(webhookSecret ? { secret_token: webhookSecret } : {}),
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false,
      });
      return json({
        username: me.username,
        nonce,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        deepLink: `https://t.me/${me.username}?start=${nonce}`,
      });
    }

    if (action === "poll" || action === "status") {
      const { data: connection } = await admin.from("telegram_connections")
        .select("chat_id,username,first_name,connected_at,updated_at")
        .eq("user_id", user.id).eq("store_id", profile.store_id).maybeSingle();
      // Step 9.1 — Status Dashboard needs to tell apart two different red states:
      // "Owner ka Telegram account connect nahi hai" (connected: false, bot theek hai)
      // vs "Bot hi configure nahi hai" (botConfigured: false — poora Telegram feature down hai,
      // koi bhi Owner connect nahi kar sakta). botToken is only ever read from this function's
      // own env, never sent to or trusted from the client, so this is a safe boolean-only flag.
      return json({ connected: !!connection?.chat_id, connection: connection || null, botConfigured: Boolean(botToken) });
    }

    if (action === "security_alert") {
      const { data: connection } = await admin.from("telegram_connections")
        .select("chat_id").eq("user_id", user.id).eq("store_id", profile.store_id).maybeSingle();
      if (!connection?.chat_id) return json({ error: "Telegram is not connected." }, 400);
      const customMsg = String(body.message || "Security alert on your shop's counter device.");
      const text = `🔴 SECURITY ALERT — DS Mobile & Digital Hub\n\n${customMsg}\n\nTime: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
      const result = await telegram("sendMessage", { chat_id: connection.chat_id, text });
      return json({ ok: true, telegramMessageId: result?.message_id });
    }

    if (action === "send_report") {
      const { data: connection } = await admin.from("telegram_connections")
        .select("chat_id").eq("user_id", user.id).eq("store_id", profile.store_id).maybeSingle();
      if (!connection?.chat_id) return json({ error: "Telegram is not connected." }, 400);
      const text = String(body.message || "").slice(0, 4000);
      if (!text.trim()) return json({ error: "Nothing to send." }, 400);
      const result = await telegram("sendMessage", { chat_id: connection.chat_id, text, parse_mode: "Markdown" });
      return json({ ok: true, telegramMessageId: result?.message_id });
    }

    if (action === "send_weekly_report") {
      const { data: connection } = await admin.from("telegram_connections")
        .select("chat_id").eq("user_id", user.id).eq("store_id", profile.store_id).maybeSingle();
      if (!connection?.chat_id) return json({ error: "Telegram is not connected." }, 400);
      const report = body.report as WeeklyReportPayload | undefined;
      if (!report || typeof report !== "object") return json({ error: "Report data missing." }, 400);
      const pdfBytes = await buildWeeklyReportPdf(report);
      const filename = `weekly-report-${report.periodEnd || "latest"}.pdf`;
      const f = new FormData();
      f.append("chat_id", connection.chat_id);
      f.append("caption", `📊 ${report.shopName || "Shop"} — Weekly Report (${report.periodStart} to ${report.periodEnd})`);
      f.append("document", new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" }), filename);
      const d = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: "POST", body: f });
      const db_ = await d.json().catch(() => ({}));
      if (!d.ok || !db_.ok) throw new Error(db_.description || `Telegram document HTTP ${d.status}`);
      return json({ ok: true, telegramMessageId: db_.result?.message_id });
    }

    if (action === "test") {
      const { data: connection } = await admin.from("telegram_connections")
        .select("chat_id").eq("user_id", user.id).eq("store_id", profile.store_id).maybeSingle();
      if (!connection?.chat_id) return json({ error: "Telegram is not connected." }, 400);
      const result = await telegram("sendMessage", {
        chat_id: connection.chat_id,
        text: "✅ DS Mobile & Digital Hub — Telegram test delivered successfully.",
      });
      return json({ ok: true, worker: { sent: true, telegramMessageId: result?.message_id } });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    return json({ error: String(error instanceof Error ? error.message : error) }, 500);
  }
});
