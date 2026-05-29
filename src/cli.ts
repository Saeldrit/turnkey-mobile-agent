#!/usr/bin/env -S npx tsx
/**
 * CLI entry point. Resolves a task spec + options and runs the build.
 *
 * Usage:
 *   npm start -- "Build a habit tracker with reminders and a weekly chart"
 *   npm start -- --task-file ./examples/todo.task.md --slug todo --resume
 *   npm start -- "..." --plan-only
 *
 * Flags:
 *   --task-file <path>   Read the app spec from a file instead of the argument.
 *   --slug <slug>        App slug (kebab-case). Default: derived from the task.
 *   --out <dir>          Output root for generated apps. Default: ./workspace
 *   --app-dir <dir>      Explicit target dir (overrides --out/--slug).
 *   --max-cost <usd>     Hard cost ceiling for the whole build.
 *   --resume             Skip phases already completed in BUILD_STATE.json.
 *   --plan-only          Stop after the PLAN phase.
 *   --help               Show this help.
 */
import { readFile } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { existsSync } from "node:fs";
import { build } from "./orchestrator.ts";
import { DEFAULT_MAX_COST_USD } from "./config.ts";
import { providerReady, knownProviders, PROVIDERS } from "./providers.ts";
import { loadEnv } from "./env.ts";
import { slugify } from "./slug.ts";
import { log } from "./logger.ts";
import type { BuildOptions } from "./types.ts";

interface RawArgs {
  task: string;
  taskFile?: string;
  slug?: string;
  provider?: string;
  out?: string;
  appDir?: string;
  maxCost?: number;
  resume: boolean;
  planOnly: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): RawArgs {
  const positional: string[] = [];
  const out: RawArgs = { task: "", resume: false, planOnly: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? "";
    switch (a) {
      case "--task-file": out.taskFile = next(); break;
      case "--slug": out.slug = next(); break;
      case "--provider": out.provider = next(); break;
      case "--out": out.out = next(); break;
      case "--app-dir": out.appDir = next(); break;
      case "--max-cost": out.maxCost = Number(next()); break;
      case "--resume": out.resume = true; break;
      case "--plan-only": out.planOnly = true; break;
      case "-h":
      case "--help": out.help = true; break;
      default:
        if (a && !a.startsWith("--")) positional.push(a);
    }
  }
  out.task = positional.join(" ").trim();
  return out;
}

const HELP = `
turnkey-mobile — autonomously build a deployable native Android (Kotlin + Compose) app.

  npx tsx src/cli.ts "A habit tracker with reminders and a weekly progress chart"
  npx tsx src/cli.ts --task-file ./examples/notes.task.md --slug notes
  npx tsx src/cli.ts "..." --provider qwen     # build using Qwen instead of Claude
  npx tsx src/cli.ts "..." --resume            # continue an interrupted build
  npx tsx src/cli.ts "..." --plan-only         # only produce PLAN.md + BUILD_STATE.json

Flags: --task-file <path> --slug <s> --provider <id> --out <dir> --app-dir <dir>
       --max-cost <usd> --resume --plan-only --help

Providers: ${knownProviders().join(", ")}
  Set the matching key env (DASHSCOPE_API_KEY for qwen, DEEPSEEK_API_KEY, MOONSHOT_API_KEY,
  ZAI_API_KEY) in your .env. Mix providers per phase with TURNKEY_PROVIDER_PLAN / _BUILD /
  _VERIFY / _FINALIZE (e.g. plan on Claude, code on Qwen).
`;

async function main(): Promise<void> {
  await loadEnv();
  const raw = parseArgs(process.argv.slice(2));

  if (raw.help) {
    console.log(HELP);
    return;
  }

  let task = raw.task;
  if (raw.taskFile) {
    const p = resolve(process.cwd(), raw.taskFile);
    if (!existsSync(p)) {
      log.error(`Task file not found: ${p}`);
      process.exitCode = 1;
      return;
    }
    task = (await readFile(p, "utf8")).trim();
  }

  // Robustness: if the spec arrives as a bare file path (e.g. a launcher such
  // as `npm run` strips the --task-file flag but keeps its value), detect the
  // path and read the file anyway.
  if (!raw.taskFile && task) {
    const firstTok = task.split(/\s+/)[0] ?? "";
    const candidate = resolve(process.cwd(), firstTok);
    if (/\.(md|txt|task)$/i.test(firstTok) && existsSync(candidate)) {
      task = (await readFile(candidate, "utf8")).trim();
      if (!raw.slug)
        raw.slug = basename(firstTok)
          .replace(/\.(md|txt)$/i, "")
          .replace(/\.task$/i, "");
      log.info(`Detected spec file from positional arg: ${firstTok}`);
    }
  }

  if (!task) {
    log.error("No task provided. Pass a description or --task-file. Use --help.");
    process.exitCode = 1;
    return;
  }

  const slug = (raw.slug && slugify(raw.slug)) || slugify(task);
  const outRoot = raw.out ? resolve(process.cwd(), raw.out) : resolve(process.cwd(), "workspace");
  const appDir = raw.appDir ? resolve(process.cwd(), raw.appDir) : join(outRoot, slug);
  const maxCostUsd =
    Number.isFinite(raw.maxCost) && (raw.maxCost as number) > 0
      ? (raw.maxCost as number)
      : Number(process.env.TURNKEY_MAX_COST_USD) > 0
        ? Number(process.env.TURNKEY_MAX_COST_USD)
        : DEFAULT_MAX_COST_USD;

  const provider = (raw.provider || process.env.TURNKEY_PROVIDER || "anthropic").toLowerCase();
  if (!knownProviders().includes(provider)) {
    log.error(`Unknown provider '${provider}'. Known: ${knownProviders().join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const ready = providerReady(provider);
  if (!ready.ok) {
    log.error(`Provider '${provider}' is not ready: ${ready.reason}. Set the key in .env.`);
    process.exitCode = 1;
    return;
  }

  const options: BuildOptions = {
    task,
    appDir,
    slug,
    provider,
    resume: raw.resume,
    maxCostUsd,
    planOnly: raw.planOnly,
  };

  log.banner("TURNKEY MOBILE AGENT");
  console.log("  Task:     " + task.replace(/\s+/g, " ").slice(0, 200));
  console.log("  Slug:     " + slug);
  console.log("  App dir:  " + appDir);
  console.log("  Max cost: $" + maxCostUsd);
  console.log("  Provider: " + (PROVIDERS[provider]?.label ?? provider) + "  (" + ready.reason + ")");

  try {
    await build(options);
  } catch (err) {
    log.error("Build failed: " + (err instanceof Error ? err.message : String(err)));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exitCode = 1;
  }
}

void main();
