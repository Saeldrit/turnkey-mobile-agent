/**
 * Readiness check. `npm run doctor` reports whether this machine can run the
 * agent and build native Android apps, and which LLM providers are configured.
 * Run this first on a fresh machine (e.g. after someone hands you the agent).
 */
import { execSync } from "node:child_process";
import { loadEnv } from "./env.ts";
import { log, c } from "./logger.ts";
import { knownProviders, providerReady, PROVIDERS } from "./providers.ts";
import { resolveAndroidSdk, resolveGradleJdk } from "./config.ts";

function probe(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    const x = e as { stdout?: unknown; stderr?: unknown };
    return String(x.stdout ?? x.stderr ?? "").trim();
  }
}

function line(good: boolean, label: string, detail: string): void {
  (good ? log.success : log.warn)(`${label} ${c.dim(detail)}`);
}

async function main(): Promise<void> {
  await loadEnv();
  log.banner("TURNKEY MOBILE — DOCTOR");

  // 1. Node (only hard requirement to RUN the agent).
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  line(nodeMajor >= 20, `Node ${process.version}`, nodeMajor >= 20 ? "(>=20 OK)" : "(need Node >=20)");

  // 2. LLM providers — at least one must be ready to run a build.
  console.log("\n  " + c.bold("LLM providers") + c.dim("  (need at least one ready)"));
  let anyProvider = false;
  for (const id of knownProviders()) {
    const r = providerReady(id);
    if (r.ok) anyProvider = true;
    const label = `${id.padEnd(9)} ${PROVIDERS[id]?.label ?? ""}`;
    line(r.ok, "  " + label, r.ok ? `→ ${r.reason}` : `→ ${r.reason}`);
  }
  if (!anyProvider)
    log.error("  No provider is ready. Log into Claude Code, or set a provider key in .env.");

  // 3. Android toolchain — needed to BUILD/VERIFY the generated app locally.
  console.log("\n  " + c.bold("Android toolchain") + c.dim("  (needed to compile/verify here)"));
  const sdk = resolveAndroidSdk();
  line(!!sdk, "  Android SDK", sdk ? sdk : "not found — install Android Studio or set ANDROID_HOME");

  const javaLine = probe("java -version 2>&1").split("\n")[0] ?? "";
  line(!!javaLine, "  java on PATH", javaLine || "not found — install a JDK (17/21) or Android Studio");

  const jbr = resolveGradleJdk();
  line(!!jbr, "  AGP-compatible JDK (Android Studio JBR)", jbr ? jbr : "not found — Gradle will use the system JDK");

  console.log(c.dim("  (Gradle itself is not required globally — the agent bootstraps the wrapper.)"));

  // 4. Verdict.
  console.log("");
  if (anyProvider && sdk) log.success("Ready: you can build and verify native Android apps here.");
  else if (anyProvider) log.warn("Can plan/generate code, but install the Android SDK to compile/verify locally.");
  else log.error("Not ready — configure a provider first (see .env.example).");
}

void main();
