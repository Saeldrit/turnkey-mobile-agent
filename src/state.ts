/**
 * Durable build state (BUILD_STATE.json) — the mechanism that makes the agent
 * resilient to context compaction and resumable after interruption.
 *
 * The orchestrator initializes and reads this file; the agent reads and writes
 * it during phases. All updates in TS are immutable (return a new object).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { STATE_FILENAME } from "./config.ts";
import type { BuildState, PhaseId } from "./types.ts";

export function statePath(appDir: string): string {
  return join(appDir, STATE_FILENAME);
}

export function defaultState(
  name: string,
  slug: string,
  description: string,
): BuildState {
  return {
    app: { name, slug, stack: "android-kotlin-compose", description },
    phase: "plan",
    phasesCompleted: [],
    plan: { screens: [], features: [], dataModel: [] },
    tasks: [],
    deploy: {
      applicationId: "",
      versionName: "1.0.0",
      versionCode: 1,
      signingConfigured: false,
    },
    verification: { compile: "pending", assemble: "pending", lint: "pending", notes: "" },
    notes: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Returns parsed state, or null if the file does not exist / is unreadable. */
export async function loadState(appDir: string): Promise<BuildState | null> {
  try {
    const raw = await readFile(statePath(appDir), "utf8");
    return JSON.parse(raw) as BuildState;
  } catch {
    return null;
  }
}

export async function saveState(
  appDir: string,
  state: BuildState,
): Promise<void> {
  await mkdir(appDir, { recursive: true });
  const next: BuildState = { ...state, updatedAt: new Date().toISOString() };
  await writeFile(statePath(appDir), JSON.stringify(next, null, 2) + "\n", "utf8");
}

/** Immutable: mark a phase complete and set the current phase. */
export function markPhaseComplete(
  state: BuildState,
  completed: PhaseId,
  nextPhase: PhaseId,
): BuildState {
  const phasesCompleted = state.phasesCompleted.includes(completed)
    ? state.phasesCompleted
    : [...state.phasesCompleted, completed];
  return { ...state, phasesCompleted, phase: nextPhase };
}

export function hasUnfinishedTasks(state: BuildState): boolean {
  return state.tasks.some((t) => t.status !== "done");
}

/** Whether any task assigned to a specific phase is still unfinished. */
export function tasksRemainInPhase(state: BuildState, phase: PhaseId): boolean {
  return state.tasks.some((t) => t.phase === phase && t.status !== "done");
}

export function verificationPassed(state: BuildState): boolean {
  return (
    state.verification.compile === "pass" &&
    state.verification.assemble === "pass"
  );
}

/** One-line progress summary for logs. */
export function summarizeState(state: BuildState): string {
  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.status === "done").length;
  const v = state.verification;
  return (
    `phase=${state.phase} tasks=${done}/${total} ` +
    `compile=${v.compile} assemble=${v.assemble} lint=${v.lint}`
  );
}
