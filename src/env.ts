/** Minimal dependency-free .env loader (does not overwrite existing env vars). */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export async function loadEnv(file = resolve(process.cwd(), ".env")): Promise<void> {
  if (!existsSync(file)) return;
  const text = await readFile(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!.trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    )
      val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
