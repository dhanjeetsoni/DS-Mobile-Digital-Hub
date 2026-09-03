# DS Mobile & Digital Hub — Complete Setup Guide

This is a single step-by-step guide covering everything needed to get the app
running: local dev, environment variables, Gemini AI keys, Supabase, the
Telegram bot, WhatsApp, and building the Windows desktop app. Also see
`SUPABASE-TELEGRAM-SETUP.md` for the cloud database schema reference.

---

## 1. Prerequisites

Install these once on your computer:

- **Node.js 20 or newer** — https://nodejs.org (choose the LTS version)
- **Rust + Cargo** — only needed for the Windows desktop build, install from
  https://rustup.rs
- A code editor (VS Code recommended, optional)

Check they installed correctly:

```bash
node -v
npm -v
cargo -v
```

---

## 2. Get the project running locally (web version)

1. Unzip the project folder and open a terminal inside it.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the environment template and fill it in (see Section 3 below):
   ```bash
   cp .env.example .env
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```
5. Open the printed local address (usually `http://localhost:3000`) in your
   browser. The app works even before you fill in `.env` — AI scanning and
   cloud sync simply stay disabled until keys are added.

---

## 3. Environment variables (`.env` file)

Never share your `.env` file or commit it to a public repository — it holds
secret keys. Never rename a secret key to start with `VITE_`; anything with
that prefix is bundled into the browser code and becomes publicly visible.

### 3a. Gemini AI keys (for AI photo scanning & business advice)

The app uses Google Gemini for: phone box/IMEI scanning, accessory
compatibility scanning, the Glass & Cover screen-size AI fallback, the Photo
Stock Finder, and the AI Business Advisor / AI Shift Advice cards.

**Recommended (Step 2.1) — add keys from inside the app, no redeploy needed:**

1. Go to https://aistudio.google.com/apikey (repeat with up to 10 different
   Google accounts if you want the full failover pool — each is free for
   normal shop-level usage).
2. Open the app → **Shop & Security Settings → AI Key Pool (Gemini)**
   (Owner-only). Paste each key into its numbered slot (1-10) and save.
3. The **AI Key Status Widget** on the same screen shows which key is
   currently active, how many are available vs exhausted, and roughly how
   much AI usage happened today — no need to check Google's dashboard.
4. If one key hits its free daily quota, the app automatically rotates to
   the next configured key with zero downtime — staff never see an error.

This requires `SUPABASE_SERVICE_ROLE_KEY` to also be set in `.env` (see
section 3b below) so the backend can securely read the keys you save —
without it, the in-app Settings screen will show an error, and you'll need
the legacy `.env`-only method below instead.

**Legacy fallback (`.env`-only, up to 5 keys, needs redeploy to change):**

1. Paste a key into `.env` as `GEMINI_API_KEY_1`.
2. Optionally repeat for `GEMINI_API_KEY_2` through `GEMINI_API_KEY_5`.

```env
GEMINI_API_KEY_1=paste_your_key_here
GEMINI_API_KEY_2=
GEMINI_API_KEY_3=
GEMINI_API_KEY_4=
GEMINI_API_KEY_5=
```

These env keys are also used automatically as a fallback if the in-app pool
(above) hasn't been configured yet for a store — so nothing breaks if you
already had these set from before.

If you leave everything blank (both methods), the app still works — every AI
feature just shows "AI unavailable, enter manually" and staff fill fields by
hand.

### 3b. Supabase (cloud login, sync, and Telegram bridge)

1. Go to https://supabase.com and create a free project.
2. In your Supabase project dashboard, go to **Project Settings → API**.
3. Copy the **Project URL** and the **anon / publishable key**.
4. Fill in **all four** of these — two server-side, two client-side (they
   are the same values, just duplicated for the two different parts of the
   app):

```env
# Server-side (used by server.ts, never sent to the browser)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_anon_or_publishable_key

# Server-side only, REQUIRED for the in-app "AI Key Pool" Settings screen
# (Step 2.1) — lets the backend securely read the Gemini keys the Owner
# saves, without ever exposing them to the browser. Find it in Project
# Settings -> API -> service_role. Treat this like a master password —
# never put it in VITE_-prefixed vars or commit it anywhere public.
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Client-side (safe to expose — used by the browser bundle)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_or_publishable_key
```

5. Run the SQL migration files under `supabase/migrations/` against your
   project, in filename (date) order, using the Supabase SQL Editor or the
   Supabase CLI (`supabase db push`). These create every table, RLS policy,
   and the atomic-sale/reservation functions the app depends on.
6. Deploy the two Edge Functions under `supabase/functions/` (see Section 5).

Without Supabase configured, the app still runs fully offline on one device
using local browser storage — you only need this section for multi-device
sync, staff logins, and Telegram notifications.

### 3c. Misc settings

```env
PORT=3000
NODE_ENV=development
# TRUST_PROXY=true   # only if you deploy behind a reverse proxy / load balancer
```

For a production deployment, set `NODE_ENV=production` and run `npm run
build` then `npm start` (see Section 6).

---

## 4. WhatsApp integration

