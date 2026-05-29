/**
 * Deterministic phase driver. Runs PLAN → SCAFFOLD → IMPLEMENT* → VERIFY* →
 * DEPLOY → FINALIZE, where IMPLEMENT and VERIFY loop until their done-condition
 * holds (or a bounded number of rounds elapses). Enforces a cost ceiling and
 * supports --resume by skipping phases already recorded in BUILD_STATE.json.
 *
 * With a ProgressReporter (interactive menu/wizard) it shows a compact "[NN%]"
 * progress UI; without one (flag CLI / CI) it logs the verbose stream.
 */
import { mkdir } from "node:fs/promises";
import {
  loadState,
  saveState,
  defaultState,
  markPhaseComplete,
  tasksRemainInPhase,
  verificationPassed,
  summarizeState,
} from "./state.ts";
import { runPhase } from "./runPhase.ts";
import { phaseById, FIX_PHASE } from "./phases.ts";
import { MAX_PHASE_ROUNDS, PLAN_FILENAME } from "./config.ts";
import { emptyTotals, addUsage, overBudget, type BuildTotals } from "./budget.ts";
import { log } from "./logger.ts";
import type { ProgressReporter } from "./progress.ts";
import { PHASE_ORDER, type BuildOptions, type BuildState, type PhaseId } from "./types.ts";

