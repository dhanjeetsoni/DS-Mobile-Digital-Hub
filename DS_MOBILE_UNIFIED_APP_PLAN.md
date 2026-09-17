# DS Mobile — Unified Android App Plan (single app, owner Lite/Pro mode)

_Status: PLANNING ONLY — nothing in this document has been implemented yet.
Written to lock down the exact spec before any code changes, per explicit
request. Once confirmed, this becomes the phase to execute against, the
same way `PROJECT_PLAN.md` tracks every other phase in this repo._

---

## 1. What's changing, in one paragraph

Today there are **two separate Android APKs** — "DS Owner" and "DS Staff"
(`tauri.owner-android.conf.json` / `tauri.staff-android.conf.json`, built
via `VITE_APP_VARIANT=owner|staff`) — and the Owner build unlocks via a
**shared local passcode** (`db.settings.ownerPasscode`, default "1234"),
not a personal login. This plan replaces both with **one single APK**
called **DS Mobile**, where:

- **Everyone logs in with a generated ID + password** — staff exactly as
  today; **owner the same way, for the first time** (no more shared local
  passcode on Android).
- **Staff** see a fixed, simple screen set. No toggle, no "modes" — just
  what a staff member on the floor needs.
- **Owner** sees a **Lite / Pro toggle**. Lite = bare minimum (Sell + Add
  Stock only). Pro = the important owner-facing tools, curated for a
  phone — **not** a port of the entire Windows desktop app.
- Switching **into** Pro asks for the owner's fingerprint/PIN (the
  existing Phase 2 mechanism). Switching **back to** Lite needs nothing —
  going to the more-restrictive state is always free.
- The **role decides the ceiling; Pro Mode only reveals what that role
  already has permission to see.** This is not a new concept — it's the
  same principle already documented for Phase 6's PIN work: *"Pro Mode
  doesn't grant anything new — everything shown was already something
  that person's role can do."* Staff Pro (if it ever comes back) could
  never show owner data; Owner Lite hides things, it doesn't remove the
  owner's underlying permissions.

---

## 2. Login & identity model

### 2.1 Staff — unchanged
Exactly what exists today, nothing to build:
- Owner creates a staff account from **Staff Access Manager** (Windows or
  Android-Pro, see §4), which calls the `staff-manage` Edge Function ->
  `createStaffAccount()` in `src/services/staffAuth.ts`. This generates a
  `staff_login_id` (e.g. `STAFF-43MS`) and a password, tied to a synthetic
  email under the hood for Supabase Auth.
- Staff opens DS Mobile, enters that ID + password, done. Session
  persists (Phase 2's permanent background session); PIN/fingerprint
  unlock on top, same as now.

### 2.2 Owner — **new**
The owner must **also** get a generated ID + password, the same
mechanism as staff, instead of the old shared local passcode. Concretely:

- **Bootstrapping (first-ever owner login on a device with no owner
  account yet)**: the Windows/desktop app is the source of truth — this
  is where the store and the real Supabase Cloud Account (real email +
  password, `role = 'owner'`) already get created today (`CloudAuthPanel`
  / Cloud Sign-In). **That does not change** — the owner's real identity
  and the store itself are still created via email sign-up on Windows,
  exactly as now.
- What's new: once that owner cloud account exists, the **Windows app
  generates an Owner Android Login ID + password** for that same owner
  account — the exact same `staff-manage`-style flow, just issuing
  credentials for the owner's own `profiles` row instead of a new staff
  row. This becomes the credential the owner types into DS Mobile on
  their phone. **No email/password entry on Android at all, for anyone,
  ever** — matches "dusra koi option nahi."
- The owner can regenerate/reset this Android login credential from
  Windows at any time (lost phone, etc.) — same UX as resetting a staff
  password today.
- **Open question to confirm before building:** does the owner keep the
  ability to also use Cloud Sign-In (real email/password) on Android as
  a fallback, or is the generated ID+password truly the *only* door in on
  mobile? This plan assumes the latter (**ID+password only, no other
  option**) per the explicit instruction, but flagging it since it's a
  real behavior change from what exists today.

### 2.3 What gets removed
- The Android-only "choose: Staff Area / Owner Confidential Area" gate
  screen and the shared `ownerPasscode` unlock **go away entirely** on
  DS Mobile. Nobody picks a mode at the door — the account they log in
  with (staff ID vs owner ID) decides everything from then on.
- The two separate Tauri Android configs/build variants
  (`tauri.owner-android.conf.json`, `tauri.staff-android.conf.json`,
  `VITE_APP_VARIANT=owner|staff` in the CI matrix) **collapse into one**:
  a single `tauri.mobile-android.conf.json`-style config, single APK,
  single `productName: "DS Mobile"`, single `identifier`. Role is
  determined **after login**, from the signed-in profile's `role` column
  — not baked into the build.

---

## 3. Staff experience on DS Mobile (fixed — no toggle)

Five screens, one column, big touch targets (per the existing Android-UI
redesign direction already in `PROJECT_PLAN.md` Phase 4):

1. **Sell** — barcode/search → cart → bill. The core, most-used screen.
2. **Add Stock / Add Product** — including the AI photo-scan flow
   (front/back photo, auto-fill brand/model/compatible-models/screen
   size) exactly as it works on Windows today. Included specifically
   because it's a daily task — new glass/cover stock has to go in the
   moment it arrives, it can't wait for someone to be at a desktop.
3. **Today's Stock check** — search + quick view only. **No edit** —
   consistent with "staff ko add stock ka permission nahi rahega" being
   the one thing explicitly held back; browsing what's in stock is fine,
   changing it isn't (that's an owner/Pro action, see below — the "Add
   Stock" screen above is for *adding new items*, not editing existing
   ones; editing an existing product's price/stock stays an owner-only
   action, matching how it works today).
