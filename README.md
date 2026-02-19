# Harness

Harness is a terminal-native workspace for running parallel coding agents on one machine, with project context, fast switching, and shared session state.

Use it when you want to move faster than a single chat window: keep multiple threads active, review diffs quickly, and drive work from one keyboard-first control plane.

## Why teams use it

- Run many agent threads in parallel across `codex`, `claude`, `cursor`, `terminal`, and `critique`.
- Keep native CLI ergonomics in one keyboard-first workspace.
- Keep long-running threads alive in the detached gateway so reconnects do not kill work.
- Open a command palette with `ctrl+p`/`cmd+p`, live-filter registered actions, and execute context-aware thread/project/runtime controls.
- Open a thread-scoped command palette from left-rail `[+ thread]` (same matcher/autocomplete as `ctrl+p`) to start/install agent CLIs per project.
- Open or create a GitHub pull request for the currently tracked project branch directly from the command palette.

## Demo

![Harness multi-thread recording](https://raw.githubusercontent.com/jmoyers/harness/main/assets/poem-recording.gif)

## Quick start

### Prerequisites

- Bun `1.3.9+`
- Rust toolchain
- At least one installed agent CLI (`codex`, `claude`, `cursor`, or `critique`)

### Install (npm package)

> Note: Harness requires Bun. It does not work with Node.js alone.

```bash
# Run directly with bunx (no install needed)
bunx @jmoyers/harness@latest

# Or install globally
bun add -g --trust @jmoyers/harness
```

### Install (from source)

```bash
bun install
bun link
```

### Run

```bash
harness
```

Use a named session when you want isolated state:

```bash
harness --session my-session
```

## Common workflow

1. Open Harness in your repo.
2. Start parallel threads for implementation and review.
3. Use the command palette (`ctrl+p` / `cmd+p`) to jump, run actions, and manage project context.
4. Open the repo or PR actions from inside Harness when GitHub auth is available.

## Critique threads

- Available in the thread-scoped command palette (`[+ thread]`).
- Runs with `--watch` by default.
- Install actions are availability-aware and config-driven (`*.install.command`), opening a terminal thread to run the configured install command when a tool is missing.
- `mux.conversation.critique.open-or-create` is bound to `ctrl+g` by default.

`ctrl+g` behavior is project-aware:

- If a critique thread exists for the current project, it selects it.
- If not, it creates and opens one in the main pane.

`session.interrupt` is also surfaced as a mux keybinding action (`mux.conversation.interrupt`) so teams can bind a dedicated in-client thread interrupt shortcut without overloading quit semantics.

## GitHub PR Integration

When GitHub auth is available (`GITHUB_TOKEN` or an authenticated `gh` CLI), Harness can:

- Detect the tracked branch for the active project and show `Open PR` (if an open PR exists) or `Create PR` in the command palette.
- Continuously sync open PR CI/check status into the control-plane store for realtime clients.
- If auth is unavailable, PR actions fail quietly and show a lightweight hint instead of surfacing hard errors.

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
GitHub project/PR integration is enabled by default and configured under `github.*`.

Example (install commands + critique defaults + hotkey override + OpenCode theme selection):

```jsonc
{
  "codex": {
    "install": {
      "command": "bunx @openai/codex@latest"
    }
  },
  "claude": {
    "install": {
      "command": "bunx @anthropic-ai/claude-code@latest"
    }
  },
  "cursor": {
    "install": {
      "command": null
    }
  },
  "critique": {
    "launch": {
      "defaultArgs": ["--watch"]
    },
    "install": {
      "command": "bunx critique@latest"
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

## Documentation

- `design.md` contains architecture and system design.
- `agents.md` contains execution and quality rules.

## License

MIT (`LICENSE`)
