# Harness

Harness is a terminal-native control plane for agentic coding on your local machine.

Run many agent threads in parallel across `codex`, `claude`, `cursor`, `terminal`, and `critique`, while keeping each thread in project context with one fast TUI and one typed realtime API.

## What You Can Do

- Run many agent threads in parallel across `codex`, `claude`, `cursor`, `terminal`, and `critique`.
- Keep native CLI ergonomics while working from one keyboard-first workspace.
- Jump between threads in milliseconds, with 400+ FPS rendering under local workloads.
- Use `critique` threads for very fast diff/review loops, with native terminal access when you need to drop to commands.
- Keep long-running threads alive in the detached gateway so reconnects do not kill work.
- Add automation last through the typed realtime API (`projects`, `threads`, `repositories`, `tasks`, subscriptions).
- Plan work as scoped tasks (`project`, `repository`, `global`) and pull only `ready` tasks.
- Gate automation globally/per-repository/per-project (enable/disable + freeze), with optional project branch pinning and project-local task focus mode.
- See project/thread lifecycle updates from other connected clients in real time (no client restart rehydration loop).
- Get gateway-canonical thread status icons/text for structured agent threads, plus fixed one-cell title glyphs for `terminal`/`critique` threads (single server projection, no client-side status interpretation).
- Capture interleaved status debugging timelines (incoming status sources + outgoing status line/notice outputs) with a toggle and CLI commands.
- Capture focused render diagnostics (unsupported control sequences + ANSI integrity failures) with a dedicated toggle and CLI commands.

## Demo

![Harness multi-thread recording](assets/poem-recording.gif)

## Quick Start

### Prerequisites

- Bun `1.3.9+`
- Rust toolchain (used for the PTY helper; `bun install` auto-installs via `rustup` if missing)
- At least one agent CLI you plan to use (`codex`, `claude`, `cursor`, or `critique`)

### Install and Run

```bash
bun install
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

`session.interrupt` is also surfaced as a mux keybinding action (`mux.conversation.interrupt`) so teams can bind a dedicated in-client thread interrupt shortcut without overloading quit semantics.

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

Key orchestration calls are available in the same client:

- `client.tasks.pull(...)`
- `client.projects.status(projectId)`
- `client.projects.settings.get(projectId)` / `client.projects.settings.update(projectId, update)`
- `client.automation.getPolicy(...)` / `client.automation.setPolicy(...)`

## Configuration

Runtime behavior is config-first via `harness.config.jsonc`.

Example (critique defaults + hotkey override + OpenCode theme selection):

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
    "ui": {
      "theme": {
        "preset": "tokyonight",
        "mode": "dark",
        "customThemePath": null
      }
    },
    "keybindings": {
      "mux.conversation.critique.open-or-create": ["ctrl+g"]
    }
  }
}
```

`mux.ui.theme.customThemePath` can point to any local JSON file that follows the OpenCode theme schema (`https://opencode.ai/theme.json`).

## Operational Commands

```bash
harness gateway status
harness gateway start
harness gateway stop
harness status-timeline start
harness status-timeline stop
harness render-trace start
harness render-trace stop
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