function nextOf(id: PhaseId): PhaseId {
  const i = PHASE_ORDER.indexOf(id);
  return PHASE_ORDER[Math.min(i + 1, PHASE_ORDER.length - 1)] ?? id;
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

export async function build(opts: BuildOptions, reporter?: ProgressReporter): Promise<void> {
  const { appDir, slug, task } = opts;
  await mkdir(appDir, { recursive: true });

  // Initialize or recover durable state.
  let state =
    (await loadState(appDir)) ??
    defaultState(humanizeSlug(slug), slug, task.split("\n")[0]?.trim() ?? "");
  await saveState(appDir, state);

  if (opts.resume && state.phasesCompleted.length > 0 && !reporter) {
    log.info(`Resuming — completed: [${state.phasesCompleted.join(", ")}] (${summarizeState(state)})`);
  }

  let totals = emptyTotals();
  const totalPhases = PHASE_ORDER.length;
  let phaseNo = 0;
  const isSkipped = (id: PhaseId) => opts.resume && state.phasesCompleted.includes(id);

  // --- single-shot phase ---------------------------------------------------
  async function once(id: PhaseId): Promise<void> {
    phaseNo++;
    if (isSkipped(id)) {
      if (reporter) reporter.finishPhase(id);
      else log.success(`Phase ${phaseNo}/${totalPhases} ${id}: already complete — skipped`);
      return;
    }
    if (reporter) reporter.startPhase(id);
    else log.phase(phaseNo, totalPhases, phaseById(id).title);

    const res = await runPhase(
      phaseById(id),
      { task, slug, appDir, provider: opts.provider, round: 1 },
      reporter,
    );
    totals = addUsage(totals, res);
    state = (await loadState(appDir)) ?? state;
    state = markPhaseComplete(state, id, nextOf(id));
    await saveState(appDir, state);

    if (reporter) reporter.finishPhase(id);
    else {
      log.usage(`phase ${id}`, res.usage.costUsd, res.usage.inputTokens, res.usage.outputTokens);
      log.info(summarizeState(state));
    }
    if (!res.ok) log.warn(`phase ${id} ended with: ${res.subtype}`);
  }

  // --- looping phase (implement / verify) ----------------------------------
  async function loop(id: PhaseId, done: (s: BuildState) => boolean): Promise<void> {
    phaseNo++;
    if (isSkipped(id)) {
      if (reporter) reporter.finishPhase(id);
      else log.success(`Phase ${phaseNo}/${totalPhases} ${id}: already complete — skipped`);
      return;
    }
    if (reporter) reporter.startPhase(id);
    const maxRounds = MAX_PHASE_ROUNDS[id] ?? 1;
    for (let round = 1; round <= maxRounds; round++) {
      if (overBudget(totals, opts.maxCostUsd)) {
        if (reporter) reporter.done();
        return;
      }
      if (!reporter) log.phase(phaseNo, totalPhases, `${phaseById(id).title} (round ${round}/${maxRounds})`);
      const res = await runPhase(
        phaseById(id),
        { task, slug, appDir, provider: opts.provider, round },
        reporter,
      );
      totals = addUsage(totals, res);
      state = (await loadState(appDir)) ?? state;
      await saveState(appDir, state);
      if (!reporter) {
        log.usage(`phase ${id} r${round}`, res.usage.costUsd, res.usage.inputTokens, res.usage.outputTokens);
        log.info(summarizeState(state));
      }
      if (done(state)) {
        state = markPhaseComplete(state, id, nextOf(id));
        await saveState(appDir, state);
        if (reporter) reporter.finishPhase(id);
        else log.success(`phase ${id} satisfied after ${round} round(s)`);
        return;
      }
      if (!reporter) log.warn(`phase ${id}: not done after round ${round}`);
    }
    if (reporter) reporter.finishPhase(id);
    else log.warn(`phase ${id}: bounded rounds exhausted; proceeding (will retry on --resume)`);
  }

  // --- drive the pipeline ---------------------------------------------------
  const stopIfBroke = (): boolean => {
    if (overBudget(totals, opts.maxCostUsd)) {
      if (reporter) reporter.done();
      log.warn(
        `Cost ceiling $${opts.maxCostUsd} reached ($${totals.costUsd.toFixed(2)}). Stopping. Re-run / resume to continue.`,
      );
      return true;
    }
    return false;
  };

  await once("plan");
  if (opts.planOnly) {
    if (reporter) reporter.done();
    log.success(`Plan-only run complete. See ${PLAN_FILENAME} and BUILD_STATE.json.`);
    return report(totals, state, opts, reporter);
  }
  if (stopIfBroke()) return report(totals, state, opts, reporter);

  await once("scaffold");
  if (stopIfBroke()) return report(totals, state, opts, reporter);

  await loop("implement", (s) => !tasksRemainInPhase(s, "implement"));
  if (stopIfBroke()) return report(totals, state, opts, reporter);

  await loop("verify", (s) => verificationPassed(s));
  if (stopIfBroke()) return report(totals, state, opts, reporter);

  await once("deploy");
  if (stopIfBroke()) return report(totals, state, opts, reporter);

  await once("finalize");
  report(totals, state, opts, reporter);
}

function report(
  totals: BuildTotals,
  state: BuildState,
  opts: BuildOptions,
  reporter?: ProgressReporter,
): void {
  reporter?.done();
  log.banner("BUILD SUMMARY");
  const v = state.verification;
  const tasksDone = state.tasks.filter((t) => t.status === "done").length;
  const lines = [
    `App:          ${state.app.name} (${state.app.slug}) — ${state.app.stack}`,
    `Directory:    ${opts.appDir}`,
    `Phases done:  [${state.phasesCompleted.join(", ") || "none"}]`,
    `Tasks:        ${tasksDone}/${state.tasks.length} done`,
    `Compile:      ${v.compile}`,
    `assembleDebug:${v.assemble}`,
    `Runtime:      ${v.runtime}`,
    `Lint:         ${v.lint}`,
    `Signing:      ${state.deploy.signingConfigured ? "configured" : "no"}`,
    `App id:       ${state.deploy.applicationId || "?"} v${state.deploy.versionName} (${state.deploy.versionCode})`,
    ``,
    `Cost:         $${totals.costUsd.toFixed(4)} over ${totals.phases} phase-runs / ${totals.turns} turns`,
    `Tokens:       in ${totals.inputTokens.toLocaleString()} · out ${totals.outputTokens.toLocaleString()} · cacheRead ${totals.cacheReadTokens.toLocaleString()}`,
  ];
  for (const l of lines) console.log("  " + l);
  const turnkey =
    v.compile === "pass" &&
    v.assemble === "pass" &&
    v.runtime !== "fail" &&
    state.deploy.signingConfigured;
  if (turnkey) log.success("Result: TURNKEY — app builds, runs, and is deployment-ready.");
  else log.warn("Result: incomplete — see verification above; re-run / resume to continue.");
}

/**
 * Fix / improve an already-built app from a user-reported problem: one FIX pass
 * (reproduce + fix root cause, offline-first) followed by a VERIFY loop
 * (build + runtime). Used by the menu's "Исправить / доработать" option.
 */
export async function fixBuild(
  opts: BuildOptions,
  problem: string,
  reporter?: ProgressReporter,
): Promise<void> {
  const { appDir, slug, task } = opts;
  let state = await loadState(appDir);
  if (!state) {
    log.error(`Нет ${appDir}/BUILD_STATE.json — это не приложение, собранное агентом.`);
    return;
  }
  let totals = emptyTotals();

  // FIX pass (reuses the implement id for model/tools/turns/progress).
  if (reporter) reporter.startPhase("implement");
  else log.phase(1, 2, FIX_PHASE.title);
  const fix = await runPhase(
    FIX_PHASE,
    { task, slug, appDir, provider: opts.provider, round: 1, problem },
    reporter,
  );
  totals = addUsage(totals, fix);
  state = (await loadState(appDir)) ?? state;
  await saveState(appDir, state);
  if (reporter) reporter.finishPhase("implement");
  else {
    log.usage("fix", fix.usage.costUsd, fix.usage.inputTokens, fix.usage.outputTokens);
    log.info(summarizeState(state));
  }

  // VERIFY loop (build + runtime) until it passes or rounds run out.
  const maxRounds = MAX_PHASE_ROUNDS["verify"] ?? 1;
  if (reporter) reporter.startPhase("verify");
  for (let round = 1; round <= maxRounds; round++) {
    if (overBudget(totals, opts.maxCostUsd)) break;
    if (!reporter) log.phase(2, 2, `${phaseById("verify").title} (round ${round}/${maxRounds})`);
    const vr = await runPhase(
      phaseById("verify"),
      { task, slug, appDir, provider: opts.provider, round },
      reporter,
    );
    totals = addUsage(totals, vr);
    state = (await loadState(appDir)) ?? state;
    await saveState(appDir, state);
    if (!reporter) log.info(summarizeState(state));
    if (verificationPassed(state)) break;
  }
  if (reporter) reporter.finishPhase("verify");
  report(totals, state, opts, reporter);
}
