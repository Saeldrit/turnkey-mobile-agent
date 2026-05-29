#!/usr/bin/env -S npx tsx
/**
 * Interactive console wizard — the simple, no-flags way to drive the agent.
 * Run `npm start` (or double-click start.bat / run ./start.sh) and answer a few
 * questions. Power users can still use `npx tsx src/cli.ts` with flags.
 *
 * Prompts are in Russian to match the primary user; everything else is English.
 */
import { createInterface } from "node:readline";
import { readFile, appendFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { build } from "./orchestrator.ts";
import { loadEnv } from "./env.ts";
import { slugify } from "./slug.ts";
import { loadState } from "./state.ts";
import { DEFAULT_MAX_COST_USD } from "./config.ts";
import { knownProviders, providerReady, PROVIDERS } from "./providers.ts";
import { log, c } from "./logger.ts";
import type { BuildOptions } from "./types.ts";

/**
 * Buffered line prompter. Unlike readline/promises' question(), it queues lines
 * as they arrive, so it works with both an interactive TTY and piped stdin
 * (where all lines arrive at once) without losing any.
 */
class Prompter {
  private queue: string[] = [];
  private pending: ((line: string) => void) | null = null;
  private closed = false;
  private readonly rl = createInterface({ input: process.stdin });

  constructor() {
    this.rl.on("line", (line) => {
      if (this.pending) {
        const resolve = this.pending;
        this.pending = null;
        resolve(line);
      } else {
        this.queue.push(line);
      }
    });
    this.rl.on("close", () => {
      this.closed = true;
      if (this.pending) {
        const resolve = this.pending;
        this.pending = null;
        resolve("");
      }
    });
  }

  async ask(prompt: string, def = ""): Promise<string> {
    process.stdout.write(`${prompt}${def ? c.dim(` [${def}]`) : ""} `);
    const line = await this.next();
    return line.trim() || def;
  }

  private next(): Promise<string> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.closed) return Promise.resolve("");
    return new Promise((res) => {
      this.pending = res;
    });
  }

  close(): void {
    this.rl.close();
  }
}

const p = new Prompter();
const ask = (q: string, def = "") => p.ask(q, def);
const yes = (s: string) => /^(y|yes|д|да|)$/i.test(s.trim());

async function main(): Promise<void> {
  await loadEnv();
  log.banner("TURNKEY MOBILE — мастер сборки");
  console.log(c.dim("  Нативное Android-приложение (Kotlin + Compose) под ключ. Ctrl+C — выход.\n"));

  // 1) What to build
  console.log(c.bold("1) Что за приложение делаем?"));
  console.log(c.dim("   Опиши одной-двумя фразами — или укажи путь к .md со спецификацией."));
  let task = await ask("   →");
  if (!task) {
    log.error("Пустое описание — выход.");
    p.close();
    return;
  }
  let slugHint = "";
  const maybeFile = resolve(process.cwd(), task);
  if (/\.(md|txt|task)$/i.test(task) && existsSync(maybeFile)) {
    slugHint = basename(task).replace(/\.(md|txt)$/i, "").replace(/\.task$/i, "");
    task = (await readFile(maybeFile, "utf8")).trim();
    log.success(`Прочитал спецификацию из файла «${slugHint}».`);
  }

  // 2) Provider
  console.log("\n" + c.bold("2) На какой модели строить?"));
  const ids = knownProviders();
  ids.forEach((id, i) => {
    const r = providerReady(id);
    const status = r.ok ? c.green("готов") : c.yellow(r.reason);
    console.log(`   ${i + 1}. ${(PROVIDERS[id]?.label ?? id).padEnd(26)} ${c.dim("(" + status + ")")}`);
  });
  const pick = Number(await ask("   Номер →", "1")) - 1;
  let provider = ids[pick] ?? "anthropic";

  // Offer to enter a missing key inline.
  let ready = providerReady(provider);
  if (!ready.ok && provider !== "anthropic" && provider !== "custom") {
    const keyEnv = PROVIDERS[provider]?.keyEnv;
    if (keyEnv) {
      const key = await ask(`   Введите ${keyEnv} (Enter — пропустить):`);
      if (key) {
        process.env[keyEnv] = key;
        if (yes(await ask("   Сохранить ключ в .env, чтобы не вводить снова? (Y/n)", "Y"))) {
          await appendFile(resolve(process.cwd(), ".env"), `\n${keyEnv}=${key}\n`, "utf8");
          log.success(".env обновлён.");
        }
        ready = providerReady(provider);
      }
    }
  }
  if (!ready.ok && provider !== "anthropic" && provider !== "custom") {
    log.warn(`Провайдер «${provider}» не готов (${ready.reason}). Переключаюсь на Claude.`);
    provider = "anthropic";
  }

  // 3) Slug
  console.log("\n" + c.bold("3) Имя проекта") + c.dim("  (папка внутри workspace/)"));
  const slug = slugify(await ask("   →", slugHint ? slugify(slugHint) : slugify(task)));

  // Resume an interrupted build for this slug?
  const appDir = join(resolve(process.cwd(), "workspace"), slug);
  let resume = false;
  const existing = await loadState(appDir);
  if (existing && existing.phasesCompleted.length > 0) {
    resume = yes(
      await ask(
        `   Найдена незавершённая сборка [${existing.phasesCompleted.join(", ")}]. Продолжить? (Y/n)`,
        "Y",
      ),
    );
  }

  // 4) Cost ceiling
  console.log("\n" + c.bold("4) Лимит стоимости, $") + c.dim("  (страховка от перерасхода)"));
  const maxCostUsd = Number(await ask("   →", String(DEFAULT_MAX_COST_USD))) || DEFAULT_MAX_COST_USD;

  // Confirm
  console.log("\n" + c.cyan(c.bold("Готово к запуску:")));
  console.log(`   Приложение: ${task.replace(/\s+/g, " ").slice(0, 80)}${task.length > 80 ? "…" : ""}`);
  console.log(`   Модель:     ${PROVIDERS[provider]?.label ?? provider}`);
  console.log(`   Папка:      workspace/${slug}${resume ? c.yellow("  (продолжение)") : ""}`);
  console.log(`   Лимит:      $${maxCostUsd}`);
  const go = await ask("\n   Enter — запустить, q — отмена:");
  p.close();
  if (/^q/i.test(go)) {
    log.info("Отменено.");
    return;
  }

  const options: BuildOptions = { task, appDir, slug, provider, resume, maxCostUsd, planOnly: false };
  if (process.env.TURNKEY_DRYRUN) {
    const out = JSON.stringify({ task: task.slice(0, 60), slug, provider, resume, maxCostUsd }, null, 2);
    log.info("DRY RUN — resolved options:\n" + out);
    await writeFile(resolve(process.cwd(), "dryrun.json"), out, "utf8");
    return;
  }
  await build(options);
}

void main().catch((e) => {
  log.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
