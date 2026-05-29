/**
 * Compact progress display for interactive runs: instead of streaming every
 * tool call, show a single live "[NN%] Phase · current action" line with a
 * spinner, plus a permanent checkmark line as each phase completes.
 *
 * Used by the menu/wizard. The flag-based CLI keeps the verbose stream.
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

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BAR_WIDTH = 22;

export class ProgressReporter {
  private phase: PhaseId | null = null;
  private action = "";
  private frame = 0;
  private pct = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly tty = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

  startPhase(phase: PhaseId): void {
    this.phase = phase;
    this.pct = PCT[phase].start;
    this.action = PCT[phase].title + "…";
    if (this.tty) {
      this.stopTimer();
      this.timer = setInterval(() => this.spin(), 120);
    } else {
      this.flatLine();
    }
  }

  setAction(text: string): void {
    this.action = text;
    if (this.phase) {
      const { end, start } = PCT[this.phase];
      this.pct = Math.min(end - 1, this.pct + (end - start) * 0.05); // creep toward phase end
    }
    if (!this.tty) this.flatLine();
  }

  finishPhase(phase: PhaseId): void {
    this.stopTimer();
    this.pct = PCT[phase].end;
    this.clear();
    console.log(`  ${c.green("✓")} ${this.bar()}  ${c.bold(PCT[phase].title)}`);
  }

  done(): void {
    this.stopTimer();
    this.clear();
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private bar(): string {
    const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((this.pct / 100) * BAR_WIDTH)));
    return c.cyan("█".repeat(filled) + "░".repeat(BAR_WIDTH - filled)) + ` ${String(Math.round(this.pct)).padStart(3)}%`;
  }

  private spin(): void {
    this.frame = (this.frame + 1) % FRAMES.length;
    const f = FRAMES[this.frame] ?? "⠋";
    const action = this.action.length > 48 ? this.action.slice(0, 47) + "…" : this.action.padEnd(48);
    process.stdout.write(`\r  ${c.cyan(f)} ${this.bar()}  ${c.dim(action)}`);
  }

  private flatLine(): void {
    console.log(`  ${this.bar()}  ${this.action.slice(0, 60)}`);
  }

  private clear(): void {
    if (this.tty) process.stdout.write("\r" + " ".repeat(BAR_WIDTH + 64) + "\r");
  }
}