4. **Notifications** — low-stock alerts, anything that already pushes to
   Telegram, surfaced in-app too.
5. Sales total for the day, **count + ₹ total, no profit/margin** — a
   simple confirmation line, not a Galla/P&L screen. Cost price, margin,
   and profit stay invisible to staff everywhere in this app, matching
   the existing design principle stated in `PROJECT_PLAN.md` ("staff
   should not see profit, margin, cost price, or expenses").

**Explicitly correcting an earlier draft in this same conversation:**
Customer Khata, Held/Parked Bills, 2nd-Hand KYC entry, SIM Tracker/Repair
Ticketing/Xerox, Photo Stock Finder/Model Search, and Returns/Exchange
were floated earlier as a staff "Pro Mode" set. **Per the final
instruction, staff gets no mode toggle at all** — just the fixed 5-screen
set above. Those extra tools are **not** part of this phase; if any of
them turn out to be needed for staff later, that's a separate, explicit
follow-up request, not something this phase should sneak in.

---

## 4. Owner experience on DS Mobile — Lite / Pro toggle

### 4.1 Lite (the safer default)
Shows **only**:
- **Sell**
- **Add Stock / Add Product**

That's it. Everything else is hidden. No re-auth needed to *enter* Lite —
switching to the more-restrictive state is always free, from either
direction (first login or coming back from Pro).

### 4.2 Pro — "the important stuff," not the whole desktop
Everything in Lite, plus the **owner-only** tools that actually make
sense to reach for from a phone. Proposed set (this is the part most
worth confirming before building, since "important" is inherently a
judgment call):

- **Reports** — sales/profit, staff performance
- **Daily Galla closing** — full P&L, the real owner-facing version
- **Settings** — branding, PIN/fingerprint management, AI keys
- **Staff Access Manager** — create/reset/disable staff logins, set
  access windows (this is also *how the owner's own Android credential
  gets generated in the first place*, per §2.2 — so it has to be
  reachable from *somewhere*; Windows remains the primary place, but
  Pro Mode is the natural place to also expose "reset my own Android
  login" for when the owner is away from their desktop)
- **Price history / invoice rule customization**
- **Remote Force-Logout** (kill a staff session remotely)
- **Weekly/Daily Telegram digest toggle**
- **Full inventory browse + edit** (the one item that graduates from
  "view-only" in Lite/staff to "edit allowed" here — this is the owner's
  own data, always been allowed, Pro just surfaces it on mobile)

**Explicitly left out of Pro**, on purpose, because it doesn't hold up as
"important enough for a phone screen" and belongs to the desktop-only
category from the earlier "Option A" draft: bulk data tools, deep
multi-tab reporting, anything that's fundamentally a big-screen/keyboard
task. The in-app message for those stays what was already proposed:
point back to the Windows app.

### 4.3 Switching modes
- **Lite → Pro**: requires the owner's fingerprint (if enabled, Phase 6)
  or their PIN/password (whichever is set) — the exact same
  `handleBiometricUnlock` / PIN-verify flow already built for the
  personalPin gate, reused here rather than building a second auth path.
- **Pro → Lite**: no prompt, immediate.
- The mode choice is **remembered per device** (like the existing
  biometric opt-in pattern — local, not synced), so the owner doesn't
  have to re-pick it every cold start; only *entering* Pro from a locked/
  fresh state re-asks for fingerprint/PIN, consistent with §4.3's first
  rule.

---

## 5. Technical implementation approach

Reuses everything already built rather than starting over — this is
explicitly an **Android-only new screen tree**, not a rewrite:

1. **One build, not two.** Retire `tauri.owner-android.conf.json` /
   `tauri.staff-android.conf.json` and the `owner`/`staff` CI matrix
   entries; replace with a single `DS Mobile` Android build
   (`com.dsmobile.digitalhub`, one APK). The Windows build is untouched.
2. **Post-login role branch**, not a pre-login "choose" screen. After the
   existing sign-in (owner ID+password or staff ID+password) succeeds
   and `cloudProfile.role` is known, render one of two small trees:
   - `role === 'staff'` -> the fixed 5-screen staff tree (§3)
   - `role === 'owner' | 'manager'` -> the Lite/Pro owner tree (§4),
     defaulting to Lite on first login on a new device
3. **Reuse, don't duplicate, business logic.** Sell, Add Stock/AI-scan,
   Reports, Settings, etc. already exist as components/services in this
   codebase (Windows desktop) — the Android trees are thin
   navigation/layout wrappers around the *same* `services/*` calls
   (`repository.ts`, `pinAuth.ts`, `staffAuth.ts`, `aiOcr.ts`, etc.), not
   new business logic. Where a Windows screen is too dense for a phone
   (e.g. a wide reports table), it gets an Android-specific compact
   layout, but calls the same underlying data functions.
4. **Permission enforcement stays server-side**, exactly as it already is
   (RLS + `role` checks in RPCs). The Lite/Pro toggle and the staff
   feature list are **UI-layer visibility only** — even if someone
   tampered with the client to show a hidden screen, the underlying RPC
   calls still enforce the real role checks that already exist. This
   matches the "Pro Mode grants nothing new" principle from §1.

---

## 6. Rollout / migration notes

- Existing installed "DS Owner" and "DS Staff" APKs on real devices will
  need to be **replaced** by the new unified "DS Mobile" APK (different
  package identifier = a fresh install, not an in-place update, unless
  the identifier is kept identical to one of the two existing ones —
  worth deciding explicitly which, if either, to preserve for a smoother
  transition for anyone already using this app).
- The owner's very first Android login on their existing device will be
  the one **genuinely new step**: they'll need their Windows app updated
  first (to gain the "generate my own Android login" capability), open
  it, and generate their Android ID+password there before DS Mobile can
  be used at all. Worth a short one-time setup note in the app itself.

---

## 7. Open questions before implementation starts

Flagging these rather than guessing, since getting them wrong means
redoing real work:

1. **§2.2** — is the generated Owner ID+password truly the *only* login
   path on Android, with Cloud Sign-In (email/password) removed from
   mobile entirely? (This plan assumes yes.)
2. **§4.2** — does the proposed Pro feature list match what's actually
   wanted, or should anything be added/removed? ("Important" is a
   judgment call — flagging it explicitly rather than assuming this list
   is final.)
3. **§6** — keep one of the two existing package identifiers (so current
   installs upgrade in place) or ship a genuinely new one (clean slate,
   but every existing device needs a fresh install)?

---

_Once these are confirmed, the next step is turning this into tracked,
checkbox-style phase entries (matching every other phase in
`PROJECT_PLAN.md`) and starting implementation — not before._
