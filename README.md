# harness

A terminal-first control plane for many live coding agents.

The goal is simple: keep the speed and feel of a real terminal, but add the operator-grade controls that current agent UIs are missing.

## Why This Exists
- Most agent desktop apps degrade quickly with 5-6 active branches/conversations.
- Human steering gets slow when context switching, checking diffs, and handling attention prompts.
- We want one system where human-led and agent-led control use the exact same machinery.

## What This Project Is
- A first-party PTY + terminal stack optimized for low-latency interaction.
- A Codex-first harness that can be steered live by a human and observed programmatically.
- A foundation for multi-project, multi-conversation operation with strict tenant/user boundaries.

## Verified Progress
- Rust PTY sidecar + typed TypeScript host integration.
- Single-session attach/detach/reconnect broker.
- PTY passthrough verified with `vim` interaction tests.
- Codex live session hosted through PTY with notify-hook ingestion.
- Stream isolation: PTY bytes never mixed with structured event output.
- Deterministic terminal snapshot oracle (`rows`, `cols`, `activeScreen`, `cursor`, `lines`, `frameHash`).
- Scroll-region/origin correctness for pinned UI areas (`DECSTBM`, `DECOM`, `IND`/`NEL`/`RI`, `IL`/`DL`).
- OSC terminal color query replies (`OSC 10/11`) for better Codex visual parity.
- Parity scene matrix for codex/vim/core profiles (`npm run terminal:parity`).
- Strict verification gate: lint + typecheck + deadcode + 100% unit/integration/e2e coverage.

## Try It
- `npm run verify`
- `npm run vim:passthrough`
- `npm run benchmark:latency`
- `npm run codex:live -- <codex-args>`
- `npm run codex:live:mux -- <codex-args>`
- `npm run codex:live:tail -- --conversation-id <id> [--from-now] [--only-notify] [--include-text-deltas]`
- `npm run codex:live:snapshot -- --conversation-id <id> [--follow] [--from-now] [--json]`
- `npm run terminal:parity [-- --json]`

## Core Docs
- `design.md`: architecture, principles, milestones, and verified system behavior.
- `agents.md`: execution laws and quality rules for humans and agents working in this repo.

## License
- `UNLICENSE`
