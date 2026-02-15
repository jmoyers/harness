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
- Persist directory/conversation metadata across reconnects via the control-plane SQLite state store.
- Persist adapter state required for provider-native thread continuity (Codex resume path).
- Keep startup focused on the selected conversation by default; persisted non-selected conversations are not auto-resumed unless explicitly enabled.
- Show a directory-scoped left rail with conversation status, git summary, and per-session telemetry.
- Normalize actionable session states for operators (`working`, `needs action`, `idle`, `complete`, `exited`).
- Support keyboard and mouse-driven conversation selection in the mux.
- Archive or permanently delete conversations through the same control-plane API used by UI and agents.
- Keep one protocol path for both human UI and API clients through the control-plane stream.
- Prioritize interactive control actions over background warm-start work so switching and selection stay responsive under multi-session load.
- Keep PTY/event subscriptions scoped to the active conversation and reattach with cursor continuity to avoid replay storms on conversation switches.
- Keep expensive left-rail probes (git/process telemetry) opt-in (`HARNESS_MUX_BACKGROUND_PROBES=1`) so output/render/input stay responsive by default.
- Expose stream subscriptions with scoped replay for automation clients monitoring live session state/output.
- Record terminal frames and export deterministic GIF artifacts.
- Measure startup repeatably with loop tooling (`perf:codex:startup:loop`) and mux `perf-core` timeline reports (`perf:mux:startup`).
- Compare direct Codex startup versus `codex:live:mux:launch` through first output, first paint, and settled (`mux.startup.active-settled`) with one `perf-core` stream (`perf:mux:launch:startup:loop`).
- Render a visual startup timeline report (`perf:mux:startup`) that includes launch/daemon/mux/client/server negotiation checkpoints and terminal-query handled/unhandled cataloging.
- Run a deterministic no-Codex startup paint probe through the same mux client/server path (`mux:fixture:launch`) to isolate harness rendering/protocol overhead.
- Run a standalone mux hot-path micro-harness (`perf:mux:hotpath`) that isolates VTE parse, snapshot/hash, row render/diff, protocol roundtrip, and input-delay behavior without Codex or the control-plane daemon.
- Capture terminal startup-query handling (`codex.terminal-query`) to identify unanswered protocol probes.
- Codex startup loop supports readiness pattern timing (`--ready-pattern "Tip: ..."`) in addition to first output/paint.

## Performance Loop

Use the standalone hot-path harness to reproduce latency/FPS pressure with deterministic synthetic output and no daemon/PTY/Codex startup noise:

```bash
npm run perf:mux:hotpath -- --duration-ms 6000 --output-hz 140 --bytes-per-chunk 320 --sessions 2 --parse-passes 2 --profile mixed
```

Run the built-in diagnostic matrix to A/B the main suspects from `PERF-DIAGNOSTIC.md`:

```bash
npm run perf:mux:hotpath -- --matrix --duration-ms 4000
```

Key toggles:
- `--parse-passes`: simulate single/double/triple `TerminalSnapshotOracle` ingest cost.
- `--protocol-roundtrip`: include base64+JSON encode/decode overhead per output chunk.
- `--snapshot-hash`: include per-render full-frame hash work (disabled by default to match mux hot-path optimization).
- `--recording-snapshot-pass`: include an extra snapshot/hash pass to model recording overhead.
- `--fixture-file <path>`: replay deterministic bytes from a local file instead of synthetic chunks.
- `harness.config.jsonc` -> `debug.mux.serverSnapshotModelEnabled`: controls whether the server-side live-session snapshot model ingests PTY output (`true` default). Keep this in config, not env, when profiling server/client duplicate-parse cost.

## Technical Strategy

- First-party latency-critical path: PTY host, terminal model, renderer, mux input routing.
- Strict typed TypeScript + Rust PTY sidecar where it matters.
- Stream protocol as the primary interface for control and observability.
- SQLite append-only events store for persistent, tenanted state.
- One config system (`harness.config.jsonc`), one logger, one perf instrumentation surface.
- Debug/perf knobs live in `harness.config.jsonc` (`debug.*`) with overwrite-on-start artifact control.
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
