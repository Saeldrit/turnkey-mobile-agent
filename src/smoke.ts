/**
 * Smoke test: confirms the Agent SDK can start and authenticate BEFORE you
 * spend a full build. Runs a single no-tool query and prints the result.
 *
 *   npm run smoke                 # default provider (anthropic / Claude login)
 *   npm run smoke -- qwen         # test a specific provider's key + endpoint
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadEnv } from "./env.ts";
import { applyProvider, providerReady, knownProviders } from "./providers.ts";
import { log } from "./logger.ts";

async function main(): Promise<void> {
  await loadEnv();
  log.banner("SDK SMOKE TEST");

  const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const provider = (arg || process.env.TURNKEY_PROVIDER || "anthropic").toLowerCase();
  if (!knownProviders().includes(provider)) {
    log.error(`Unknown provider '${provider}'. Known: ${knownProviders().join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const ready = providerReady(provider);
  if (!ready.ok) {
    log.error(`Provider '${provider}' not ready: ${ready.reason}. Set the key in .env.`);
    process.exitCode = 1;
    return;
  }
  try {
    applyProvider(provider);
  } catch (err) {
    log.error((err as Error).message);
    process.exitCode = 1;
    return;
  }
  log.info(`Provider: ${provider} (${ready.reason})${process.env.ANTHROPIC_BASE_URL ? " @ " + process.env.ANTHROPIC_BASE_URL : ""}`);

  let ok = false;
  let resultText = "";
  try {
    for await (const message of query({
      prompt: "Reply with exactly the token SDK_OK and nothing else.",
      options: { maxTurns: 1, allowedTools: [], settingSources: [] },
    })) {
      const m = message as unknown as Record<string, unknown>;
      if (m.type === "system" && m.subtype === "init") {
        log.step(`session ${String(m.session_id).slice(0, 8)}… model ${String(m.model ?? "default")}`);
      } else if (m.type === "result") {
        resultText = String(m.result ?? "");
        ok = m.subtype === "success";
        log.usage("smoke", Number(m.total_cost_usd ?? 0), 0, 0);
      }
    }
  } catch (err) {
    log.error("SDK failed to run: " + (err instanceof Error ? err.message : String(err)));
    log.warn("If this is an auth error: run `claude` once to log in (anthropic), or check the provider key/endpoint.");
    process.exitCode = 1;
    return;
  }

  if (ok) log.success(`SDK is working. Model replied: ${resultText.trim().slice(0, 40)}`);
  else {
    log.error("SDK ran but did not return success. Check auth / model availability.");
    process.exitCode = 1;
  }
}

void main();
