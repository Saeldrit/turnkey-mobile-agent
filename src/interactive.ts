/**
 * Interactive collection of build options (the "new app" questions), shared by
 * the menu and the wizard. Returns null if the user cancels. Does NOT close the
 * prompter — the caller owns it.
 */
import { readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { Prompter, yes } from "./prompt.ts";
import { slugify } from "./slug.ts";
import { loadState } from "./state.ts";
import { DEFAULT_MAX_COST_USD } from "./config.ts";
import { knownProviders, providerReady, PROVIDERS } from "./providers.ts";
import { log, c } from "./logger.ts";
import type { BuildOptions } from "./types.ts";

export async function collectBuildOptions(p: Prompter): Promise<BuildOptions | null> {
  // 1) What to build
  console.log("\n" + c.bold("1) Что за приложение делаем?"));
  console.log(c.dim("   Опиши одной-двумя фразами — или укажи путь к .md со спецификацией."));
  let task = await p.ask("   →");
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

  // 2) Provider
  console.log("\n" + c.bold("2) На какой модели строить?"));
  const ids = knownProviders();
  ids.forEach((id, i) => {
    const r = providerReady(id);
    const status = r.ok ? c.green("готов") : c.yellow(r.reason);
    console.log(`   ${i + 1}. ${(PROVIDERS[id]?.label ?? id).padEnd(26)} ${c.dim("(" + status + ")")}`);
  });
  let provider = ids[Number(await p.ask("   Номер →", "1")) - 1] ?? "anthropic";

  let ready = providerReady(provider);
  if (!ready.ok && provider !== "anthropic" && provider !== "custom") {
    const keyEnv = PROVIDERS[provider]?.keyEnv;
    if (keyEnv) {
      const key = await p.ask(`   Введите ${keyEnv} (Enter — пропустить):`);
      if (key) {
        process.env[keyEnv] = key;
        if (yes(await p.ask("   Сохранить ключ в .env? (Y/n)", "Y"))) {
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
  console.log("\n" + c.bold("3) Имя проекта") + c.dim("  (папка внутри workspace/)"));
  const slug = slugify(await p.ask("   →", slugHint ? slugify(slugHint) : slugify(task)));
  const appDir = join(resolve(process.cwd(), "workspace"), slug);

  // Resume?
  let resume = false;
  const existing = await loadState(appDir);
  if (existing && existing.phasesCompleted.length > 0) {
    resume = yes(
      await p.ask(
        `   Найдена незавершённая сборка [${existing.phasesCompleted.join(", ")}]. Продолжить? (Y/n)`,
        "Y",
      ),
    );
  }

  // 4) Cost ceiling
  console.log("\n" + c.bold("4) Лимит стоимости, $") + c.dim("  (страховка от перерасхода)"));
  const maxCostUsd = Number(await p.ask("   →", String(DEFAULT_MAX_COST_USD))) || DEFAULT_MAX_COST_USD;

  // Confirm
  console.log("\n" + c.cyan(c.bold("Готово к запуску:")));
  console.log(`   Приложение: ${task.replace(/\s+/g, " ").slice(0, 80)}${task.length > 80 ? "…" : ""}`);
  console.log(`   Модель:     ${PROVIDERS[provider]?.label ?? provider}`);
  console.log(`   Папка:      workspace/${slug}${resume ? c.yellow("  (продолжение)") : ""}`);
  console.log(`   Лимит:      $${maxCostUsd}`);
  if (/^q/i.test(await p.ask("\n   Enter — запустить, q — отмена:"))) {
    log.info("Отменено.");
    return null;
  }

  return { task, appDir, slug, provider, resume, maxCostUsd, planOnly: false };
}
