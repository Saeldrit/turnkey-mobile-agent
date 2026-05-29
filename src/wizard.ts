#!/usr/bin/env -S npx tsx
/**
 * Wizard — the straight "build one app" flow (no menu). `npm run wizard`.
 * The full menu (`npm start`) wraps this plus status / resume / install.
 */
import { Tui } from "./tui.ts";
import { loadEnv } from "./env.ts";
import { collectBuildOptions } from "./interactive.ts";
import { build } from "./orchestrator.ts";
import { ProgressReporter } from "./progress.ts";
import { log } from "./logger.ts";

async function main(): Promise<void> {
  await loadEnv();
  log.banner("TURNKEY MOBILE — мастер сборки");
  console.log("  Нативное Android-приложение (Kotlin + Compose) под ключ. Ctrl+C — выход.");
  const tui = new Tui();
  let opts;
  try {
    opts = await collectBuildOptions(tui);
  } finally {
    tui.close();
  }
  if (!opts) return;
  await build(opts, new ProgressReporter());
}

void main().catch((e) => {
  log.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
