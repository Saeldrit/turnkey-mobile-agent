/**
 * Runs a single phase as one bounded SDK query: builds options, applies the
 * phase's provider, streams the agent's activity, and captures usage/cost.
 *
 * Two output modes:
 *  - verbose (no reporter): logs every tool call — used by the flag CLI / CI.
 *  - progress (reporter given): feeds a compact "[NN%] phase · action" line —
 *    used by the interactive menu/wizard.
 *
 * Each phase is its own query() with a fresh, lean context — what keeps token
 * use bounded and makes the build resilient to (and recoverable from) compaction.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildSystemPrompt } from "./systemPrompt.ts";
import { modelForPhase, MAX_TURNS, TOOLS_FOR_PHASE } from "./config.ts";
import { applyProvider, providerForPhase } from "./providers.ts";
import { log, truncate } from "./logger.ts";
import type { ProgressReporter } from "./progress.ts";
import type { PhaseSpec, PhaseContext } from "./phases.ts";
import type { PhaseResult, PhaseUsage } from "./types.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Transient API/network errors worth retrying (a socket blip shouldn't kill a long build). */
function isTransient(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return [
    "socket",
    "econnreset",
    "closed unexpectedly",
    "fetch failed",
    "network",
    "etimedout",
    "timed out",
    "enotfound",
    "eai_again",
    "overloaded",
    "rate limit",
    "429",
    "500",
    "502",
    "503",
    "504",
  ].some((s) => msg.includes(s));
}

function emptyUsage(): PhaseUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  };
}

type AnyBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
};

function summarizeToolInput(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  switch (name) {
    case "Bash":
    case "PowerShell":
      return pick("command");
    case "Write":
    case "Read":
    case "Edit":
      return pick("file_path");
    case "Glob":
    case "Grep":
      return pick("pattern") + (pick("path") ? ` in ${pick("path")}` : "");
    case "Agent":
      return pick("description") || pick("subagent_type");
    case "WebFetch":
    case "WebSearch":
      return pick("url") || pick("query") || pick("prompt");
    default: {
      try {
        return truncate(JSON.stringify(i), 120);
      } catch {
        return "";
      }
    }
  }
}

/** Russian verb for the progress line, by tool. */
function actionVerb(name: string): string {
  switch (name) {
    case "Write": return "пишу";
    case "Edit": return "правлю";
    case "Read": return "читаю";
    case "Bash":
    case "PowerShell": return "выполняю";
    case "Glob":
    case "Grep": return "ищу";
    case "Agent": return "делегирую";
    case "WebFetch":
    case "WebSearch": return "смотрю в сети";
    default: return name;
  }
}

/** Shorten a long absolute path to its last couple of segments. */
function shortDetail(detail: string): string {
  const parts = detail.replace(/\\/g, "/").split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : detail;
}

function renderAssistant(content: unknown, reporter?: ProgressReporter): void {
  if (!Array.isArray(content)) return;
  for (const raw of content as AnyBlock[]) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.type === "tool_use" && raw.name) {
      const detail = summarizeToolInput(raw.name, raw.input);
      if (reporter) reporter.setAction(`${actionVerb(raw.name)} ${shortDetail(detail)}`.trim());
      else log.tool(raw.name, detail);
    } else if (raw.type === "text" && raw.text) {
      if (!reporter) log.agentText(raw.text);
    } else if (raw.type === "thinking" && raw.thinking) {
      if (!reporter) log.thinking(raw.thinking);
    }
  }
}

function readUsage(msg: Record<string, unknown>): PhaseUsage {
  const u = (msg.usage ?? {}) as Record<string, number>;
  return {
    inputTokens: Number(u.input_tokens ?? 0),
    outputTokens: Number(u.output_tokens ?? 0),
    cacheReadTokens: Number(u.cache_read_input_tokens ?? 0),
    cacheCreationTokens: Number(u.cache_creation_input_tokens ?? 0),
    costUsd: Number(msg.total_cost_usd ?? 0),
  };
}

export async function runPhase(
  spec: PhaseSpec,
  ctx: PhaseContext,
  reporter?: ProgressReporter,
): Promise<PhaseResult> {
  const model = modelForPhase(spec.id);
  const startedAt = process.hrtime.bigint();

  const providerId = providerForPhase(spec.id, ctx.provider);
  const provider = applyProvider(providerId);
  if (!reporter) {
    const via = process.env.ANTHROPIC_BASE_URL ? ` @ ${process.env.ANTHROPIC_BASE_URL}` : "";
    log.info(
      `provider=${provider.label}${via} model=${model} maxTurns=${MAX_TURNS[spec.id]} tools=[${TOOLS_FOR_PHASE[spec.id].join(", ")}]`,
    );
  }

  const prompt = spec.buildPrompt(ctx);
  const options = {
    systemPrompt: {
      type: "preset" as const,
      preset: "claude_code" as const,
      append: buildSystemPrompt(ctx.appDir, ctx.slug),
    },
    model,
    cwd: ctx.appDir,
    allowedTools: TOOLS_FOR_PHASE[spec.id],
    permissionMode: "bypassPermissions" as const,
    maxTurns: MAX_TURNS[spec.id],
    settingSources: [] as ("user" | "project" | "local")[],
  };

  let sessionId: string | undefined;
  let usage: PhaseUsage = emptyUsage();
  let subtype = "unknown";
  let numTurns = 0;
  let ok = false;

  const MAX_ATTEMPTS = 4;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    sessionId = undefined;
    usage = emptyUsage();
    subtype = "unknown";
    numTurns = 0;
    ok = false;
    try {
      for await (const message of query({ prompt, options })) {
        const m = message as unknown as Record<string, unknown>;
        const type = m.type as string;
        if (type === "system" && m.subtype === "init") {
          sessionId = m.session_id as string | undefined;
          if (!reporter) {
            const mdl = (m.model as string) ?? model;
            log.step(`session started (${mdl})${attempt > 1 ? ` [retry ${attempt}]` : ""}`);
          }
        } else if (type === "assistant") {
          renderAssistant((m.message as Record<string, unknown>)?.content, reporter);
        } else if (type === "result") {
          subtype = (m.subtype as string) ?? "unknown";
          numTurns = Number(m.num_turns ?? 0);
          usage = readUsage(m);
          ok = subtype === "success";
        }
      }
      break;
    } catch (err) {
      if (attempt < MAX_ATTEMPTS && isTransient(err)) {
        const wait = 2000 * attempt + 1000;
        const short = (err instanceof Error ? err.message : String(err)).slice(0, 120);
        if (reporter) reporter.setAction(`сетевой сбой — повтор ${attempt}/${MAX_ATTEMPTS}…`);
        else log.warn(`transient error (attempt ${attempt}/${MAX_ATTEMPTS}): ${short} — retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }

  const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
  return { phase: spec.id, ok, subtype, numTurns, sessionId, usage, durationMs };
}
