/**
 * Tunable configuration: per-phase model selection, turn ceilings, and tool
 * scoping. Phase->model mapping is the core of the token-economy strategy:
 * heavy reasoning runs on Opus, the bulk of coding runs on Sonnet (best
 * coding model, cheaper), and the trivial wrap-up runs on Haiku.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { PhaseId } from "./types.ts";

/** Model aliases resolve to the latest model in each tier. */
export type ModelAlias = "opus" | "sonnet" | "haiku";

function envModel(key: string, fallback: ModelAlias): string {
  const v = process.env[key]?.trim();
  return v && v.length > 0 ? v : fallback;
}

/**
 * Phase -> model. Env overrides:
 *   TURNKEY_MODEL_PLAN, TURNKEY_MODEL_BUILD, TURNKEY_MODEL_VERIFY
 * TURNKEY_MODEL_BUILD covers the scaffold/implement/deploy coding phases.
 */
export function modelForPhase(phase: PhaseId): string {
  const planModel = envModel("TURNKEY_MODEL_PLAN", "opus");
  const buildModel = envModel("TURNKEY_MODEL_BUILD", "sonnet");
  const verifyModel = envModel("TURNKEY_MODEL_VERIFY", "sonnet");
  switch (phase) {
    case "plan":
      return planModel;
    case "scaffold":
    case "implement":
    case "deploy":
      return buildModel;
    case "verify":
      return verifyModel;
    case "finalize":
      return envModel("TURNKEY_MODEL_FINALIZE", "haiku");
    default:
      return buildModel;
  }
}

/** Upper bound on agentic turns per phase (a single phase invocation). */
export const MAX_TURNS: Record<PhaseId, number> = {
  plan: 24,
  scaffold: 50,
  implement: 140,
  verify: 70,
  deploy: 50,
  finalize: 14,
};

/**
 * Tools surfaced per phase. permissionMode is 'bypassPermissions' so these are
 * auto-approved; scoping them per phase keeps each phase focused.
 */
export const TOOLS_FOR_PHASE: Record<PhaseId, string[]> = {
  plan: ["Read", "Write", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"],
  scaffold: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "TodoWrite"],
  implement: [
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "Agent",
    "TodoWrite",
  ],
  verify: ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "TodoWrite"],
  deploy: [
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    "WebSearch",
    "WebFetch",
    "TodoWrite",
  ],
  finalize: ["Read", "Write", "Glob", "Grep"],
};

/**
 * How many times the orchestrator may re-enter a continuable phase before
 * giving up (implement loops until all tasks are done; verify until checks
 * pass). Bounds total work so a run always terminates.
 */
export const MAX_PHASE_ROUNDS: Partial<Record<PhaseId, number>> = {
  implement: 5,
  verify: 4,
};

/** Default hard cost ceiling (USD) for an entire build. */
export const DEFAULT_MAX_COST_USD = 8;

/** Human-readable target stack, injected into prompts. */
export const TARGET_STACK = [
  "Native Android — Kotlin + Jetpack Compose (Material 3)",
  "Gradle (Kotlin DSL) with a version catalog (gradle/libs.versions.toml) and the Gradle wrapper",
  "Single-Activity + Navigation Compose; MVVM (ViewModel + StateFlow); Room for persistence",
  "Signed AAB via Gradle for Google Play deployment",
].join("; ");

/** The durable state file name, kept in the generated app's root. */
export const STATE_FILENAME = "BUILD_STATE.json";
export const PLAN_FILENAME = "PLAN.md";

/** First existing path among candidates, or "". */
function firstExisting(paths: string[]): string {
  for (const p of paths) if (p && existsSync(p)) return p;
  return "";
}

/**
 * Best-effort path to the local Android SDK so the agent can write
 * local.properties and run ./gradlew. Honors ANDROID_HOME / ANDROID_SDK_ROOT,
 * then platform defaults.
 */
export function resolveAndroidSdk(): string {
  const env = (process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "").trim();
  if (env && existsSync(env)) return env;
  const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return firstExisting([
    join(local, "Android", "Sdk"),
    join(homedir(), "Library", "Android", "sdk"),
    join(homedir(), "Android", "Sdk"),
  ]);
}

/**
 * A JDK compatible with the Android Gradle Plugin. The system JDK may be too
 * new (e.g. JDK 25), so prefer Android Studio's bundled JBR when present.
 */
export function resolveGradleJdk(): string {
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/Android Studio.app/Contents/jbr/Contents/Home"]
      : process.platform === "win32"
        ? [
            join(process.env.ProgramFiles || "C:\\Program Files", "Android", "Android Studio", "jbr"),
            join(process.env.LOCALAPPDATA || "", "Programs", "Android Studio", "jbr"),
          ]
        : [join(homedir(), "android-studio", "jbr")];
  return firstExisting(candidates);
}
