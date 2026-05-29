# Turnkey Mobile Agent

An autonomous agent that turns a one-paragraph idea into a **complete, deployable
native Android app** — **Kotlin + Jetpack Compose**, Gradle, planned, scaffolded,
implemented, compiled, APK-verified, and packaged with a signing config and a
release-AAB setup ready for Google Play.

Runs on **Claude or other top models** (Qwen, DeepSeek, Kimi, GLM, or any
Anthropic-compatible endpoint) — switchable per run, even per phase.

Built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).

---

## The console UI

`npm start` — or double-click **`start.bat`** (Windows) / run **`./start.sh`**
(macOS/Linux) — opens the home menu:

```text
══════════════════
  TURNKEY MOBILE
══════════════════
  1)  🆕  Создать новое приложение            (build a new app)
  2)  📊  Статус сборок                       (what's built, how far each got)
  3)  ▶   Продолжить незавершённую сборку     (resume an interrupted build)
  4)  📲  Собрать APK и поставить на телефон  ("where's my app?" → APK + USB install)
  5)  🩺  Проверка готовности (doctor)
  6)  🚪  Выход
```

Navigate with **↑/↓ and Enter** (or just press the number; `q` cancels). Pick
**🆕 Создать новое приложение** and it walks you through a few questions, then
builds with a live progress bar:

```text
══════════════════════════════════
  TURNKEY MOBILE — мастер сборки
══════════════════════════════════
  Нативное Android-приложение (Kotlin + Compose) под ключ.

1) Что за приложение делаем?
   Опиши одной-двумя фразами — или укажи путь к .md со спецификацией.
   → habit tracker with reminders and a weekly chart

2) На какой модели строить?
   1. Anthropic (Claude)         (готов)
   2. Qwen (Alibaba DashScope)   (missing DASHSCOPE_API_KEY)
   3. DeepSeek                   (missing DEEPSEEK_API_KEY)
   4. Kimi (Moonshot)            (missing MOONSHOT_API_KEY)
   5. GLM (Z.ai)                 (missing ZAI_API_KEY)
   6. Custom (Anthropic-compatible)
   Номер → [1]

3) Имя проекта  (папка внутри workspace/)   → [habit-tracker]

4) Лимит стоимости, $  (страховка)           → [8]

Готово к запуску:   Enter — запустить, q — отмена
```

While it builds you see only a compact progress bar — not a wall of logs:

```text
  ✓ ████████░░░░░░░░░░░░░░  22%  Каркас проекта
  ⠹ ██████████████░░░░░░░░  61%  Реализация · пишу NoteEditorScreen.kt
```

No flags to remember. The wizard also **lists every model with its readiness**,
**offers to enter + save a provider key** if one is missing, and **offers to
resume** a build it finds. Menu option **4** is the "I forgot where my app is and
how to run it" button — it builds the debug APK and installs it on a connected
phone over USB. Source lands in `workspace/<slug>/` (open in Android Studio, or
`gradlew installDebug`).

---

## Install

```bash
npm install          # one time
npm run doctor       # check this machine is ready (Node, provider keys, Android SDK/JDK)
npm start            # launch the wizard
```

Or just **double-click `start.bat`** — it installs dependencies on first run, then
opens the wizard. `npm run doctor` prints a green/yellow checklist of what's ready
and what's missing.

---

## Why it's reliable, cheap, and compaction-proof

Under the hood the agent does **not** run as one giant conversation. It runs as a
deterministic pipeline of bounded phases, each a fresh Agent SDK `query()`:

