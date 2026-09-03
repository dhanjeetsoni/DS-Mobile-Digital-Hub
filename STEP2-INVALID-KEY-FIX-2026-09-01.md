# Step 2 fix — Gemini key pool now actually distinguishes "quota" vs "invalid"

## The bug
`get_gemini_key_status()` / `AiKeyPoolPanel.tsx` define a 🔴 "Invalid" status,
and `server.ts`'s `loadKeyPool()` already had a `.neq("status", "invalid")`
filter meant to permanently exclude bad keys from rotation. But nothing ever
set a key's status to `'invalid'` — every failure (temporary quota limit OR a
flat-out wrong/revoked API key) was written back as `'exhausted'` with a
60-second cooldown. A permanently bad key would silently retry forever every
rotation cycle, and the Owner would only ever see "🟡 Resting (cooldown)",
never "🔴 Invalid" — no way to tell "this key just needs to wait a minute"
from "this key is dead and needs replacing."

## The fix (`server.ts`)
- `isQuotaOrAuthError()` (yes/no) replaced with `classifyGeminiFailure()`,
  which returns `"quota" | "invalid" | null`:
  - `"quota"` — HTTP 429 / "quota" / "resource_exhausted" / "rate limit" →
    unchanged behavior: `status = 'exhausted'`, 60s cooldown, auto-retried.
  - `"invalid"` — HTTP 401/403 / "permission_denied" / "unauthenticated" /
    "api key not valid" / "api_key_invalid" / "invalid api key" /
    "key not found" / "...API has not been used..." (disabled-API message) →
    **new**: `status = 'invalid'`, no cooldown set, permanently excluded from
    `loadKeyPool()`'s query until the Owner re-saves that slot (which resets
    it to `'active'` via the existing `save_gemini_api_key` RPC — no UI
    change needed for recovery).
  - `null` — anything else (bad request, network hiccup) — unchanged
    behavior: not treated as a key problem, no rotation, error surfaces
    immediately.
- `markKeyResult()` now takes an optional `failureStatus` ("exhausted" |
  "invalid", default "exhausted") and writes the right one, with
  `cooldown_until` only set for the "exhausted" case.
- `runWithGeminiFailover()` classifies the caught error once per attempt and
  passes the right status through.

## Verified
- `npx tsc --noEmit -p tsconfig.json` — 0 errors, whole project, after `npm
  install` succeeded in this sandbox.
- Standalone unit test of the classifier logic against 9 realistic Gemini
  error shapes (429/quota messages, 401/403/API-key-invalid/disabled-API
  messages, and two non-key errors) — 9/9 correct.
- Did not re-verify against the *live* Gemini API (no real bad/good key pair
  available here) — the classification is pattern-matched against Gemini's
  documented/observed error shapes, not exhaustively fuzzed against the live
  service.

## Not changed in this pass
The other two gaps flagged earlier are still open, by choice (only this one
was asked for):
- `record_gemini_key_usage()` RPC remains unused dead code — `server.ts`
  still writes directly to `gemini_api_keys` via the service-role client.
- `AiKeyPoolPanel.tsx` still has no UI input for a key's `label`.
