# Turnkey Mobile Agent

An autonomous agent that turns a one-paragraph task spec into a **complete,
deployable native Android app** — **Kotlin + Jetpack Compose**, Gradle, planned,
scaffolded, implemented, compiled, APK-verified, and packaged with a signing
config and a release-AAB setup ready for Google Play.

Runs on **Claude or other top models** (Qwen, DeepSeek, Kimi, GLM, or any
Anthropic-compatible endpoint) — switchable per run, even per phase.

Built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).

## Quick start — just run it

**Easiest:** double-click **`start.bat`** (Windows) or run **`./start.sh`** (macOS/Linux).
It installs dependencies once and opens an interactive wizard that asks what to build,
which model to use, and the rest — no flags to remember.

Or from a terminal:

```bash
npm install
npm start            # interactive wizard
npm run doctor       # first time on a machine: check you're ready
```

The wizard collects everything and runs the build. The finished app lands in
`workspace/<slug>/`, opens in Android Studio, and runs with `gradlew installDebug`.

<details><summary><b>Advanced:</b> one-shot, no prompts (flags)</summary>

```bash
npx tsx src/cli.ts --task-file ./examples/notes.task.md --slug notes --provider qwen
```

Call the CLI directly with `npx tsx` (not `npm start -- …`): `npm run` strips unknown
`--flags` on some platforms. The CLI also accepts a bare spec-file path as a safety net.
</details>

---

## Why it's reliable, cheap, and compaction-proof

The agent does **not** run as one giant conversation. It runs as a deterministic
pipeline of bounded phases, each a fresh Agent SDK `query()`:

```
PLAN ─▶ SCAFFOLD ─▶ IMPLEMENT* ─▶ VERIFY* ─▶ DEPLOY ─▶ FINALIZE
                    (loops)        (loops)
```

The single source of truth is on disk, not in the model's context:

- **`PLAN.md`** — human-readable plan (features, screens, Room data model, nav, deploy).
- **`BUILD_STATE.json`** — machine-readable checklist + progress + verification verdicts.

| Requirement | How it's met |
|---|---|
| **Survives context compaction** | Every phase re-reads `BUILD_STATE.json`/`PLAN.md` first and continues from the first unfinished task. If working memory is compacted mid-phase, the durable files let it recover. State lives on the filesystem, never only in context. |
| **Saves tokens** | Each phase starts with a small, focused context instead of dragging the whole history forward. Cheaper models run the bulk of coding; the strongest model is reserved for planning. Targeted edits, no re-reading, big subtasks offloaded to subagents. |
| **Max performance** | `permissionMode: bypassPermissions` (zero approval stalls), parallel tool calls, the Claude Code system-prompt preset, and bounded turns/rounds so it always converges. |
| **Resumable** | `--resume` skips completed phases and picks up exactly where it stopped. |

---

## Stack & toolchain

Generated apps are **native Android**:

- Kotlin (latest stable) + Jetpack Compose + Material 3 — no XML layouts.
- Single `ComponentActivity`, Navigation Compose, MVVM (ViewModel + StateFlow), repository layer.
- Room (+ KSP) for persistence; DataStore for key/value.
- Gradle Kotlin DSL + a version catalog (`gradle/libs.versions.toml`) and the Gradle wrapper.
- Signed release AAB via `bundleRelease` for Google Play.

You need a local Android toolchain to **build/verify**:

- **Android SDK** (auto-detected via `ANDROID_HOME` or `%LOCALAPPDATA%\Android\Sdk`).
- A **JDK** the Android Gradle Plugin accepts. If your system JDK is too new, the
  agent points Gradle at **Android Studio's bundled JBR** automatically.
- **Gradle is not required globally** — the agent bootstraps the Gradle wrapper.

The agent writes a gitignored `local.properties` with `sdk.dir` so `gradlew` works.

---

## Providers — run on Claude, Qwen, or others

Pick with `--provider <id>` (default `anthropic`). Set the matching key in `.env`.

| Provider | id | Key env | Endpoint |
|---|---|---|---|
| Claude | `anthropic` | *(Claude Code login)* or `ANTHROPIC_API_KEY` | default |
| Qwen (DashScope) | `qwen` | `DASHSCOPE_API_KEY` | `…/api/v2/apps/claude-code-proxy` |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | `api.deepseek.com/anthropic` |
| Kimi (Moonshot) | `kimi` | `MOONSHOT_API_KEY` | `api.moonshot.ai/anthropic` |
| GLM (Z.ai) | `glm` | `ZAI_API_KEY` | `api.z.ai/api/anthropic` |
| Any compatible | `custom` | `TURNKEY_API_KEY`/`TURNKEY_AUTH_TOKEN` | `TURNKEY_BASE_URL` |

```bash
npm run smoke -- qwen                                   # test a provider's key/endpoint
npx tsx src/cli.ts --task-file ./examples/notes.task.md --provider qwen
```

**Mix providers per phase** (each phase is a separate query, so this just works):

```bash
# Plan & verify on Claude (reasoning), write the bulk of the code on Qwen (cheap)
TURNKEY_PROVIDER_PLAN=anthropic TURNKEY_PROVIDER_BUILD=qwen \
  npx tsx src/cli.ts --task-file ./examples/notes.task.md --slug notes
```