```text
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
| **Max performance** | `bypassPermissions` (zero approval stalls), parallel tool calls, the Claude Code system-prompt preset, bounded turns/rounds, and auto-retry of transient API errors. |
| **Resumable** | The wizard offers to resume; it skips completed phases and picks up where it stopped. |

---

## Stack & toolchain

Generated apps are **native Android**:

- Kotlin (latest stable) + Jetpack Compose + Material 3 — no XML layouts.
- Single `ComponentActivity`, Navigation Compose, MVVM (ViewModel + StateFlow), repository layer.
- Room (+ KSP) for persistence; DataStore for key/value.
- Gradle Kotlin DSL + a version catalog (`gradle/libs.versions.toml`) and the Gradle wrapper.
- Signed release AAB via `bundleRelease` for Google Play.

To **build/verify** locally you need an Android toolchain (the wizard's sibling
`npm run doctor` checks all of this):

- **Android SDK** (auto-detected via `ANDROID_HOME` or `%LOCALAPPDATA%\Android\Sdk`).
- A **JDK** the Android Gradle Plugin accepts. If your system JDK is too new, the
  agent points Gradle at **Android Studio's bundled JBR** automatically.
- **Gradle is not required globally** — the agent bootstraps the Gradle wrapper.

The agent writes a gitignored `local.properties` with `sdk.dir` so `gradlew` works.

---

## Providers — Claude, Qwen, and others

The wizard lists every provider with its readiness and lets you pick one (and
paste a key if it's missing). Keys live in `.env` (see `.env.example`).

| Provider | id | Key env | Endpoint |
|---|---|---|---|
| Claude | `anthropic` | *(Claude Code login)* or `ANTHROPIC_API_KEY` | default |
| Qwen (DashScope) | `qwen` | `DASHSCOPE_API_KEY` | `…/api/v2/apps/claude-code-proxy` |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | `api.deepseek.com/anthropic` |
| Kimi (Moonshot) | `kimi` | `MOONSHOT_API_KEY` | `api.moonshot.ai/anthropic` |
| GLM (Z.ai) | `glm` | `ZAI_API_KEY` | `api.z.ai/api/anthropic` |
| Any compatible | `custom` | `TURNKEY_API_KEY`/`TURNKEY_AUTH_TOKEN` | `TURNKEY_BASE_URL` |

Non-Claude models are driven through their Anthropic-compatible endpoints and the
`ANTHROPIC_DEFAULT_*_MODEL` alias remap. The agent loop is tuned for Claude, so
other models can be less reliable on long autonomous runs — Claude is the safest
default. You can even **mix providers per phase** (plan on Claude, write code on
Qwen) — see Advanced below.

---

## What "turnkey" means here

A build is only reported `TURNKEY` when **all** hold:

1. `gradlew :app:compileDebugKotlin` succeeds.
2. `gradlew :app:assembleDebug` produces a debug APK (proof it builds).
3. `build.gradle.kts` has applicationId / versionCode / versionName / min+target SDK.
4. A release `signingConfig` reads from a gitignored `keystore.properties`, and `bundleRelease` is configured for a Play AAB.
5. `README.md` documents run, release build, signing, and Play Console upload.
6. A proper Android `.gitignore`.

Putting the generated app on a device / Play is then:

```bash
cd workspace/<slug>
gradlew installDebug                                  # run on a connected device/emulator
gradlew bundleRelease                                 # signed Play-ready .aab
# upload app/build/outputs/bundle/release/app-release.aab to the Play Console
```

---

## Hand it off to someone else

It's the same simple flow on their machine. Two things travel **separately** from
the code: **auth** and **the Android toolchain**.

1. **Share the code** — clone this repo (or zip the folder without `node_modules/`,
   `.env`, `workspace/`). `.gitignore` already excludes secrets and generated output.
2. **They run it:** `npm install`, then **double-click `start.bat`** (or `npm start`).
   `npm run doctor` tells them exactly what's missing.
3. **Auth is their own** — your `.env`/Claude login is not included. In the wizard
   they pick Claude (after `claude` login or their own `ANTHROPIC_API_KEY`) or
   another provider and paste its key when prompted.
4. **To build/verify** they need Android Studio + SDK + a JDK. For the generated
   source only (building elsewhere), Node alone is enough.

Each user is billed on their own account / limits / API keys.

---

## Advanced — scripting & CI (flags, no prompts)

The wizard is for interactive use. For automation/CI, call the CLI directly with
`npx tsx` (not `npm start -- …` — `npm run` strips unknown `--flags` on some platforms):

```bash
npx tsx src/cli.ts --task-file ./examples/notes.task.md --slug notes --provider qwen --resume
npm run smoke -- qwen        # cheaply verify a provider's key/endpoint
```

| Flag | Meaning |
|---|---|
| `--task-file <path>` | Read the app spec from a file (or pass a description as a bare argument). |
| `--slug <slug>` | App slug (kebab-case). Defaults to one derived from the task. |
| `--provider <id>` | LLM provider: `anthropic` (default), `qwen`, `deepseek`, `kimi`, `glm`, `custom`. |
| `--out <dir>` | Output root for generated apps (default `./workspace`). |
| `--app-dir <dir>` | Explicit target directory (overrides `--out`/`--slug`). |
| `--max-cost <usd>` | Hard cost ceiling for the whole build (default `8`). |
| `--resume` | Skip phases already recorded complete in `BUILD_STATE.json`. |
| `--plan-only` | Stop after the PLAN phase. |

Mix providers per phase via env (also settable in `.env`):

```bash
TURNKEY_PROVIDER_PLAN=anthropic TURNKEY_PROVIDER_BUILD=qwen \
  npx tsx src/cli.ts --task-file ./examples/notes.task.md --slug notes
```

---

## Project layout

```text
src/
  menu.ts           # console menu home screen — the default entry (npm start / start.bat)
  wizard.ts         # the straight "build one app" flow (npm run wizard)
  cli.ts            # flag-based entry for scripting / CI
  interactive.ts    # shared "new app" questions     tui.ts # arrow-key select + text input
  progress.ts       # live % progress bar            status.ts # build status (npm run status)
  doctor.ts         # readiness check (npm run doctor)
  orchestrator.ts   # deterministic phase pipeline + budget + resume + progress
  phases.ts         # per-phase objectives (Android pipeline)
  runPhase.ts       # one phase = one bounded SDK query (progress/verbose + provider + retry)
  systemPrompt.ts   # role + durable-state protocol + DoD (appended to the preset)
  providers.ts      # Claude / Qwen / DeepSeek / Kimi / GLM / custom registry
  state.ts          # BUILD_STATE.json (durable, immutable updates)
  budget.ts         # token/cost accounting + ceiling
  config.ts         # per-phase model/turns/tools + Android SDK/JDK resolution
  slug.ts  env.ts  logger.ts  smoke.ts   # helpers + SDK/auth check
start.bat / start.sh  # one-click launchers (install deps + open the menu)
examples/             # ready-to-run task specs
workspace/            # generated apps land here
```

## Cost & limits note

On Claude subscription plans, Agent SDK usage draws from your plan's limits (and,
from June 15 2026, a separate monthly Agent SDK credit). Other providers bill per
their own pricing. The cost ceiling (wizard step 4 / `--max-cost`) and per-phase
turn limits keep any single run bounded.
