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
- Control-plane TCP stream baseline (`src/control-plane/*`) with typed command/event envelopes.
- Control-plane auth handshake (`auth` / `auth.ok` / `auth.error`) with optional shared-token enforcement.
- Control-plane session discovery/state commands: `session.list`, `session.status`, `session.snapshot`.
- Control-plane attention and steering wrappers: `attention.list`, `session.respond`, `session.interrupt`.
- Exited session lifecycle now uses tombstones with TTL cleanup plus explicit `session.remove`.
- `session.list` now supports deterministic ordering and scope/status/live filters (`attention-first`, started asc/desc, tenant/user/workspace/worktree filters).
- Control-plane output fanout now enforces per-connection backpressure limits (bounded buffering).
- Mux control path now runs through the same stream API primitives (`pty.start/attach/input/resize/signal/close`) used for programmatic clients.
- Mux control-plane attach/start wiring is extracted into reusable `src/control-plane/codex-session-stream.ts` so local/remote transport is swappable.
- Stream isolation: PTY bytes never mixed with structured event output.
- Deterministic terminal snapshot oracle (`rows`, `cols`, `activeScreen`, `cursor`, `lines`, `frameHash`).
- Scroll-region/origin correctness for pinned UI areas (`DECSTBM`, `DECOM`, `IND`/`NEL`/`RI`, `IL`/`DL`).
- OSC terminal color query replies (`OSC 10/11`) for better Codex visual parity.
- Parity scene matrix for codex/vim/core profiles (`npm run terminal:parity`).
- First-party split mux now uses dirty-row repaint (no full-screen redraw loop).
- Mux render scheduling is event-driven (`setImmediate` on dirty) instead of fixed-interval polling.
- Right pane supports independent scrollback (`live`/`scroll`) with mouse wheel routing.
- Left pane scrollback now works with Codex-style pinned footer scroll regions.
- Mux cursor rendering is VTE-driven (style + visibility + position), including DECSCUSR style parity.
- Mux renderer tolerates transient frame/resize mismatches without crashing.
- Fatal mux errors now force terminal state restore (raw mode off, cursor visible, input modes disabled).
- Mux resize handling is coalesced/throttled for UI repaint and debounced for PTY resize to reduce resize-induced input lag and startup squish (`HARNESS_MUX_RESIZE_MIN_INTERVAL_MS`, default `33`; `HARNESS_MUX_PTY_RESIZE_SETTLE_MS`, default `75`).
- Mux supports first-party in-pane selection with visual highlight via plain drag in the left pane.
- Mux tracks and mirrors bracketed paste mode (`DECSET/DECRST ?2004`) from the VTE model to host terminal mode.
- Mux probes host terminal OSC `10/11` colors to better match local theme brightness.
- Mux enables CSI-u keyboard mode (`CSI > 1 u`) so modified keys like `Shift+Enter` can be forwarded.
- Mux wheel routing now scrolls by single-row steps to better match native terminal feel.
- Mux consumes focus-in/out events and reasserts input modes after focus return.
- Mux now supports multiple concurrent conversations in one session: conversation rail + active-session switching (`Ctrl+N`/`Ctrl+P`) + new conversation (`Ctrl+T`) with attach/detach continuity.
- Right rail now uses a first-party low-level UI surface with styled rows/badges/active selection highlight (`src/ui/surface.ts`), not a framework renderer.
- Mux recording now supports one-step capture to GIF (`--record-output <path.gif>`) with optional JSONL sidecar.
- Recording capture uses canonical full-frame snapshots (not incremental repaint diffs) to prevent interleaved/partial-frame artifacts.
- Recording timing is wall-clock based from monotonic capture start/finish and quantized with drift compensation for GIF frame delays.
- Recording color mapping now ingests host terminal OSC palette replies (`OSC 10/11` + `OSC 4;0..15`) for better Ghostty parity.
- Recording file paths are resolved from the command invocation directory (`INIT_CWD` when launched via `npm run`), not the repo root.
- GIF export toolchain remains available (`scripts/terminal-recording-gif-lib.ts`, `scripts/terminal-recording-to-gif.ts`) for offline conversion.
- Optional mux debug trace: set `HARNESS_MUX_DEBUG_PATH=/tmp/harness-mux-debug.jsonl` to capture input/routing/render cursor records.
- Mux core is now deterministic and directly tested (`test/mux-dual-pane-core.test.ts`).
- Footer background persistence parity scene added for Codex-like pinned input/status rows.
- Strict verification gate: lint + typecheck + deadcode + 100% unit/integration/e2e coverage.

