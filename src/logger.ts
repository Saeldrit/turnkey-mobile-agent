/**
 * Tiny dependency-free console logger. Keeps build output readable and
 * compact (compact output is also part of token economy: the agent's own
 * messages are summarized, not dumped verbatim).
 */

const useColor =
  process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

const code = (n: string) => (s: string) => (useColor ? `[${n}m${s}[0m` : s);

export const c = {
  bold: code("1"),
  dim: code("2"),
  red: code("31"),
  green: code("32"),
  yellow: code("33"),
  blue: code("34"),
  magenta: code("35"),
  cyan: code("36"),
  gray: code("90"),
};

function ts(): string {
  // process.uptime avoids Date.now (deterministic-friendly) and is plenty for logs.
  const s = process.uptime();
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(0).padStart(2, "0");
  return c.gray(`[${m}:${sec}]`);
}

function truncate(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}

export const log = {
  banner(title: string): void {
    const line = "═".repeat(Math.max(8, title.length + 4));
    console.log("\n" + c.cyan(line));
    console.log(c.cyan("  " + c.bold(title)));
    console.log(c.cyan(line));
  },
  phase(n: number, total: number, title: string): void {
    console.log(
      "\n" + c.magenta(c.bold(`▸ Phase ${n}/${total}: ${title}`)),
    );
  },
  info(msg: string): void {
    console.log(`${ts()} ${msg}`);
  },
  step(msg: string): void {
    console.log(`${ts()} ${c.blue("•")} ${msg}`);
  },
  thinking(msg: string): void {
    console.log(`${ts()} ${c.gray("…")} ${c.dim(truncate(msg, 160))}`);
  },
  agentText(msg: string): void {
    const t = truncate(msg, 400);
    if (t.length > 0) console.log(`${ts()} ${c.gray("│")} ${t}`);
  },
  tool(name: string, detail: string): void {
    console.log(`${ts()} ${c.yellow("⚙")} ${c.bold(name)} ${c.dim(truncate(detail, 160))}`);
  },
  success(msg: string): void {
    console.log(`${ts()} ${c.green("✓")} ${msg}`);
  },
  warn(msg: string): void {
    console.log(`${ts()} ${c.yellow("⚠")} ${msg}`);
  },
  error(msg: string): void {
    console.log(`${ts()} ${c.red("✗")} ${msg}`);
  },
  usage(label: string, costUsd: number, inTok: number, outTok: number): void {
    console.log(
      `${ts()} ${c.cyan("∑")} ${label} — ${c.bold("$" + costUsd.toFixed(4))} ` +
        c.dim(`(in ${inTok.toLocaleString()} / out ${outTok.toLocaleString()} tok)`),
    );
  },
};

export { truncate };
