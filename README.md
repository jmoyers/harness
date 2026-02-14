# harness

```text
██╗  ██╗ █████╗ ██████╗ ███╗   ██╗███████╗███████╗███████╗
██║  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██╔════╝██╔════╝
███████║███████║██████╔╝██╔██╗ ██║█████╗  ███████╗███████╗
██╔══██║██╔══██║██╔══██╗██║╚██╗██║██╔══╝  ╚════██║╚════██║
██║  ██║██║  ██║██║  ██║██║ ╚████║███████╗███████║███████║
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝╚══════╝

terminal-first control for many live coding agents
```

Harness is a high-performance TUI control plane for running and steering multiple coding agents with terminal parity.

## Demo

![Harness multi-conversation recording](assets/poem-recording.gif)

This recording shows three separate Codex sessions running in parallel, with live switching between conversations while each session continues working. The GIF is generated from Harness frame-buffer recording, not screen capture.

## Current Capabilities

- Host real agent CLIs inside first-party PTY sessions with live human steering.
- Run multiple conversations concurrently and switch active control instantly.
- Show a directory-scoped left rail with conversation status, git summary, and per-session telemetry.
- Normalize actionable session states for operators (`working`, `needs action`, `idle`, `complete`, `exited`).
- Support keyboard and mouse-driven conversation selection in the mux.
- Keep one protocol path for both human UI and API clients through the control-plane stream.
- Record terminal frames and export deterministic GIF artifacts.

## Technical Strategy

- First-party latency-critical path: PTY host, terminal model, renderer, mux input routing.
- Strict typed TypeScript + Rust PTY sidecar where it matters.
- Stream protocol as the primary interface for control and observability.
- SQLite append-only events store for persistent, tenanted state.
- One config system (`harness.config.jsonc`), one logger, one perf instrumentation surface.
- Verification gates are mandatory: lint, typecheck, dead-code checks, and full coverage.

## Spirit

- Human-first operation with full pass-through terminal feel.
- Agent parity by design: anything a human can do should be scriptable through the same control plane.
- Minimal, functional, beautiful interfaces over heavyweight desktop UI stacks.
- Reproducible behavior over vibes: measurable latency, deterministic rendering, explicit state.

## Core Docs

- `design.md` for architecture and system principles.
- `agents.md` for execution laws and quality rules.

## License

MIT (`LICENSE`)
