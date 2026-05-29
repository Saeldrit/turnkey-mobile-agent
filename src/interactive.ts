/**
 * Interactive collection of build options (the "new app" questions), shared by
 * the menu and the wizard. Arrow-key model picker, text input for the rest.
 * Returns null if the user cancels. Does NOT close the Tui — the caller owns it.
 */
import { readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { Tui, type Choice } from "./tui.ts";
import { slugify } from "./slug.ts";
import { loadState } from "./state.ts";
import { DEFAULT_MAX_COST_USD } from "./config.ts";
import { knownProviders, providerReady, PROVIDERS } from "./providers.ts";
import { log, c } from "./logger.ts";
import type { BuildOptions } from "./types.ts";

export async function collectBuildOptions(tui: Tui): Promise<BuildOptions | null> {
  // 1) What to build
  console.log("\n" + c.bold("Что за приложение делаем?"));
  console.log(c.dim("Опиши одной-двумя фразами — или укажи путь к .md со спецификацией."));
  let task = await tui.input("→");
  if (!task) {
    log.error("Пустое описание — отмена.");
    return null;
  }
  let slugHint = "";
  const maybeFile = resolve(process.cwd(), task);
  if (/\.(md|txt|task)$/i.test(task) && existsSync(maybeFile)) {
    slugHint = basename(task).replace(/\.(md|txt)$/i, "").replace(/\.task$/i, "");
    task = (await readFile(maybeFile, "utf8")).trim();
    log.success(`Прочитал спецификацию из файла «${slugHint}».`);
  }

  // 2) Provider (arrow-key pick)
  const ids = knownProviders();
  const choices: Choice[] = ids.map((id) => {
    const r = providerReady(id);
    return { label: PROVIDERS[id]?.label ?? id, value: id, hint: r.ok ? "готов" : r.reason };
  });
  const chosen = await tui.select("На какой модели строить?", choices, 0);
  if (chosen === null) return null;
  let provider = chosen;

  // Offer to enter a missing key inline.
  let ready = providerReady(provider);
  if (!ready.ok && provider !== "anthropic" && provider !== "custom") {
    const keyEnv = PROVIDERS[provider]?.keyEnv;
    if (keyEnv) {
      const key = await tui.input(`Введите ${keyEnv} (Enter — пропустить):`);
      if (key) {
        process.env[keyEnv] = key;
        if (await tui.confirm("Сохранить ключ в .env, чтобы не вводить снова?", true)) {
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

  // 3) Project name
  console.log("\n" + c.bold("Имя проекта") + c.dim("  (папка внутри workspace/)"));
  const slug = slugify(await tui.input("→", slugHint ? slugify(slugHint) : slugify(task)));
  const appDir = join(resolve(process.cwd(), "workspace"), slug);

  // Resume?
  let resume = false;
  const existing = await loadState(appDir);
  if (existing && existing.phasesCompleted.length > 0) {
    resume = await tui.confirm(
      `Найдена незавершённая сборка [${existing.phasesCompleted.join(", ")}]. Продолжить?`,
      true,
    );
  }

  // 4) Cost ceiling
  console.log("\n" + c.bold("Лимит стоимости, $") + c.dim("  (страховка от перерасхода)"));
  const maxCostUsd = Number(await tui.input("→", String(DEFAULT_MAX_COST_USD))) || DEFAULT_MAX_COST_USD;

  // Confirm
  console.log("\n" + c.cyan(c.bold("Готово к запуску:")));
  console.log(`   Приложение: ${task.replace(/\s+/g, " ").slice(0, 80)}${task.length > 80 ? "…" : ""}`);
  console.log(`   Модель:     ${PROVIDERS[provider]?.label ?? provider}`);
  console.log(`   Папка:      workspace/${slug}${resume ? c.yellow("  (продолжение)") : ""}`);
  console.log(`   Лимит:      $${maxCostUsd}`);
  if (!(await tui.confirm("Запустить сборку сейчас?", true))) {
    log.info("Отменено.");
    return null;
  }

  return { task, appDir, slug, provider, resume, maxCostUsd, planOnly: false };
}
