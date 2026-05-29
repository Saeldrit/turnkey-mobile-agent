/**
 * `npm run status` — show every build in workspace/ and how far it got, read
 * straight from the durable BUILD_STATE.json files. This is how you check on the
 * agent: progress lives on disk, so closing the terminal never loses it — you
 * just look at the state (and `npm start` → same name → resume to continue).
 */
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadState } from "./state.ts";
import { log, c } from "./logger.ts";
import { PHASE_ORDER } from "./types.ts";

async function main(): Promise<void> {
  log.banner("TURNKEY MOBILE — STATUS");
  const ws = resolve(process.cwd(), "workspace");
  if (!existsSync(ws)) {
    log.info("Папки workspace/ ещё нет — сборок не было. Запусти: npm start");
    return;
  }

  const dirs = (await readdir(ws, { withFileTypes: true })).filter((d) => d.isDirectory());
  let found = 0;
  for (const d of dirs) {
    const appDir = join(ws, d.name);
    const s = await loadState(appDir);
    if (!s) continue;
    found++;

    const done = s.tasks.filter((t) => t.status === "done").length;
    const v = s.verification;
    const allPhases = PHASE_ORDER.every((p) => s.phasesCompleted.includes(p));
    const turnkey = v?.compile === "pass" && v?.assemble === "pass" && s.deploy?.signingConfigured;
    const complete = turnkey || allPhases;
    const badge = complete ? c.green("✓ готово") : c.yellow("◌ не завершено");

    console.log(`\n  ${c.bold(d.name)}  ${badge}`);
    console.log(`    стек:    ${s.app?.stack ?? "?"}`);
    console.log(`    фаза:    ${s.phase}    завершены: [${s.phasesCompleted.join(", ") || "—"}]`);
    console.log(`    задачи:  ${done}/${s.tasks.length}`);
    console.log(`    сборка:  compile=${v?.compile ?? "?"}  assemble=${v?.assemble ?? "?"}  lint=${v?.lint ?? "?"}`);
    if (complete) {
      console.log(c.dim(`    → на телефон:  cd workspace/${d.name} ; gradlew installDebug`));
    } else {
      console.log(c.dim(`    → продолжить:  npm start  (имя «${d.name}» → «продолжить»)  или  npx tsx src/cli.ts --slug ${d.name} --resume`));
    }
  }

  if (!found) log.info("Готовых/начатых сборок не найдено. Запусти: npm start");
  console.log("");
}

void main().catch((e) => {
  log.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
