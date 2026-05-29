/**
 * Multi-provider support. The Claude Agent SDK talks the Anthropic Messages
 * API, and several top models expose an Anthropic-compatible endpoint, so we
 * can drive them by setting ANTHROPIC_BASE_URL + auth + (optionally) the
 * ANTHROPIC_DEFAULT_*_MODEL alias remap that Claude Code honors.
 *
 * Because every phase is its own query(), the provider can even be switched
 * per phase (e.g. plan on Claude, code on Qwen) via TURNKEY_PROVIDER_<PHASE>.
 *
 * Verified endpoints (May 2026):
 *   - Qwen     https://dashscope-intl.aliyuncs.com/api/v2/apps/claude-code-proxy  (DASHSCOPE_API_KEY)
 *   - DeepSeek https://api.deepseek.com/anthropic                                 (DEEPSEEK_API_KEY)
 *   - Kimi     https://api.moonshot.ai/anthropic                                  (MOONSHOT_API_KEY)
 *   - GLM      https://api.z.ai/api/anthropic                                     (ZAI_API_KEY)
 */
import type { PhaseId } from "./types.ts";

type AuthVia = "login" | "api_key" | "auth_token";

export interface ProviderSpec {
  readonly id: string;
  readonly label: string;
  /** undefined => default Anthropic endpoint. */
  readonly baseUrl?: string;
  /** Env var the user populates with their key for this provider. */
  readonly keyEnv?: string;
  readonly authVia: AuthVia;
  /**
   * Alias->model remap for endpoints that need explicit provider model ids.
   * Omitted for providers whose endpoint auto-maps claude-* names (Qwen proxy,
   * DeepSeek).
   */
  readonly defaultModels?: { opus?: string; sonnet?: string; haiku?: string };
}

export const PROVIDERS: Record<string, ProviderSpec> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    authVia: "login", // ANTHROPIC_API_KEY optional; otherwise Claude Code login
    keyEnv: "ANTHROPIC_API_KEY",
  },
  qwen: {
    id: "qwen",
    label: "Qwen (Alibaba DashScope)",
    baseUrl: "https://dashscope-intl.aliyuncs.com/api/v2/apps/claude-code-proxy",
    keyEnv: "DASHSCOPE_API_KEY",
    authVia: "auth_token",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/anthropic",
    keyEnv: "DEEPSEEK_API_KEY",
    authVia: "api_key",
  },
  kimi: {
    id: "kimi",
    label: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.ai/anthropic",
    keyEnv: "MOONSHOT_API_KEY",
    authVia: "auth_token",
    defaultModels: { opus: "kimi-k2.5", sonnet: "kimi-k2.5", haiku: "kimi-k2.5" },
  },
  glm: {
    id: "glm",
    label: "GLM (Z.ai)",
    baseUrl: "https://api.z.ai/api/anthropic",
    keyEnv: "ZAI_API_KEY",
    authVia: "auth_token",
    defaultModels: { opus: "glm-4.6", sonnet: "glm-4.6", haiku: "glm-4.5-air" },
  },
  custom: {
    id: "custom",
    label: "Custom (Anthropic-compatible)",
    authVia: "auth_token", // configured entirely from TURNKEY_* env vars
  },
};

/** Captured once at load so the anthropic provider can restore a user key. */
const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const CROSS_PROVIDER_VARS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
] as const;

function clearProviderEnv(): void {
  for (const v of CROSS_PROVIDER_VARS) delete process.env[v];
}

function setDefaultModels(models?: ProviderSpec["defaultModels"]): void {
  if (!models) return;
  if (models.opus) process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = models.opus;
  if (models.sonnet) {
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = models.sonnet;
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = models.sonnet;
  }
  if (models.haiku) process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = models.haiku;
}