## Try It
- `npm run verify`
- `npm run vim:passthrough`
- `npm run benchmark:latency`
- `npm run codex:live -- <codex-args>`
- `npm run codex:live:mux -- <codex-args>`
- `npm run codex:live:mux:record -- <codex-args>`
- `npm run codex:live:mux:record:jsonl -- <codex-args>`
- `npm run codex:live:mux:launch -- <codex-args>`
- `npm run terminal:recording:gif -- --input .harness/mux-recording.jsonl --output .harness/mux-recording.gif`
- `npm run control-plane:daemon -- --host 127.0.0.1 --port 7777`
- `HARNESS_CONTROL_PLANE_AUTH_TOKEN=secret npm run control-plane:daemon -- --host 127.0.0.1 --port 7777`
- `npm run codex:live:mux:client -- <codex-args>`
- `npm run codex:live:tail -- --conversation-id <id> [--from-now] [--only-notify] [--include-text-deltas]`
- `npm run codex:live:snapshot -- --conversation-id <id> [--follow] [--from-now] [--json]`
- `npm run terminal:parity [-- --json]`
- `npm run loc [-- --json]`

## Human Breakpoints
- Mux paint correctness:
  - embedded mode: run `npm run codex:live:mux --`
  - one-command client/server mode: `npm run codex:live:mux:launch -- <codex-args>`
    - in this mode, `Ctrl+C` cleanly exits mux + daemon together
  - client/server mode:
    - terminal 1: `npm run control-plane:daemon -- --host 127.0.0.1 --port 7777`
    - terminal 2: `HARNESS_CONTROL_PLANE_AUTH_TOKEN=secret npm run codex:live:mux:client -- --harness-server-token secret <codex-args>`
  - confirm left pane remains interactive while right pane updates event feed
  - scroll wheel in left pane should switch status from `pty=live` to `pty=scroll(...)`
  - confirm right pane scroll wheel enters `events=scroll(...)` mode in status and does not type into Codex
  - scroll back to bottom and confirm status returns to `pty=live` and `events=live`
  - drag in left pane to select; selection shrinks/expands with drag movement, and click-without-drag clears
  - use `Cmd+C`/`Ctrl+C` to copy the current selection (OSC52)
  - hold `Alt` while using mouse in left pane to pass mouse events through to the app
  - use `Ctrl+T` to create a new conversation, `Ctrl+N` / `Ctrl+P` to switch active conversation from the rail
  - mux shortcuts are global and remain captured even when terminal keyboard protocols (`CSI u`, `modifyOtherKeys`) are active
  - conversation rail order is stable (creation order); switching only changes selection, not row order
  - by default, `Ctrl+C` terminates all live mux conversations and exits the mux process (`HARNESS_MUX_CTRL_C_EXITS=0` disables this)
  - recording workflow:
    - run `npm run codex:live:mux -- --record-output .harness/mux-recording.gif`
    - reproduce a session, then exit mux to finalize export
    - verify the GIF header is valid and dimensions match expected terminal cell geometry
    - optional raw capture: `npm run codex:live:mux -- --record-path .harness/mux-recording.jsonl`
- Footer/background parity:
  - run `npm run terminal:parity`
  - verify `codex-footer-background-persistence` passes

## Core Docs
- `design.md`: architecture, principles, milestones, and verified system behavior.
- `agents.md`: execution laws and quality rules for humans and agents working in this repo.

## License
- `MIT` (`LICENSE`)
