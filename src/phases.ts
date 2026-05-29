/**
 * Phase definitions for the native Android (Kotlin + Compose) pipeline. The
 * orchestrator runs these in order; each phase is a single bounded SDK query
 * with a fresh, lean context. Every prompt anchors on the durable state first.
 */
import { STATE_FILENAME, PLAN_FILENAME } from "./config.ts";
import type { PhaseId } from "./types.ts";

export interface PhaseContext {
  readonly task: string;
  readonly slug: string;
  readonly appDir: string;
  /** LLM provider id used for this phase (for logging/diagnostics). */
  readonly provider: string;
  /** 1-based round for loopable phases (implement / verify). */
  readonly round: number;
}

export interface PhaseSpec {
  readonly id: PhaseId;
  readonly title: string;
  buildPrompt(ctx: PhaseContext): string;
}

const anchor = `Before anything else, read ${STATE_FILENAME} and ${PLAN_FILENAME} in the app directory to recover exactly what is already done, then continue from the first unfinished item. Trust those files over your memory.`;

const TASK_BLOCK = (task: string) => `## APP TASK SPEC\n${task.trim()}\n`;

export const PHASES: readonly PhaseSpec[] = [
  {
    id: "plan",
    title: "Plan",
    buildPrompt: (ctx) =>
      [
        TASK_BLOCK(ctx.task),
        `## OBJECTIVE — PLAN`,
        `Design the native Android app. Do NOT write app code yet.`,
        `1. Write ${PLAN_FILENAME}: overview, full feature list, every screen/destination (one-line purpose), the data model as Room entities + DAOs, the navigation map, target = Google Play (Android), and every default decision where the spec is silent.`,
        `2. Initialize ${STATE_FILENAME} with the documented schema. Fill app.name and app.description; fill plan.screens / plan.features / plan.dataModel; set deploy.applicationId to a reverse-DNS id from the slug "${ctx.slug}" (e.g. com.turnkey.${ctx.slug.replace(/-/g, "")}); keep versionName "1.0.0" / versionCode 1.`,
        `3. Build a concrete tasks[] checklist covering scaffold (Gradle project + wrapper), implement (one task per screen/feature/entity), verify, and deploy work. Stable ids (t1, t2, …), status "todo", correct phase per task.`,
        `Keep it tight and realistic. End when ${PLAN_FILENAME} and ${STATE_FILENAME} are written.`,
      ].join("\n\n"),
  },
  {
    id: "scaffold",
    title: "Scaffold Gradle project",
    buildPrompt: (ctx) =>
      [
        anchor,
        `## OBJECTIVE — SCAFFOLD`,
        `Stand up a buildable native Android project whose ROOT is this directory (${ctx.appDir}). There is no create-app CLI for Android — write the Gradle project files yourself, and do NOT touch ${STATE_FILENAME} or ${PLAN_FILENAME}.`,
        `Create: settings.gradle.kts, root build.gradle.kts, app/build.gradle.kts, gradle/libs.versions.toml (version catalog), gradle.properties (AndroidX, Kotlin code style; set org.gradle.java.home only if needed for JDK compatibility), app/src/main/AndroidManifest.xml, the single MainActivity (ComponentActivity + setContent), a Material 3 theme (Color/Theme/Type), app/src/main/res essentials (strings.xml, themes, launcher icon via mipmap or adaptive icon), local.properties (sdk.dir — gitignored), and a proper Android .gitignore.`,
        `Bootstrap the Gradle wrapper (no global gradle): download an official Gradle distribution from https://services.gradle.org/distributions/ and run its gradle to generate the wrapper, or fetch the pinned gradle-wrapper.jar. Then confirm the toolchain by running the wrapper, e.g. \`gradlew.bat :app:compileDebugKotlin\` (or \`./gradlew\`), and fix any setup errors so it at least configures and compiles the empty app.`,
        `Set applicationId/min/target SDK from ${STATE_FILENAME}.deploy. Mark scaffold tasks "done". Do not build full features yet.`,
      ].join("\n\n"),
  },
  {
    id: "implement",
    title: "Implement features",
    buildPrompt: (ctx) =>
      [
        anchor,
        `## OBJECTIVE — IMPLEMENT${ctx.round > 1 ? ` (continuation round ${ctx.round})` : ""}`,
        `Build the full app per ${PLAN_FILENAME}: every Composable screen, Navigation Compose graph, ViewModels (StateFlow), the Room database (entities, DAOs, database class) and a repository, plus shared UI components. The app must be genuinely functional, not a mockup.`,
        `Work through tasks[] with status todo/doing in sensible order. After completing each, set its status to "done" in ${STATE_FILENAME} immediately. Each screen handles loading/empty/error states and validates input. Use immutable state and unidirectional data flow.`,
        `Keep files small and focused; type everything; the code must compile as you go (\`:app:compileDebugKotlin\`).`,
        `Stop this phase when every implement-phase task is "done". If interrupted/compacted, resume from the first unfinished task — do not restart.`,
      ].join("\n\n"),
  },
  {
    id: "verify",
    title: "Verify build",
    buildPrompt: (ctx) =>
      [
        anchor,
        `## OBJECTIVE — VERIFY${ctx.round > 1 ? ` (round ${ctx.round})` : ""}`,
        `Prove the app builds. Run \`:app:compileDebugKotlin\` and fix EVERY error. Then run \`:app:assembleDebug\` and fix EVERY error until it produces an APK under app/build/outputs/apk/debug/. Then run \`:app:lintDebug\` and address real issues.`,
        `Only set ${STATE_FILENAME}.verification.compile = "pass" when compileDebugKotlin exits 0, .assemble = "pass" when assembleDebug exits 0 and the APK exists, and .lint accordingly. Put caveats in .verification.notes. Never fake a pass — if it fails, fix the code and re-run.`,
      ].join("\n\n"),
  },
  {
    id: "deploy",
    title: "Deployment readiness",
    buildPrompt: (ctx) =>
      [
        anchor,
        `## OBJECTIVE — DEPLOY READINESS`,
        `Make the app ready for Google Play (configuration only — do NOT generate a real upload keystore or publish).`,
        `1. Wire a release signingConfig in app/build.gradle.kts that reads from a gitignored keystore.properties (storeFile/storePassword/keyAlias/keyPassword). Commit a keystore.properties.example with placeholders. Ensure \`:app:bundleRelease\` is configured to output a Play-ready .aab.`,
        `2. Confirm applicationId, versionCode, versionName, minSdk/targetSdk are set and recorded in ${STATE_FILENAME}.deploy. Enable R8/minify for release sensibly (proguard-rules.pro present).`,
        `3. Write a complete README.md: what the app does, prerequisites (Android Studio, JDK, SDK), open/run instructions, \`gradlew installDebug\`, building a release AAB (\`gradlew bundleRelease\`), signing setup, and Play Console upload steps.`,
        `4. Set ${STATE_FILENAME}.deploy.signingConfigured = true.`,
      ].join("\n\n"),
  },
  {
    id: "finalize",
    title: "Finalize & report",
    buildPrompt: (ctx) =>
      [
        anchor,
        `## OBJECTIVE — FINALIZE`,
        `Check the Definition of Done against ${STATE_FILENAME} and the actual filesystem. If anything required is missing, fix it now. Then write BUILD_REPORT.md: a concise summary of what was built, the screen/feature list, how to run, how to deploy to Play, verification results, and any follow-ups. Keep it short and factual. Mark the finalize task done.`,
      ].join("\n\n"),
  },
] as const;

export function phaseById(id: PhaseId): PhaseSpec {
  const spec = PHASES.find((p) => p.id === id);
  if (!spec) throw new Error(`Unknown phase: ${id}`);
  return spec;
}
