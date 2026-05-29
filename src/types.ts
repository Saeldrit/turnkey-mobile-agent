/**
 * Shared types for the Turnkey Mobile Agent.
 *
 * The single most important type here is {@link BuildState}: the durable,
 * on-disk source of truth that lets the agent survive context compaction and
 * resume after interruption. It is written as BUILD_STATE.json inside the
 * generated app directory and is read/written by BOTH the deterministic
 * orchestrator (TypeScript) and the autonomous agent (via its file tools).
 */

/** Ordered build phases. The orchestrator drives these deterministically. */
export type PhaseId =
  | "plan"
  | "scaffold"
  | "implement"
  | "verify"
  | "deploy"
  | "finalize";

export const PHASE_ORDER: readonly PhaseId[] = [
  "plan",
  "scaffold",
  "implement",
  "verify",
  "deploy",
  "finalize",
] as const;

/** A single unit of work the agent tracks across phases. */
export interface BuildTask {
  readonly id: string;
  readonly title: string;
  readonly status: "todo" | "doing" | "done";
  readonly phase: PhaseId;
}

export type Verdict = "pass" | "fail" | "pending";

/**
 * Durable build state. Persisted to BUILD_STATE.json. Treated as immutable in
 * orchestrator code: every update returns a new object rather than mutating.
 */
export interface BuildState {
  readonly app: {
    readonly name: string;
    readonly slug: string;
    readonly stack: "android-kotlin-compose";
    readonly description: string;
  };
  /** The most recently entered phase. */
  readonly phase: PhaseId;
  readonly phasesCompleted: readonly PhaseId[];
  readonly plan: {
    readonly screens: readonly string[];
    readonly features: readonly string[];
    readonly dataModel: readonly string[];
  };
  readonly tasks: readonly BuildTask[];
  readonly deploy: {
    readonly applicationId: string;
    readonly versionName: string;
    readonly versionCode: number;
    readonly signingConfigured: boolean;
  };
  readonly verification: {
    /** `./gradlew :app:compileDebugKotlin` */
    readonly compile: Verdict;
    /** `./gradlew :app:assembleDebug` — proof the APK builds. */
    readonly assemble: Verdict;
    /** `./gradlew :app:lintDebug` */
    readonly lint: Verdict;
    readonly notes: string;
  };
  /** Running log of notable decisions; helps recovery after compaction. */
  readonly notes: readonly string[];
  readonly updatedAt: string;
}

/** Token + cost usage captured from one phase's result message. */
export interface PhaseUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly costUsd: number;
}

/** Outcome of running a single phase (one SDK query). */
export interface PhaseResult {
  readonly phase: PhaseId;
  readonly ok: boolean;
  readonly subtype: string;
  readonly numTurns: number;
  readonly sessionId: string | undefined;
  readonly usage: PhaseUsage;
  readonly durationMs: number;
}

/** Fully-resolved options for a single build run. */
export interface BuildOptions {
  /** Natural-language description of the app to build. */
  readonly task: string;
  /** Absolute path to the directory the app will be generated in. */
  readonly appDir: string;
  /** Short kebab-case identifier for the app. */
  readonly slug: string;
  /** LLM provider id (see providers.ts): anthropic | qwen | deepseek | ... */
  readonly provider: string;
  /** Skip phases already marked complete in BUILD_STATE.json. */
  readonly resume: boolean;
  /** Hard ceiling on total cost (USD) across the whole build. */
  readonly maxCostUsd: number;
  /** Stop after the PLAN phase (dry-run planning only). */
  readonly planOnly: boolean;
}
