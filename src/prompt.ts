/**
 * Buffered console line prompter, shared by the menu and the wizard. Queues
 * lines as they arrive so it works with both an interactive TTY and piped stdin
 * without losing any input.
 */
import { createInterface } from "node:readline";
import { c } from "./logger.ts";

export class Prompter {
  private queue: string[] = [];
  private pending: ((line: string) => void) | null = null;
  private closed = false;
  private readonly rl = createInterface({ input: process.stdin });

  constructor() {
    this.rl.on("line", (line) => {
      if (this.pending) {
        const res = this.pending;
        this.pending = null;
        res(line);
      } else {
        this.queue.push(line);
      }
    });
    this.rl.on("close", () => {
      this.closed = true;
      if (this.pending) {
        const res = this.pending;
        this.pending = null;
        res("");
      }
    });
  }

  /** True once stdin has ended (EOF / closed) — callers should stop looping. */
  get ended(): boolean {
    return this.closed;
  }

  async ask(prompt: string, def = ""): Promise<string> {
    process.stdout.write(`${prompt}${def ? c.dim(` [${def}]`) : ""} `);
    return (await this.next()).trim() || def;
  }

  private next(): Promise<string> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.closed) return Promise.resolve("");
    return new Promise((res) => {
      this.pending = res;
    });
  }

  close(): void {
    this.rl.close();
  }
}

export const yes = (s: string) => /^(y|yes|д|да|)$/i.test(s.trim());
