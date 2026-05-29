/**
 * Tiny console UI: arrow-key list selection (↑/↓ + Enter) in a real terminal,
 * with a graceful numbered fallback when stdin is not a TTY (piped input / CI /
 * tests). Also text input and yes/no. Dependency-free.
 *
 * One Tui owns stdin for the session; selection (raw keypress) and text input
 * (line mode) are used sequentially, each fully setting up and tearing down.
 */
import { createInterface, emitKeypressEvents } from "node:readline";
import { createInterface as createPromptInterface } from "node:readline/promises";
import { c } from "./logger.ts";

export interface Choice {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}

interface Key {
  readonly name?: string;
  readonly ctrl?: boolean;
}

const isTTY = (): boolean => process.stdin.isTTY === true;

export class Tui {
  // Buffered line reader used only in non-TTY mode (piped input / tests).
  private queue: string[] = [];
  private pending: ((line: string) => void) | null = null;
  private closed = false;
  private nonTty: ReturnType<typeof createInterface> | null = null;

  private ensureNonTty(): void {
    if (this.nonTty) return;
    this.nonTty = createInterface({ input: process.stdin });
    this.nonTty.on("line", (line) => {
      if (this.pending) {
        const r = this.pending;
        this.pending = null;
        r(line);
      } else {
        this.queue.push(line);
      }
    });
    this.nonTty.on("close", () => {
      this.closed = true;
      if (this.pending) {
        const r = this.pending;
        this.pending = null;
        r("");
      }
    });
  }

  private nextLine(): Promise<string> {
    this.ensureNonTty();
    const q = this.queue.shift();
    if (q !== undefined) return Promise.resolve(q);
    if (this.closed) return Promise.resolve("");
    return new Promise((res) => {
      this.pending = res;
    });
  }

  /** True once piped stdin has ended (non-TTY) — callers should stop looping. */
  get ended(): boolean {
    return this.closed;
  }

  async input(prompt: string, def = ""): Promise<string> {
    const label = `${prompt}${def ? c.dim(` [${def}]`) : ""} `;
    if (isTTY()) {
      const rl = createPromptInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question(label)).trim();
      rl.close();
      return answer || def;
    }
    process.stdout.write(label);
    return (await this.nextLine()).trim() || def;
  }

  async confirm(prompt: string, defYes = true): Promise<boolean> {
    const v = (await this.input(`${prompt} ${defYes ? "(Y/n)" : "(y/N)"}`)).trim();
    if (!v) return defYes;
    return /^(y|yes|д|да)$/i.test(v);
  }

  /** Returns the chosen value, or null if cancelled (Esc/q) or stdin ended. */
  async select(title: string, choices: Choice[], def = 0): Promise<string | null> {
    if (choices.length === 0) return null;
    if (!isTTY()) return this.selectByNumber(title, choices, def);
    return this.selectByArrows(title, choices, def);
  }

  private async selectByNumber(title: string, choices: Choice[], def: number): Promise<string | null> {
    console.log("  " + c.bold(title));
    choices.forEach((ch, i) => console.log(`   ${i + 1}. ${ch.label}${ch.hint ? c.dim("  " + ch.hint) : ""}`));
    process.stdout.write(`  ${c.dim("Номер →")} `);
    const raw = (await this.nextLine()).trim();
    if (this.closed && !raw) return null;
    const idx = Number(raw) - 1;
    return choices[idx]?.value ?? choices[def]?.value ?? null;
  }

  private selectByArrows(title: string, choices: Choice[], def: number): Promise<string | null> {
    return new Promise((resolve) => {
      let cur = Math.max(0, Math.min(choices.length - 1, def));
      let drawn = false;
      console.log("  " + c.bold(title) + c.dim("   (↑/↓ и Enter, q — отмена)"));

      const render = (): void => {
        if (drawn) process.stdout.write(`\x1b[${choices.length}A`);
        drawn = true;
        for (let i = 0; i < choices.length; i++) {
          const ch = choices[i]!;
          const sel = i === cur;
          process.stdout.write("\x1b[2K"); // clear line
          process.stdout.write(`  ${sel ? c.cyan("❯") : " "} ${sel ? c.cyan(ch.label) : ch.label}${ch.hint ? c.dim("  " + ch.hint) : ""}\n`);
        }
      };

      emitKeypressEvents(process.stdin);
      process.stdin.setRawMode?.(true);
      process.stdin.resume();

      const cleanup = (): void => {
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener("keypress", onKey);
        process.stdin.pause();
      };
      const onKey = (_s: string | undefined, key: Key | undefined): void => {
        if (!key) return;
        if (key.ctrl && key.name === "c") {
          cleanup();
          process.exit(0);
        } else if (key.name === "up" || key.name === "k") {
          cur = (cur - 1 + choices.length) % choices.length;
          render();
        } else if (key.name === "down" || key.name === "j") {
          cur = (cur + 1) % choices.length;
          render();
        } else if (key.name === "return" || key.name === "enter") {
          cleanup();
          resolve(choices[cur]?.value ?? null);
        } else if (key.name === "escape" || key.name === "q") {
          cleanup();
          resolve(null);
        } else if (key.name && /^[1-9]$/.test(key.name)) {
          const i = Number(key.name) - 1;
          if (i < choices.length) {
            cur = i;
            render();
          }
        }
      };
      process.stdin.on("keypress", onKey);
      render();
    });
  }

  close(): void {
    if (this.nonTty) this.nonTty.close();
  }
}