function applyCustom(): ProviderSpec {
  const baseUrl = process.env.TURNKEY_BASE_URL?.trim();
  const apiKey = process.env.TURNKEY_API_KEY?.trim();
  const authToken = process.env.TURNKEY_AUTH_TOKEN?.trim();
  if (!baseUrl)
    throw new Error("provider 'custom' requires TURNKEY_BASE_URL to be set.");
  if (!apiKey && !authToken)
    throw new Error("provider 'custom' requires TURNKEY_API_KEY or TURNKEY_AUTH_TOKEN.");
  clearProviderEnv();
  delete process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_BASE_URL = baseUrl;
  if (authToken) process.env.ANTHROPIC_AUTH_TOKEN = authToken;
  else process.env.ANTHROPIC_API_KEY = apiKey;
  setDefaultModels({
    opus: process.env.TURNKEY_DEFAULT_OPUS_MODEL,
    sonnet: process.env.TURNKEY_DEFAULT_SONNET_MODEL,
    haiku: process.env.TURNKEY_DEFAULT_HAIKU_MODEL,
  });
  return PROVIDERS.custom!;
}

/**
 * Mutates process.env so the next query() targets this provider. Safe to call
 * repeatedly (e.g. once per phase) because it resets cross-provider vars first.
 * Throws a clear error if a required key is missing.
 */
export function applyProvider(id: string): ProviderSpec {
  const p = PROVIDERS[id];
  if (!p)
    throw new Error(
      `Unknown provider '${id}'. Known: ${Object.keys(PROVIDERS).join(", ")}`,
    );

  if (p.id === "custom") return applyCustom();

  clearProviderEnv();

  if (p.authVia === "login") {
    // Restore the user's original key (if any); unset => Claude Code login.
    if (ORIGINAL_ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
    else delete process.env.ANTHROPIC_API_KEY;
    return p;
  }

  const key = p.keyEnv ? process.env[p.keyEnv]?.trim() : "";
  if (!key)
    throw new Error(
      `provider '${id}' (${p.label}) requires ${p.keyEnv}. Set it in your environment or .env.`,
    );
  if (p.baseUrl) process.env.ANTHROPIC_BASE_URL = p.baseUrl;
  if (p.authVia === "auth_token") {
    process.env.ANTHROPIC_AUTH_TOKEN = key;
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = key;
  }
  setDefaultModels(p.defaultModels);
  return p;
}

/** Which provider a given phase should use (per-phase env override wins). */
export function providerForPhase(phase: PhaseId, fallback: string): string {
  const group: Record<PhaseId, string> = {
    plan: "PLAN",
    scaffold: "BUILD",
    implement: "BUILD",
    verify: "VERIFY",
    deploy: "BUILD",
    finalize: "FINALIZE",
  };
  return process.env[`TURNKEY_PROVIDER_${group[phase]}`]?.trim() || fallback;
}

/** True if the provider can run without further setup (key present or login). */
export function providerReady(id: string): { ok: boolean; reason: string } {
  const p = PROVIDERS[id];
  if (!p) return { ok: false, reason: `unknown provider '${id}'` };
  if (p.id === "custom") {
    const hasBase = !!process.env.TURNKEY_BASE_URL?.trim();
    const hasKey = !!(process.env.TURNKEY_API_KEY?.trim() || process.env.TURNKEY_AUTH_TOKEN?.trim());
    return hasBase && hasKey
      ? { ok: true, reason: "custom endpoint configured" }
      : { ok: false, reason: "set TURNKEY_BASE_URL and TURNKEY_API_KEY/TURNKEY_AUTH_TOKEN" };
  }
  if (p.authVia === "login")
    return {
      ok: true,
      reason: process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : "Claude Code login",
    };
  const has = !!(p.keyEnv && process.env[p.keyEnv]?.trim());
  return has
    ? { ok: true, reason: `${p.keyEnv} set` }
    : { ok: false, reason: `missing ${p.keyEnv}` };
}

export function knownProviders(): string[] {
  return Object.keys(PROVIDERS);
}