WhatsApp needs **no API key and no setup**. The app uses WhatsApp's official
"click-to-chat" web links (`wa.me`) to open a pre-filled message — for
invoices, due-payment reminders, and low-stock reorder messages to
suppliers. Clicking the WhatsApp button in the app opens WhatsApp (desktop
app, or web.whatsapp.com) with the message ready to send; the shop staff
just presses Send. This works the moment the app is installed, on any device
that has WhatsApp.

If a customer/supplier phone number is a plain 10-digit Indian number, the
app automatically adds the `91` country code for you.

---

## 5. Telegram bot setup (owner alerts & notifications)

The Telegram bot sends the shop owner real-time alerts (e.g. daily Galla
closing summary, low stock, large sales) to their personal Telegram account.

### Step 1 — Create the bot and get a token
1. Open Telegram and message **@BotFather**.
2. Send `/newbot` and follow the prompts (choose a name and a unique
   username ending in `bot`, e.g. `dsmobilehub_bot`).
3. BotFather replies with a **bot token** — a long string like
   `123456789:ABCdefGhIJKlmNoPQRstuVwxYZ`. Keep this secret.

### Step 2 — Deploy the two Edge Functions
Using the Supabase CLI, from the project root:
```bash
supabase functions deploy telegram-connect
supabase functions deploy telegram-outbox-worker
```

### Step 3 — Set the Edge Function secrets
In the Supabase dashboard → **Edge Functions → (each function) → Secrets**,
or via CLI:
```bash
supabase secrets set TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
supabase secrets set SUPABASE_URL=https://your-project.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
# Optional but recommended, adds webhook signature verification:
supabase secrets set TELEGRAM_WEBHOOK_SECRET=any_random_string_you_choose
```
The **service role key** (different from the publishable/anon key) is found
under Project Settings → API → `service_role` — this one is highly
sensitive and must only ever live in Supabase's server-side secrets, never
in the app's `.env` or browser code.

### Step 4 — Schedule the outbox worker
`telegram-outbox-worker` needs to run on a schedule (every 1-2 minutes) to
actually deliver queued messages with retry/backoff. Set this up as a
Supabase **Cron / scheduled trigger** pointing at the deployed function URL,
or an external scheduler (cron job, GitHub Actions, etc.) that calls it
periodically.

### Step 5 — Connect the owner's Telegram account
1. Sign in to the app as the owner.
2. Go to the Telegram Connect panel in the app.
3. Tap **Connect Telegram** — the app opens a Telegram deep link.
4. Press **Start** inside the bot chat.
5. The connection completes automatically within a few seconds; a
   confirmation message arrives in Telegram.

Once connected, Galla closings, low-stock alerts and other notifications
queue into `telegram_outbox` and get delivered by the worker automatically.

---

## 6. Production web deployment

```bash
npm run build:production   # typecheck + static audit + production build
npm start                  # serves the built app on $PORT
```

Deploy the resulting `dist/` folder + `dist/server.mjs` to any Node.js
hosting (Render, Railway, a VPS, etc.). Set every `.env` variable above as
real environment variables on the host — do not upload the `.env` file
itself.

---

## 7. Building the Windows desktop app (.exe installer)

The desktop app is the same web app wrapped with **Tauri**, giving a native
Windows `.exe` installer with an app icon, offline shell, and keyboard
shortcuts (see the in-app **Windows App** guide for the shortcut list).

### One-click way
Just double-click `BUILD-WINDOWS.bat` in the project folder. It checks that
Node, npm and Rust/Cargo are installed, installs dependencies if needed,
runs the TypeScript check and the static security audit, then builds the
installer. It pauses on any failure so you can read the error.

### Manual way
```bash
npm install
npm run typecheck
npm run test:static
npm run tauri:build
```

### Where the installer appears
```
src-tauri\target\release\bundle\nsis\DS Mobile & Digital Hub_1.0.0_x64-setup.exe
```
(also an `.msi` under `bundle\msi\` depending on your Tauri config). Copy
this installer file to any Windows shop PC and run it — no separate Node.js
install is needed on the shop PC, everything is bundled into the `.exe`.

### Before shipping to a real shop PC
- Fill in `.env` with real Gemini + Supabase keys **before** running
  `tauri:build` — those values get bundled into the app at build time.
- Run `npm run build:production` once manually first to catch any
  TypeScript errors early (the `.bat` file does this too, but it's faster
  to fix errors on your own dev machine).

---

## Quick checklist

- [ ] `npm install` completed with no errors
- [ ] `.env` filled: at least `GEMINI_API_KEY_1` for AI features to work
- [ ] `.env` filled: `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` (+ `VITE_`
      versions) if you want cloud sync / staff logins
- [ ] Supabase migrations run (`supabase/migrations/*.sql`) if using cloud sync
- [ ] Telegram bot created via @BotFather, token set as an Edge Function
      secret, both Edge Functions deployed, worker scheduled
- [ ] WhatsApp — nothing to configure, works out of the box
- [ ] `npm run dev` opens the app locally without errors
- [ ] (Windows only) Rust/Cargo installed, `BUILD-WINDOWS.bat` completes and
      produces an installer under `src-tauri\target\release\bundle\`
