#!/usr/bin/env -S npx tsx
/**
 * Main console menu — the home screen of the agent. From here you start a new
 * build (with a live % progress bar), check status, resume, or "I forgot where
 * my app is" → build the APK and push it to a connected phone.
 *
 * `npm start` opens this. Prompts are in Russian to match the primary user.
 */
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Prompter } from "./prompt.ts";
import { loadEnv } from "./env.ts";
import { build } from "./orchestrator.ts";
import { ProgressReporter } from "./progress.ts";
import { collectBuildOptions } from "./interactive.ts";
import { printStatus } from "./status.ts";
import { runDoctor } from "./doctor.ts";
import { loadState } from "./state.ts";
import { resolveAndroidSdk, DEFAULT_MAX_COST_USD } from "./config.ts";
import { log, c } from "./logger.ts";
import { PHASE_ORDER, type BuildOptions, type BuildState } from "./types.ts";

const isWin = process.platform === "win32";
const p = new Prompter();

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

async function pickBuild(builds: BuildEntry[], prompt: string): Promise<BuildEntry | null> {
  builds.forEach((b, i) => {
    const tag = isComplete(b.state) ? c.green("готово") : c.yellow("не завершено");
    console.log(`   ${i + 1}. ${b.name.padEnd(22)} ${c.dim("(" + tag + ")")}`);
  });
  const idx = Number(await p.ask(prompt, "1")) - 1;
  return builds[idx] ?? null;
}

// --- actions ---------------------------------------------------------------

async function newApp(): Promise<void> {
  const opts = await collectBuildOptions(p);
  if (!opts) return;
  await build(opts, new ProgressReporter());
}

async function resumeBuild(): Promise<void> {
  const unfinished = (await listBuilds()).filter((b) => !isComplete(b.state));
  if (!unfinished.length) {
    log.info("Незавершённых сборок нет — всё готово.");
    return;
  }
  console.log("\n  " + c.bold("Какую сборку продолжить?"));
  const b = await pickBuild(unfinished, "   Номер →");
  if (!b) {
    log.warn("Нет такого номера.");
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
    log.warn("Телефон не подключён (включи USB-debugging и разреши отладку). APK готов по пути выше.");
    return;
  }
  log.step(`Ставлю на телефон (${devices.length} устройство)…`);
  try {
    execFileSync(adb, ["install", "-r", apkPath], { stdio: "inherit" });
  } catch {
    log.error("adb install не удался. Попробуй сначала удалить старую версию приложения с телефона.");
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

async function installFlow(): Promise<void> {
  const builds = await listBuilds();
  if (!builds.length) {
    log.info("Сборок ещё нет. Сначала создай приложение (пункт 1).");
    return;
  }
  console.log("\n  " + c.bold("Какое приложение собрать и поставить на телефон?"));
  const b = await pickBuild(builds, "   Номер →");
  if (!b) {
    log.warn("Нет такого номера.");
    return;
  }
  console.log(c.dim(`   Папка: workspace/${b.name}`));
  await installToPhone(b);
}

// --- menu loop -------------------------------------------------------------

async function main(): Promise<void> {
  await loadEnv();
  let running = true;
  while (running) {
    log.banner("TURNKEY MOBILE");
    console.log(`  ${c.bold("1")})  🆕  Создать новое приложение`);
    console.log(`  ${c.bold("2")})  📊  Статус сборок`);
    console.log(`  ${c.bold("3")})  ▶   Продолжить незавершённую сборку`);
    console.log(`  ${c.bold("4")})  📲  Собрать APK и поставить на телефон`);
    console.log(`  ${c.bold("5")})  🩺  Проверка готовности (doctor)`);
    console.log(`  ${c.bold("6")})  🚪  Выход`);
    const choice = (await p.ask("\n  Выбор →", "1")).trim().toLowerCase();
    if (p.ended) break; // stdin closed (e.g. piped input exhausted) — exit cleanly
    const pause = async () => {
      await p.ask("\n  " + c.dim("Enter — вернуться в меню…"));
    };
    try {
      switch (choice) {
        case "1": await newApp(); break;
        case "2": await printStatus(); await pause(); break;
        case "3": await resumeBuild(); break;
        case "4": await installFlow(); await pause(); break;
        case "5": await runDoctor(); await pause(); break;
        case "6":
        case "q":
        case "exit": running = false; break;
        default: log.warn("Не понял выбор — введи число 1–6.");
      }
    } catch (e) {
      log.error(e instanceof Error ? e.message : String(e));
      await pause();
    }
  }
  p.close();
  log.info("Готово. До встречи!");
}

void main().catch((e) => {
  log.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
