# harness

Terminal-first multi-agent harness focused on low-latency human control, with agent/API parity over the same control plane.

## Core Documents
- `design.md`: living architecture and principles.
- `agents.md`: living execution and quality laws.

## Current Verified Baseline
- PTY passthrough with vim-grade parity checks.
- Single-session attach/detach/reconnect broker.
- Latency benchmark gate with p50/p95/p99 overhead checks.
- Codex live-session checkpoint: PTY-hosted `codex` with notify-hook event ingestion and persisted normalized stream output.

## Priority Direction
- Primary: self-hosted live-steered Codex PTY session.
- Secondary: programmatic steering parity over the same stream API.
- Enrichment: notify event channels layered on top, never replacing live session authority.

## Commands
- `npm run verify`
- `npm run vim:passthrough`
- `npm run benchmark:latency`
- `npm run codex:live -- <codex-args>`
- `npm run codex:live:mux -- <codex-args>` (first-party split: live session + event feed)
- `npm run codex:live:tail -- --conversation-id <id> [--from-now] [--only-notify] [--include-text-deltas]`
- `npm run codex:live:snapshot -- --conversation-id <id> [--follow] [--from-now] [--json]`
- `npm run codex:live:dual -- <codex-args>` (tmux split: live session + tail)

Debug:
- `HARNESS_TMUX_DEBUG=1 npm run codex:live:dual -- <codex-args>`
- `HARNESS_TMUX_CAPTURE_DIR=.harness/tmux-capture npm run codex:live:dual -- <codex-args>`

## License
- `UNLICENSE`
