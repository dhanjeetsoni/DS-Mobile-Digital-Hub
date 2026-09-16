/**
 * Phase 11: Multi-Provider AI Adapter
 *
 * Provides a unified abstraction over Google Gemini, OpenAI, Anthropic Claude,
 * Groq, and OpenRouter, allowing the AI Key Pool and failover mechanism to seamlessly
 * rotate across any mix of keys and providers.
 */

export type AiProvider = "gemini" | "openai" | "anthropic" | "groq" | "openrouter";

export interface AiKeyConfig {
  slot: number;
  apiKey: string;
  provider: AiProvider;
  model?: string;
  label?: string | null;
}

export interface AiGenerateOptions {
  systemInstruction?: string;
  prompt: string;
  imageBase64?: string;
  imageMimeType?: string;
  temperature?: number;
  maxTokens?: number;
  responseMimeType?: "application/json" | "text/plain";
  timeoutMs?: number;
}

export interface AiGenerateResult {
  text: string;
  provider: AiProvider;
  model: string;
}

export type FailureClassification = "quota" | "invalid" | "unavailable" | null;

/** Default models per provider */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: "gemini-3.8-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  groq: "llama-3.3-70b-versatile",
  openrouter: "google/gemini-2.5-flash",
};

/** Default vision/multimodal models if image is included */
export const DEFAULT_VISION_MODELS: Record<AiProvider, string> = {
  gemini: "gemini-3.8-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  groq: "llama-3.2-11b-vision-preview",
  openrouter: "google/gemini-2.5-flash",
};

/**
 * Auto-detect provider from API key formatting
 */
export function detectProviderFromKey(key: string, explicit?: string | null): AiProvider {
  if (explicit && ["gemini", "openai", "anthropic", "groq", "openrouter"].includes(explicit.toLowerCase())) {
    return explicit.toLowerCase() as AiProvider;
  }
  const clean = (key || "").trim();
  if (clean.startsWith("sk-ant-")) return "anthropic";
  if (clean.startsWith("gsk_")) return "groq";
  if (clean.startsWith("sk-or-")) return "openrouter";
  if (clean.startsWith("AIza")) return "gemini";
  if (clean.startsWith("sk-")) return "openai";
  return "gemini";
}

/**
 * Classifies an error from an AI provider into failover actions:
 * - "quota": 429, rate limit, quota exceeded -> rotate to next key and cool down 60s
 * - "invalid": 401, 403, invalid key -> mark invalid and disable slot
 * - "unavailable": 500, 502, 503, 504 -> retryable temporary server failure
 * - null: unknown or client-side non-fatal error
 */
export function classifyProviderError(err: any, status?: number): FailureClassification {
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "invalid";
  if (status && status >= 500 && status <= 599) return "unavailable";

  const msg = (err?.message || (typeof err === "string" ? err : "")).toLowerCase();

  if (
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("rate_limit") ||
    msg.includes("resource_exhausted") ||
    msg.includes("tokens per min") ||
    msg.includes("requests per min") ||
    msg.includes("timed out") ||
    msg.includes("timeout")
  ) {
    return "quota";
  }

  if (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("invalid_api_key") ||
    msg.includes("authentication") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("api key not valid")
  ) {
    return "invalid";
  }

  if (
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("overloaded") ||
    msg.includes("service unavailable") ||
    msg.includes("bad gateway")
  ) {
    return "unavailable";
  }

  return null;
}

/**
 * Executes an AI generation request using the appropriate provider adapter.
 */
export async function executeAiRequest(
  config: AiKeyConfig,
  options: AiGenerateOptions
): Promise<AiGenerateResult> {
  const provider = config.provider || detectProviderFromKey(config.apiKey);
  const isMultimodal = Boolean(options.imageBase64);
  const model =
    config.model ||
    (isMultimodal ? DEFAULT_VISION_MODELS[provider] : DEFAULT_MODELS[provider]);

  const timeoutMs = options.timeoutMs || 25_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    switch (provider) {
      case "gemini":
        return await callGeminiAdapter(config.apiKey, model, options, controller.signal);
      case "openai":
        return await callOpenAiAdapter(config.apiKey, model, options, controller.signal);
      case "anthropic":
        return await callAnthropicAdapter(config.apiKey, model, options, controller.signal);
      case "groq":
        return await callGroqAdapter(config.apiKey, model, options, controller.signal);
      case "openrouter":
        return await callOpenRouterAdapter(config.apiKey, model, options, controller.signal);
      default:
        return await callGeminiAdapter(config.apiKey, model, options, controller.signal);
    }
  } finally {
    clearTimeout(timer);
  }
}

/* ========================================================================= */
/* Provider Implementations                                                  */
/* ========================================================================= */

