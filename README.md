# Harness

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)
![Lint](https://img.shields.io/badge/lint-0%20warnings-brightgreen)
![Tests](https://img.shields.io/badge/tests-passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-black)

Harness is a terminal-native control plane for running many AI coding threads in parallel on your local machine.

Use your preferred agent ergonomics, keep each task in fresh context on its own branch, and retain full human control with real-time visibility into what every thread is doing.

## Why This Matters

If you are running one agent at a time, you are serializing work that can run concurrently.

Harness is built for developers who want to:
- run 5-6 branches in parallel on one machine,
- queue up independent tasks that can be claimed by available agents,
- switch between threads instantly,
- intervene when needed,
- and program the whole system from code.

## Demo

![Harness multi-thread recording](assets/poem-recording.gif)

## Core Capabilities

- Multi-project rail with fast thread switching and live status indicators.
- `ctrl+j/k` cycles the full left-nav order of visible items (Home, repository groups, project headers, then project threads).
- `left/right` collapses or expands the selected repository group; `ctrl+k ctrl+0` collapses all groups, `ctrl+k ctrl+j` expands all groups.
- Projects can remain empty; threads start only via explicit `new thread` actions.
- Parallel `codex` and `terminal` threads in the same workspace.
- Fresh context per thread by default (plus persisted continuity when supported).
- Session control ownership: claim/release/takeover semantics for human-agent handoff.
- Thread lifecycle management: create, rename, archive, and restore-ready metadata.
- Tracked repository catalog is canonical and decoupled from directory projects (many projects can map to one repo).
- Startup/refresh repository scrape from active projects auto-upserts canonical repository records from normalized GitHub remotes.
- Left rail groups projects by canonical repository; projects with no detected remote are grouped under `untracked`.
- Programmatic repository model with full CRUD and archive semantics.
- Programmatic task lifecycle with full CRUD, explicit ordering, `draft -> ready -> in-progress -> completed`, plus ready/reset transitions.
- Task records include a typed `linear` compatibility payload (`issueId`, `identifier`, `teamId`, `projectId`, `stateId`, `assigneeId`, `priority`, `estimate`, `dueDate`, `labelIds`) so Linear sync adapters can round-trip without schema translation.
- Repository/task control-plane stream commands (`repository.*`, `task.*`) for automation and UI clients.
- Repository/task stream subscriptions, including scoped filters for `repositoryId` and `taskId`.
- Home planning pane is now repo-scoped: choose a repository from an inline dropdown, then work only on that repository's task queue.
- Home pane task input is Codex-style and keyboard-first: growing multiline composer, `enter` to create draft tasks, `shift+enter` newline, `↑` boundary to jump into task edit, `↓` boundary to save and return to draft composer.
- Draft/ready/complete controls are pinned on each task row and support both keyboard actions and mouse clicks.
- Home-pane task/repo/composer keybindings are config-driven under `mux.keybindings` action IDs (`mux.home.*`), so defaults can be fully remapped in `harness.config.jsonc`.
- Real-time typed event stream for status, telemetry, control changes, and output.
- Control-plane-owned git monitoring publishes `directory-git-updated` events; git polling/execution is no longer done in the client mux loop.
- Mux startup hydrates git/repository grouping from the gateway cache via `directory.git-status`, so early startup events cannot strand tracked projects under `untracked`.
- Codex history enrichment is ingested incrementally from appended bytes (non-blocking) instead of full-file rereads each poll.
- Codex notify-hook relay support on the same stream (`session-event notify`, including `agent-turn-complete` payloads).
- Lifecycle hook connectors for external integrations (sound packs, webhooks, automation).
- Directory-scoped Codex launch policy with configurable default mode (`yolo` by default).
- Config-first behavior through one canonical file: `harness.config.jsonc`.
- Detached gateway runtime: client disconnects do not stop running threads; gateway startup eagerly restores non-archived thread runtimes, and `harness gateway stop` is the explicit shutdown boundary for child sessions.
- `harness gateway stop` also performs workspace-scoped orphan `sqlite3` cleanup for the configured state DB path by default (`--no-cleanup-orphans` disables it).
- Named gateway sessions (`harness --session <name> ...`) isolate record/log/state paths under `.harness/sessions/<name>/...` so perf/test sessions do not mutate the default gateway state.
- Built-in CPU profiling workflow (`harness [--session <name>] profile`) captures Bun CPU profiles for both mux client and gateway at `.harness/profiles[/<session>]/{client,gateway}.cpuprofile`.

## Programmable Interface

Harness exposes a typed real-time client so you can build automations and integrations without screen-scraping.
The API is object-model oriented (`projects`, `threads`, `repositories`, `tasks`) and subscription-aware.
Session controls are available both as direct methods and grouped aliases under `sessions.*` for discoverability.

```ts
// Local import path in this repository.
import { connectHarnessAgentRealtimeClient } from './src/control-plane/agent-realtime-api.ts';

const client = await connectHarnessAgentRealtimeClient({
  host: '127.0.0.1',
  port: 7777,
  subscription: {
    includeOutput: false
  }
});

client.on('session.status', ({ observed }) => {
  console.log(observed.sessionId, observed.status, observed.attentionReason);
});

client.on('session.telemetry', ({ observed }) => {
  console.log(observed.sessionId, observed.keyEvent.summary);
});

const repository = await client.repositories.upsert({
  repositoryId: 'repository-1',
  name: 'harness',
  remoteUrl: 'https://github.com/acme/harness.git',
  defaultBranch: 'main'
});

const project = await client.projects.create({
  projectId: 'directory-1',
  path: '/Users/me/dev/harness'
});

const thread = await client.threads.create({
  projectId: project.projectId,
  title: 'Fix flaky tests',
  agentType: 'codex'
});

const task = await client.tasks.create({
  repositoryId: repository.repositoryId,
  title: 'stabilize control-plane tests',
  linear: {
    identifier: 'ENG-42',
    priority: 2,
    estimate: 3,
    dueDate: '2026-03-01',
    labelIds: ['infra']
  }
});

await client.tasks.draft(task.taskId);

await client.sessions.subscribeEvents(thread.threadId);
await client.sessions.respond(thread.threadId, 'continue');
await client.sessions.unsubscribeEvents(thread.threadId);

await client.tasks.claim({
  taskId: task.taskId,
  controllerId: 'agent-orchestrator',
  projectId: project.projectId
});

const taskSubscription = await client.subscriptions.create({
  repositoryId: repository.repositoryId
});

client.on('task.updated', ({ observed }) => {
  console.log(observed.task['taskId'], observed.task['status']);
});

const status = await client.threads.status(thread.threadId);
console.log('thread runtime', status.status);

await taskSubscription.unsubscribe();
await client.close();
```

### API/TUI Parity Contract

- `test/control-plane-api-parity.test.ts` enforces exact parser/server command parity and verifies that every command issued by the mux TUI is covered by the high-level agent API helpers.
- If you add or remove a control-plane command in `scripts/codex-live-mux.ts`, you must update `src/control-plane/agent-realtime-api.ts` helpers in the same change.
- If you add or remove a parser command in `src/control-plane/stream-command-parser.ts`, you must keep `src/control-plane/stream-server.ts` dispatch in lockstep.

### What You Can Build On Top

- Notification bridges (for example sound-pack routing via lifecycle events).
- Policy agents that auto-claim, steer, and release sessions.
- Dashboards showing thread health, ownership, and last-known-work summaries.
- Workflow orchestrators that dispatch and monitor many local branches.

## Under-the-Hood Visibility

Harness is built to expose operational truth, not hide it.

- Canonical thread/session lifecycle events.
- Typed telemetry events for status hints and recent work summaries.
- Deliberately minimal work-status projection: prompt/SSE progress marks `active`, turn-e2e metrics mark `inactive`, and controller ownership never overrides status text.
- Lifecycle telemetry is default-first: `codex.telemetry.captureVerboseEvents` defaults to `false`, retaining lifecycle events (`codex.conversation_starts`, `codex.user_prompt`, `codex.turn.e2e_duration_ms`) plus non-verbose high-signal events that carry explicit status hints.
- Mux projection instrumentation (`mux.session-projection.transition`) for icon/status-line timeline debugging.
- Selector index snapshots (`mux.selector.snapshot` + `mux.selector.entry`) so threads can be referenced by visible rail index.
- Session ownership/control transition events.
- Durable state in SQLite for reconnect-safe operations.
- Codex telemetry ingestion (logs, metrics, traces, history) for deep diagnostics when verbose capture is enabled.
- Shared mux runtime helpers are factored into `src/mux/live-mux/*` (args parsing, control-plane record parsing, startup env/terminal helpers, git/palette parsing, git/process snapshot probes, event mapping, pane layout math, selection/copy helpers).
- Mux regression checks are behavior-first; tests validate runtime behavior directly instead of asserting source-code string fragments.

## Performance and Quality Principles

- Performance is a first-class feature: low-latency interaction and predictable terminal behavior.
- Strict TypeScript in production code.
- 100% test coverage gate (lines/functions/branches).
- 100% Oxlint gate (zero warnings).
- No privileged UI path: human and API flows use the same control plane.

## Getting Started

### Prerequisites

- Bun 1.3.9+
- Rust toolchain (for PTY helper build)
- Codex CLI (for `codex` thread type)

### Migrate Older Checkout To Bun

If you pulled latest in an older checkout and want one command to clean legacy package-manager artifacts and reinstall with Bun:

```bash
bun run migrate:bun
```

What it does:
- removes legacy root lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `npm-shrinkwrap.json`) if present
- reinstalls dependencies from `bun.lock` (`bun install --frozen-lockfile`)
- rebuilds native PTY helper (`bun run build:ptyd`)
- preserves existing SQLite runtime state (`.harness/*.sqlite`)

When `harness` starts in a Bun-managed checkout, it now warns if legacy lockfiles are still present and prompts:

```bash
bun run migrate:bun
```

### Run

```bash
bun install
bun run build:ptyd
```

Install the canonical `harness` command from this checkout:

```bash
bun link
harness --help
```

Use `harness` as the default client. It connects to the gateway of record, or starts it in the background first:

```bash
harness
```

Use an isolated named session when you need a separate gateway state (projects, threads, repositories) from the default session:

```bash
harness --session perf-a
```

Record an optional GIF artifact by passing mux recording flags explicitly:

```bash
bun run harness -- --record-output .harness/mux-recording.gif
```

Run a high-FPS terminal animation scene (vibe-tunnel style) to stress rendering paths:

```bash
harness animate
```

Direct mux entrypoint is `bun run harness:core` (legacy alias `bun run codex:live:mux`).

Gateway lifecycle control is explicit:

```bash
harness gateway status
harness gateway start
harness gateway stop
harness gateway stop --no-cleanup-orphans
```

Capture a programmatic Bun CPU profile for both gateway and client in one run (gateway is auto-stopped so both profiles flush):

```bash
harness --session perf-a profile
```

Configuration is file-first via `harness.config.jsonc`.
Codex launch mode is controlled under `codex.launch` with `defaultMode` and per-directory `directoryModes` overrides.
Process-bootstrap secrets can be stored in `.harness/secrets.env` (for example `ANTHROPIC_API_KEY=...`); existing exported environment values take precedence.

Inspect the latest selector index snapshot from perf artifacts:

```bash
bun run perf:mux:selector -- --file .harness/perf-startup.jsonl
```

Run strict quality gates (lint, typecheck, dead-code, Bun test coverage with global + per-file 100% thresholds):

```bash
bun run verify
```

Run Oxc formatter checks or apply formatting:

```bash
bun run format:check
bun run format
```

Run the on-demand long Codex status stability scenario (3 poems + tool actions, extended timeout) to validate no premature `inactive` transitions under non-verbose telemetry:

```bash
bun run test:integration:codex-status:long
```

## Documentation

- `design.md` for architecture and system design principles.
- `agents.md` for execution and quality laws.

## License

MIT (`LICENSE`)
