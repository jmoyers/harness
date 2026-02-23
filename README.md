# Harness

Harness is minimal agent orchestration in the terminal.

Programmable, agent-agnostic, threaded, ergonomic, and fast.

## What matters most

- Parallel threads across `codex`, `claude`, `cursor`, `terminal`, and `critique`.
- One command palette (`ctrl+p`) to jump threads, run actions, and control workflow quickly.
- Toggle the bottom debug bar with `cmd+p` when you need runtime launch/auth context.
- Codex, Claude Code, and Cursor together in one workspace.
- Diff with Critique, with integrated terminals (`harness diff` + critique actions).
- Detached gateway sessions keep long-running work alive through reconnects.
- Rolling storage lifecycle policy keeps event/telemetry data bounded during long-lived sessions.
- Mux event-store maintenance runs in a managed background daemon with progress updates so cleanup does not block UI navigation.
- Gateway storage lifecycle policy updates from `harness.config.jsonc` apply without restarting the server.
- Deterministic visual-contract fixtures and viewport/input matrix e2e checks keep UI look-and-feel stable release-to-release.
- Command palette can open a GitHub thread entry in the left rail for the active project, then show full tracked-branch PR/review details in the main panel.
- Open the active project directly in local tools (`iTerm2`, `Ghostty`, `Zed`, `Cursor`, `VSCode`, `Warp`, `Finder`) or copy its path from the palette.
- Command-click links inside conversation terminal output: URLs open in browser, file-like paths open in your configured editor/open-in command.

## Demo

![Harness multi-thread recording](assets/harness.gif)

## Quick start

Prerequisites:

- Bun `1.3.9+`
- At least one agent CLI (`codex`, `claude`, `cursor`, or `critique`)

Install and run:

```bash
# Bootstrap install
curl -fsSL https://raw.githubusercontent.com/jmoyers/harness/main/install.sh | bash

# Or run directly (no global install)
bunx @jmoyers/harness@latest

# Or install globally
bun add -g --trust @jmoyers/harness
harness
```

Use a named session when you want isolated state:

```bash
harness --session my-session
```

Named sessions automatically fall back to an available gateway port when the preferred port is already occupied. For deterministic restart/load diagnostics, you can still set an explicit non-default gateway port.

Standalone diff viewer (phase 1):

```bash
harness diff --help
```

## Architecture (VTE path)

```mermaid
flowchart LR
    U[Keyboard + Command Palette] --> UI[Harness TUI]
    UI --> CP[Control Plane Stream API]
    CP --> TM[Thread Manager]
    TM --> AG[Agent Threads<br/>Codex / Claude / Cursor]
    TM --> PTY[Integrated PTY Terminals]
    PTY --> VTE[VTE Parser + Screen Model]
    VTE --> R[Terminal Renderer]
    TM --> DF[harness diff + Critique]
    DF --> R
```
