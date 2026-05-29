#!/usr/bin/env -S npx tsx
/**
 * Main console menu — the home screen. Arrow-key navigation (↑/↓ + Enter) in a
 * real terminal, numbered fallback when piped. Start a new build (live % bar),
 * check status, resume, or "I forgot where my app is" → build the APK and push
 * it to a connected phone over USB.
 *
 * `npm start` opens this. Prompts are in Russian to match the primary user.
 */
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Tui, type Choice } from "./tui.ts";
import { loadEnv } from "./env.ts";
import { build, fixBuild } from "./orchestrator.ts";
import { ProgressReporter } from "./progress.ts";
import { collectBuildOptions } from "./interactive.ts";
import { printStatus } from "./status.ts";
import { runDoctor } from "./doctor.ts";
import { loadState } from "./state.ts";
import { resolveAndroidSdk, DEFAULT_MAX_COST_USD } from "./config.ts";
import { log, c } from "./logger.ts";
import { PHASE_ORDER, type BuildOptions, type BuildState } from "./types.ts";

const isWin = process.platform === "win32";
const tui = new Tui();
const pause = () => tui.input("\n  " + c.dim("Enter — вернуться в меню…"));

interface BuildEntry {
  readonly name: string;
  readonly dir: string;
  readonly state: BuildState;
}

async function listBuilds(): Promise<BuildEntry[]> {
  const ws = resolve(process.cwd(), "workspace");
  if (!existsSync(ws)) return [];
  const dirs = (await readdir(ws, { withFileTypes: true })).filter((d) => d.isDirectory());
  const out: BuildEntry[] = [];
  for (const d of dirs) {
    const dir = join(ws, d.name);
    const state = await loadState(dir);
    if (state) out.push({ name: d.name, dir, state });
  }
  return out;
}

function isComplete(s: BuildState): boolean {
  return (
    PHASE_ORDER.every((ph) => s.phasesCompleted.includes(ph)) ||
    (s.verification?.compile === "pass" && s.verification?.assemble === "pass")
  );
}

async function pickBuild(builds: BuildEntry[], title: string): Promise<BuildEntry | null> {
  const choices: Choice[] = builds.map((b) => ({
    label: b.name,
    value: b.name,
    hint: isComplete(b.state) ? "готово" : "не завершено",
  }));
  const v = await tui.select(title, choices, 0);
  return v === null ? null : (builds.find((b) => b.name === v) ?? null);
}

// --- actions ---------------------------------------------------------------

async function newApp(): Promise<void> {
  const opts = await collectBuildOptions(tui);
  if (!opts) return;
  await build(opts, new ProgressReporter());
}

async function resumeBuild(): Promise<void> {
  const unfinished = (await listBuilds()).filter((b) => !isComplete(b.state));
  if (!unfinished.length) {
    log.info("Незавершённых сборок нет — всё готово.");
    await pause();
    return;
  }
  const b = await pickBuild(unfinished, "Какую сборку продолжить?");
  if (!b) return;
  const opts: BuildOptions = {
    task: b.state.app.description || b.name,
    appDir: b.dir,
    slug: b.name,
    provider: "anthropic",
    resume: true,
    maxCostUsd: DEFAULT_MAX_COST_USD,
    planOnly: false,
  };
  await build(opts, new ProgressReporter());
}

function buildApk(appDir: string): boolean {
  const gradlew = join(appDir, isWin ? "gradlew.bat" : "gradlew");
  if (!existsSync(gradlew)) {
    log.error("В проекте нет gradlew — сначала доведи сборку (меню → Продолжить).");
    return false;
  }
  log.step("Собираю debug APK (gradlew :app:assembleDebug)…");
  try {
    if (isWin) execFileSync("cmd.exe", ["/c", "gradlew.bat", ":app:assembleDebug"], { cwd: appDir, stdio: "inherit" });
    else execFileSync("./gradlew", [":app:assembleDebug"], { cwd: appDir, stdio: "inherit" });
    return true;
  } catch {
    log.error("Сборка APK не удалась.");
    return false;
  }
}

