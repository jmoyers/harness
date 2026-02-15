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
- queue up independent tasks as isolated threads,
- switch between threads instantly,
- intervene when needed,
- and program the whole system from code.

## Demo

![Harness multi-thread recording](assets/poem-recording.gif)

## Core Capabilities

- Multi-project rail with fast thread switching and live status indicators.
- Parallel `codex` and `terminal` threads in the same workspace.
- Fresh context per thread by default (plus persisted continuity when supported).
- Session control ownership: claim/release/takeover semantics for human-agent handoff.
- Thread lifecycle management: create, rename, archive, and restore-ready metadata.
- Real-time typed event stream for status, telemetry, control changes, and output.
- Lifecycle hook connectors for external integrations (sound packs, webhooks, automation).
- Config-first behavior through one canonical file: `harness.config.jsonc`.

## Programmable Interface

Harness exposes a typed real-time client so you can build automations and integrations without screen-scraping.

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

await client.claimSession({
  sessionId: 'session-123',
  controllerId: 'human-operator',
  controllerType: 'human',
  reason: 'manual review'
});

const sessions = await client.listSessions({
  status: 'running',
  sort: 'attention-first'
});

console.log('running sessions', sessions.length);
```

### What You Can Build On Top

- Notification bridges (for example sound-pack routing via lifecycle events).
- Policy agents that auto-claim, steer, and release sessions.
- Dashboards showing thread health, ownership, and last-known-work summaries.
- Workflow orchestrators that dispatch and monitor many local branches.

## Under-the-Hood Visibility

Harness is built to expose operational truth, not hide it.

- Canonical thread/session lifecycle events.
- Typed telemetry events for status hints and recent work summaries.
- Mux projection instrumentation (`mux.session-projection.transition`) for icon/status-line timeline debugging.
- Selector index snapshots (`mux.selector.snapshot` + `mux.selector.entry`) so threads can be referenced by visible rail index.
- Session ownership/control transition events.
- Durable state in SQLite for reconnect-safe operations.
- Codex telemetry ingestion (logs, metrics, traces, history) for deep diagnostics.

## Performance and Quality Principles

- Performance is a first-class feature: low-latency interaction and predictable terminal behavior.
- Strict TypeScript in production code.
- 100% test coverage gate (lines/functions/branches).
- 100% lint gate (zero warnings).
- No privileged UI path: human and API flows use the same control plane.

## Getting Started

### Prerequisites

- Node.js 22+
- Rust toolchain (for PTY helper build)
- Codex CLI (for `codex` thread type)

### Run

```bash
npm install
npm run build:ptyd
```

Start the control plane:

```bash
npm run control-plane:daemon
```

Start the terminal UI in another shell:

```bash
npm run codex:live:mux
```

Configuration is file-first via `harness.config.jsonc`.

Inspect the latest selector index snapshot from perf artifacts:

```bash
npm run perf:mux:selector -- --file .harness/perf-startup.jsonl
```

## Documentation

- `design.md` for architecture and system design principles.
- `agents.md` for execution and quality laws.

## License

MIT (`LICENSE`)
