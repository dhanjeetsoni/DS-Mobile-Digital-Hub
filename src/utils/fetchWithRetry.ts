// Phase 6 — "Better Gemini key pool handling (fallback/retry instead of
// hard failures)".
//
// The server-side key pool (ai-gateway/index.ts's runWithGeminiFailover)
// already rotated across multiple Gemini API keys on quota/invalid/model-
// overloaded errors — that part was solid. What was missing on both ends:
//
// 1. Server-side: a genuine network-level error talking to Gemini (fetch
//    failing, a timeout, a stray 5xx with no recognizable Gemini error
//    shape) fell through classifyGeminiFailure() as `null` and was
//    re-thrown immediately, WITHOUT trying any other key in the pool — a
//    transient network blip looked identical to "every key is broken".
//    (Fixed directly in ai-gateway/index.ts, daily-digest-worker/index.ts,
//    and ai-price-advisor/index.ts's classifyGeminiFailure.)
//
// 2. Client-side: every AI call was a single fetch() attempt with no retry
//    at all — an Edge Function cold start, a dropped mobile-data packet, or
//    any other one-off network hiccup surfaced as an immediate hard error
//    ("AI unavailable — enter manually") even though trying again a moment
//    later would very likely have worked. This file is that retry layer.
//
// Deliberately narrow: retries ONLY on a thrown network exception or a 5xx
// response (both are transient-by-nature). A 4xx response (bad input,
// auth failure, rate limited) is returned immediately without retrying —
// retrying an actual bad request just wastes time and burns the rate
// limit further for no benefit.

export interface FetchRetryOptions {
  retries?: number;
  baseDelayMs?: number;
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  opts: FetchRetryOptions = {}
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const isLastAttempt = attempt === retries;
    try {
      const res = await fetch(url, options);
      // Success, a genuine bad-request/auth/rate-limit (4xx — retrying
      // won't fix it), or we're out of attempts anyway: hand the Response
      // back as-is and let the caller's existing res.ok/json() handling
      // take over exactly like a plain fetch() would.
      if (res.ok || (res.status >= 400 && res.status < 500) || isLastAttempt) {
        return res;
      }
      // 5xx with attempts remaining — fall through to the retry delay below.
    } catch (err) {
      lastErr = err;
      if (isLastAttempt) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt)));
  }
  // Unreachable in practice (the loop always returns or throws above on
  // isLastAttempt), but keeps TypeScript happy about a return on every path.
  throw lastErr ?? new Error("Request failed after retries.");
}
