# Harness

Harness is a terminal-native control plane for agentic coding on your local machine.

Run multiple coding threads in parallel, keep each thread isolated to its own project context, and stay in control with one fast TUI and one typed realtime API.

## Why Agentic Coders Use It

If you run one agent at a time, you serialize work that could run concurrently.

Harness is built for developers who want to:

- run many coding threads at once across projects,
- keep thread context isolated and recoverable,
- switch instantly between active threads,
- step in, take over, and hand control back cleanly,
- script the same system through a typed API.

## What You Can Do Today

- Start parallel `codex`, `claude`, `cursor`, `terminal`, and `critique` threads in one workspace.
- Use project-scoped thread management (create, rename, archive, restore-ready metadata).
- Track repositories and tasks with full CRUD through the control plane (`repository.*`, `task.*`).
- Use strict human/agent control semantics (claim, release, takeover).
- Keep long-running sessions alive in the detached gateway while clients reconnect.
- Subscribe to typed realtime events for status, output, telemetry, and lifecycle activity.

## Demo

![Harness multi-thread recording](assets/poem-recording.gif)

## Quick Start

### Prerequisites

- Bun `1.3.9+`
- Rust toolchain (builds the PTY helper)
- At least one agent CLI you plan to use (`codex`, `claude`, `cursor`, or `critique`)

### Install and Run

```bash
bun install
bun run build:ptyd
bun link
harness
```

Harness connects to the current gateway session (or starts it in the background).

Use an isolated named session when you want separate state:

```bash
harness --session perf-a
```

## Critique Support

Harness includes first-class `critique` threads:

- Available in the New Thread modal.
- Runs with `--watch` by default.
- Auto-install path enabled by default via `bunx critique@latest` when `critique` is not installed.
- `mux.conversation.critique.open-or-create` is bound to `ctrl+g` by default.

`ctrl+g` behavior is project-aware:

- If a critique thread exists for the current project, it selects it.
- If not, it creates and opens one in the main pane.

## API for Automation

Harness exposes a typed realtime client for orchestrators, policy agents, and dashboards:

```ts
import { connectHarnessAgentRealtimeClient } from './src/control-plane/agent-realtime-api.ts';

const client = await connectHarnessAgentRealtimeClient({
  host: '127.0.0.1',
  port: 7777,
  subscription: { includeOutput: false },
});

client.on('session.status', ({ observed }) => {
  console.log(observed.sessionId, observed.status);
});

await client.close();
```

## Configuration

Runtime behavior is config-first via `harness.config.jsonc`.

Example (critique defaults + hotkey override):

```jsonc
{
  "critique": {
    "launch": {
      "defaultArgs": ["--watch"]
    },
    "install": {
      "autoInstall": true,
      "package": "critique@latest"
    }
  },
  "mux": {
    "keybindings": {
      "mux.conversation.critique.open-or-create": ["ctrl+g"]
    }
  }
}
```

## Operational Commands

```bash
harness gateway status
harness gateway start
harness gateway stop
```

Run the core quality gate:

```bash
bun run verify
```

## Documentation

- `design.md` for architecture and system design principles.
- `agents.md` for execution and quality rules.

## License

MIT (`LICENSE`)