async function callGeminiAdapter(
  apiKey: string,
  model: string,
  options: AiGenerateOptions,
  signal: AbortSignal
): Promise<AiGenerateResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const parts: any[] = [];
  if (options.imageBase64) {
    parts.push({
      inlineData: {
        mimeType: options.imageMimeType || "image/jpeg",
        data: options.imageBase64,
      },
    });
  }
  parts.push({ text: options.prompt });

  const body: any = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: options.temperature ?? 0.3,
      maxOutputTokens: options.maxTokens ?? 2048,
    },
  };

  if (options.systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: options.systemInstruction }],
    };
  }

  if (options.responseMimeType === "application/json") {
    body.generationConfig.responseMimeType = "application/json";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    const errorObj = new Error(`Gemini API error (${res.status}): ${errorText}`);
    (errorObj as any).status = res.status;
    throw errorObj;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return { text, provider: "gemini", model };
}

async function callOpenAiAdapter(
  apiKey: string,
  model: string,
  options: AiGenerateOptions,
  signal: AbortSignal
): Promise<AiGenerateResult> {
  const url = "https://api.openai.com/v1/chat/completions";

  const messages: any[] = [];
  if (options.systemInstruction) {
    messages.push({ role: "system", content: options.systemInstruction });
  }

  if (options.imageBase64) {
    const mime = options.imageMimeType || "image/jpeg";
    messages.push({
      role: "user",
      content: [
        { type: "text", text: options.prompt },
        {
          type: "image_url",
          image_url: { url: `data:${mime};base64,${options.imageBase64}` },
        },
      ],
    });
  } else {
    messages.push({ role: "user", content: options.prompt });
  }

  const body: any = {
    model,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 2048,
  };

  if (options.responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    const errorObj = new Error(`OpenAI API error (${res.status}): ${errorText}`);
    (errorObj as any).status = res.status;
    throw errorObj;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return { text, provider: "openai", model };
}

async function callAnthropicAdapter(
  apiKey: string,
  model: string,
  options: AiGenerateOptions,
  signal: AbortSignal
): Promise<AiGenerateResult> {
  const url = "https://api.anthropic.com/v1/messages";

  const messages: any[] = [];
  if (options.imageBase64) {
    const mime = options.imageMimeType || "image/jpeg";
    messages.push({
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mime,
            data: options.imageBase64,
          },
        },
        { type: "text", text: options.prompt },
      ],
    });
  } else {
    messages.push({ role: "user", content: options.prompt });
  }

  let system = options.systemInstruction || "";
  if (options.responseMimeType === "application/json") {
    system = (system ? system + "\n\n" : "") + "CRITICAL: You MUST respond ONLY with valid, raw JSON. No markdown backticks, no markdown formatting.";
  }

  const body: any = {
    model,
    messages,
    max_tokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? 0.3,
  };
  if (system) body.system = system;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    const errorObj = new Error(`Anthropic API error (${res.status}): ${errorText}`);
    (errorObj as any).status = res.status;
    throw errorObj;
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text || "";
  return { text, provider: "anthropic", model };
}

async function callGroqAdapter(
  apiKey: string,
  model: string,
  options: AiGenerateOptions,
  signal: AbortSignal
): Promise<AiGenerateResult> {
  const url = "https://api.groq.com/openai/v1/chat/completions";

  const messages: any[] = [];
  if (options.systemInstruction) {
    messages.push({ role: "system", content: options.systemInstruction });
  }

  if (options.imageBase64) {
    const mime = options.imageMimeType || "image/jpeg";
    messages.push({
      role: "user",
      content: [
        { type: "text", text: options.prompt },
        {
          type: "image_url",
          image_url: { url: `data:${mime};base64,${options.imageBase64}` },
        },
      ],
    });
  } else {
    messages.push({ role: "user", content: options.prompt });
  }

  const body: any = {
    model,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 2048,
  };

  if (options.responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    const errorObj = new Error(`Groq API error (${res.status}): ${errorText}`);
    (errorObj as any).status = res.status;
    throw errorObj;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return { text, provider: "groq", model };
}

async function callOpenRouterAdapter(
  apiKey: string,
  model: string,
  options: AiGenerateOptions,
  signal: AbortSignal
): Promise<AiGenerateResult> {
  const url = "https://openrouter.ai/api/v1/chat/completions";

  const messages: any[] = [];
  if (options.systemInstruction) {
    messages.push({ role: "system", content: options.systemInstruction });
  }

  if (options.imageBase64) {
    const mime = options.imageMimeType || "image/jpeg";
    messages.push({
      role: "user",
      content: [
        { type: "text", text: options.prompt },
        {
          type: "image_url",
          image_url: { url: `data:${mime};base64,${options.imageBase64}` },
        },
      ],
    });
  } else {
    messages.push({ role: "user", content: options.prompt });
  }

  const body: any = {
    model,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 2048,
  };

  if (options.responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://dsmobile.local",
      "X-Title": "DS Mobile Hub",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    const errorObj = new Error(`OpenRouter API error (${res.status}): ${errorText}`);
    (errorObj as any).status = res.status;
    throw errorObj;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return { text, provider: "openrouter", model };
}