async function installToPhone(b: BuildEntry): Promise<void> {
  if (!buildApk(b.dir)) return;
  const apkDir = join(b.dir, "app", "build", "outputs", "apk", "debug");
  const apk = existsSync(apkDir) ? (await readdir(apkDir)).find((f) => f.endsWith(".apk")) : undefined;
  if (!apk) {
    log.error("APK не найден после сборки.");
    return;
  }
  const apkPath = join(apkDir, apk);
  log.success(`APK готов: ${apkPath}`);

  const sdk = resolveAndroidSdk();
  const adb = sdk ? join(sdk, "platform-tools", isWin ? "adb.exe" : "adb") : "";
  if (!adb || !existsSync(adb)) {
    log.warn("adb (Android SDK) не найден — установи APK вручную с пути выше.");
    return;
  }
  let devices: string[] = [];
  try {
    devices = execFileSync(adb, ["devices"], { encoding: "utf8" })
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .filter((l) => /\sdevice$/.test(l));
  } catch {
    /* ignore */
  }
  if (!devices.length) {
    log.warn("Телефон не подключён (включи USB-debugging). APK готов по пути выше.");
    return;
  }
  log.step(`Ставлю на телефон (${devices.length} устройство)…`);
  try {
    execFileSync(adb, ["install", "-r", apkPath], { stdio: "inherit" });
  } catch {
    log.error("adb install не удался. Попробуй удалить старую версию приложения с телефона.");
    return;
  }
  const appId = b.state.deploy?.applicationId;
  if (appId) {
    try {
      execFileSync(adb, ["shell", "am", "start", "-n", `${appId}/.MainActivity`], { stdio: "ignore" });
    } catch {
      /* launch is best-effort */
    }
  }
  log.success(`Установлено${appId ? " и запущено: " + appId : ""} ✓`);
}

async function fixFlow(): Promise<void> {
  const builds = await listBuilds();
  if (!builds.length) {
    log.info("Сборок ещё нет. Сначала создай приложение.");
    await pause();
    return;
  }
  const b = await pickBuild(builds, "Какое приложение чинить / дорабатывать?");
  if (!b) return;
  console.log("\n" + c.bold("Опиши проблему или что улучшить:"));
  console.log(c.dim("Напр.: «при сохранении — 400 ошибка», «список не обновляется», «UI стрёмный, переделай»"));
  const problem = await tui.input("→");
  if (!problem) {
    log.info("Пусто — отмена.");
    return;
  }
  const opts: BuildOptions = {
    task: b.state.app.description || b.name,
    appDir: b.dir,
    slug: b.name,
    provider: "anthropic",
    resume: true,
    maxCostUsd: DEFAULT_MAX_COST_USD,
    planOnly: false,
  };
  await fixBuild(opts, problem, new ProgressReporter());
}

async function installFlow(): Promise<void> {
  const builds = await listBuilds();
  if (!builds.length) {
    log.info("Сборок ещё нет. Сначала создай приложение.");
    await pause();
    return;
  }
  const b = await pickBuild(builds, "Какое приложение собрать и поставить на телефон?");
  if (!b) return;
  console.log(c.dim(`  Папка: workspace/${b.name}`));
  await installToPhone(b);
}

// --- menu loop -------------------------------------------------------------

async function main(): Promise<void> {
  await loadEnv();
  const actions: Choice[] = [
    { label: "🆕  Создать новое приложение", value: "new" },
    { label: "📊  Статус сборок", value: "status" },
    { label: "▶   Продолжить незавершённую сборку", value: "resume" },
    { label: "🛠   Исправить / доработать приложение", value: "fix" },
    { label: "📲  Собрать APK и поставить на телефон", value: "install" },
    { label: "🩺  Проверка готовности (doctor)", value: "doctor" },
    { label: "🚪  Выход", value: "exit" },
  ];

  for (;;) {
    log.banner("TURNKEY MOBILE");
    const action = await tui.select("Выбери действие", actions, 0);
    if (action === null || action === "exit") break;
    try {
      switch (action) {
        case "new": await newApp(); break;
        case "status": await printStatus(); await pause(); break;
        case "resume": await resumeBuild(); break;
        case "fix": await fixFlow(); break;
        case "install": await installFlow(); break;
        case "doctor": await runDoctor(); await pause(); break;
      }
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e));
      await pause();
    }
  }
  tui.close();
  log.info("Готово. До встречи!");
}

void main().catch((e) => {
  log.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
