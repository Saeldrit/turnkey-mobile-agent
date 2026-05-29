/**
 * Progress display for interactive runs. Prints clean, discrete one-line updates
 * (a bar + %, plus the current action) — NOT an animated \r line, because the
 * carriage-return/cursor approach smears under cmd.exe + tsx (stdout isn't a
 * clean TTY and long lines wrap). Discrete newline-terminated lines render
 * correctly everywhere: cmd, PowerShell, Windows Terminal, and piped output.
 *
 * A line is emitted on phase start, on phase finish, and while a phase runs only
 * when the rounded % advances — so the number of lines stays small and readable.
 */
import { c } from "./logger.ts";
import type { PhaseId } from "./types.ts";

const PCT: Record<PhaseId, { start: number; end: number; title: string }> = {
  plan: { start: 0, end: 8, title: "Планирование" },
  scaffold: { start: 8, end: 22, title: "Каркас проекта" },
  implement: { start: 22, end: 68, title: "Реализация" },
  verify: { start: 68, end: 82, title: "Проверка сборки" },
  deploy: { start: 82, end: 93, title: "Подготовка к деплою" },
  finalize: { start: 93, end: 100, title: "Финализация" },
};

const BAR_WIDTH = 18;

export class ProgressReporter {
  private phase: PhaseId | null = null;
  private pct = 0;
  private lastPrinted = -1;

  startPhase(phase: PhaseId): void {
    this.phase = phase;
    this.pct = PCT[phase].start;
    this.lastPrinted = -1;
    this.print(PCT[phase].title + "…");
  }

  setAction(text: string): void {
    if (this.phase) {
      const { start, end } = PCT[this.phase];
      this.pct = Math.min(end - 1, this.pct + (end - start) * 0.06); // creep toward phase end
    }
    if (Math.round(this.pct) > this.lastPrinted) this.print(text);
  }

  finishPhase(phase: PhaseId): void {
    this.pct = PCT[phase].end;
    this.lastPrinted = Math.round(this.pct);
    console.log(`  ${c.green("✓")} ${this.bar()}  ${c.bold(PCT[phase].title)}`);
  }

  done(): void {
    /* discrete lines need no teardown */
  }

  private print(action: string): void {
    this.lastPrinted = Math.round(this.pct);
    const a = action.length > 42 ? action.slice(0, 41) + "…" : action;
    console.log(`  ${c.cyan("•")} ${this.bar()}  ${c.dim(a)}`);
  }

  private bar(): string {
    const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((this.pct / 100) * BAR_WIDTH)));
    return c.cyan("█".repeat(filled) + "░".repeat(BAR_WIDTH - filled)) + ` ${String(Math.round(this.pct)).padStart(3)}%`;
  }
}
