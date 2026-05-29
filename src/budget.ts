/**
 * Token / cost accounting across phases, with a hard ceiling. Immutable
 * accumulator: each addition returns a new totals object.
 */
import type { PhaseResult } from "./types.ts";

export interface BuildTotals {
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly turns: number;
  readonly phases: number;
}

export function emptyTotals(): BuildTotals {
  return {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    turns: 0,
    phases: 0,
  };
}

export function addUsage(t: BuildTotals, r: PhaseResult): BuildTotals {
  return {
    costUsd: t.costUsd + r.usage.costUsd,
    inputTokens: t.inputTokens + r.usage.inputTokens,
    outputTokens: t.outputTokens + r.usage.outputTokens,
    cacheReadTokens: t.cacheReadTokens + r.usage.cacheReadTokens,
    cacheCreationTokens: t.cacheCreationTokens + r.usage.cacheCreationTokens,
    turns: t.turns + r.numTurns,
    phases: t.phases + 1,
  };
}

export function overBudget(t: BuildTotals, capUsd: number): boolean {
  return capUsd > 0 && t.costUsd >= capUsd;
}