> Non-Claude models are driven through their Anthropic-compatible endpoints and
> the `ANTHROPIC_DEFAULT_*_MODEL` alias remap. The whole agent loop (tool use,
> the Claude Code preset) is tuned for Claude, so non-Claude models can be less
> reliable on long autonomous runs — Claude is the safest default.

---

## Usage

```bash
# From a description
npx tsx src/cli.ts "A habit tracker with reminders and a weekly progress chart"

# From a spec file (recommended for anything non-trivial)
npx tsx src/cli.ts --task-file ./examples/notes.task.md --slug notes

# Choose a provider / continue / plan only
npx tsx src/cli.ts --task-file ./examples/notes.task.md --provider qwen
npx tsx src/cli.ts --task-file ./examples/notes.task.md --slug notes --resume
npx tsx src/cli.ts --task-file ./examples/notes.task.md --slug notes --plan-only
```

### Flags

| Flag | Meaning |
|---|---|
| `--task-file <path>` | Read the app spec from a file. |
| `--slug <slug>` | App slug (kebab-case). Defaults to one derived from the task. |
| `--provider <id>` | LLM provider (see table above). Default `anthropic`. |
| `--out <dir>` | Output root for generated apps (default `./workspace`). |
| `--app-dir <dir>` | Explicit target directory (overrides `--out`/`--slug`). |
| `--max-cost <usd>` | Hard cost ceiling for the whole build (default `8`). |
| `--resume` | Skip phases already recorded complete in `BUILD_STATE.json`. |
| `--plan-only` | Stop after the PLAN phase. |

Token-economy env knobs and per-phase provider mixing live in `.env` — see `.env.example`.

---

## Run, manage & hand it off

### Day-to-day

```bash
npm run doctor                  # is this machine ready? which providers are configured?
npm run smoke                   # cheaply verify auth/provider (npm run smoke -- qwen)
npx tsx src/cli.ts --task-file spec.md --slug myapp [--provider qwen]
```

- Output lands in `workspace/<slug>/` — open it in Android Studio, run `gradlew installDebug`.
- Watch progress in the console, or read `workspace/<slug>/BUILD_STATE.json` any time.
- If a run is interrupted or hits `--max-cost`, just re-run with `--resume`.

### Hand it off to a friend

Two things travel **separately** from the code: **auth** and **the Android toolchain**.

1. **Share the code** (pick one):
   - Zip the folder **without** `node_modules/`, `.env`, `workspace/`.
   - Or push to git (recommended): `git init && git add . && git commit -m "init"`, then
     share the repo. `.gitignore` already excludes secrets and generated output.
2. **Your friend, on their machine:**
   ```bash
   npm install
   npm run doctor          # tells them exactly what's missing
   ```
3. **Auth — they use their own credentials, not yours.** You can't share a Claude
   subscription, and your `.env` keys are not included in the handoff:
   - Claude: log into Claude Code (`claude`) once, or set their own `ANTHROPIC_API_KEY`.
   - Or a provider key in their `.env` (e.g. `DASHSCOPE_API_KEY` for Qwen) + `--provider qwen`.
4. **To build/verify** generated apps they also need Android Studio + SDK + a JDK. If they
   only want the generated source (to build elsewhere), Node alone is enough to run the agent.

Each user is billed on their own account / limits / API keys.

## What "turnkey" means here

A build is only reported `TURNKEY` when **all** hold:

1. `gradlew :app:compileDebugKotlin` succeeds.
2. `gradlew :app:assembleDebug` produces a debug APK (proof it builds).
3. `build.gradle.kts` has applicationId / versionCode / versionName / min+target SDK.
4. A release `signingConfig` reads from a gitignored `keystore.properties`, and `bundleRelease` is configured for a Play AAB.
5. `README.md` documents run, release build, signing, and Play Console upload.
6. A proper Android `.gitignore`.

Deploying the generated app is then:

```bash
cd workspace/<slug>
gradlew installDebug                                  # run on a device/emulator
gradlew bundleRelease                                 # signed Play-ready .aab
# upload app/build/outputs/bundle/release/app-release.aab to the Play Console
```

---

## Project layout

```
src/
  cli.ts            # arg parsing, .env, entry
  orchestrator.ts   # deterministic phase pipeline + budget + resume
  phases.ts         # per-phase objectives (Android pipeline)
  runPhase.ts       # one phase = one bounded SDK query (streaming + usage + provider)
  systemPrompt.ts   # role + durable-state protocol + DoD (appended to preset)
  providers.ts      # Claude / Qwen / DeepSeek / Kimi / GLM / custom registry
  state.ts          # BUILD_STATE.json (durable, immutable updates)
  budget.ts         # token/cost accounting + ceiling
  config.ts         # per-phase model/turns/tools + Android SDK/JDK resolution
  env.ts            # .env loader
  logger.ts         # compact console output
  smoke.ts          # SDK/auth/provider check
examples/           # ready-to-run task specs
workspace/          # generated apps land here
```

## Cost & limits note

On Claude subscription plans, Agent SDK usage draws from your plan's limits
(and, from June 15 2026, a separate monthly Agent SDK credit). Other providers
bill per their own pricing. The `--max-cost` ceiling and per-phase turn limits
keep any single run bounded.
