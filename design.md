# Agent Harness Design

## Purpose
Build a high-performance, terminal-first harness that manages many concurrent AI coding agent conversations across multiple directories/worktrees, with:

- Full terminal passthrough compatibility.
- Reliable “needs attention” signaling.
- Fast switching between projects, branches, and conversations.
- Minimal, model-agnostic core that works with Codex first, then Claude Code and others.
- High-fidelity event instrumentation with provider-like granularity and separate orchestration/meta events.

## Product Goals
- Support 5-6+ simultaneous active branches/conversations with low UI overhead.
- Model conversations per directory/worktree and make switching constant-time.
- Expose three primary actions per conversation:
  - manage conversation
  - view git diff
  - open file/project in editor
- Allow pause/resume/new conversation and long-running thread continuity.
- Keep architecture client/server so remote/web clients are optional and supported by design.
- Guarantee human/API parity: anything a human can do in the harness must be available through a documented API for agentic automation.
- Enforce strict control of latency-critical paths: no third-party dependencies in the input-to-render hot path.
- Enforce one shared logger abstraction across all subsystems, with replay-grade structured logs.
- Enforce one shared performance instrumentation abstraction across all subsystems, with trace-grade structured output.
- Enforce one shared configuration file and abstraction across all subsystems.

## Non-Goals (v1)
- Rebuilding a full IDE.
- Deep inline code editing UI in the harness.
- Agent-specific bespoke UX beyond adapter capabilities.

## Landscape and Prior Art
- `agent-of-empires`: tmux-based multi-agent orchestration and dashboarding pattern.
- `coder/mux`: performant workspace/session abstraction and server/client split.
- `vibetunnel`: remote terminal proxy and notification-style activity routing.
- Claude Code hooks: explicit lifecycle/tool notification model.
- Codex notify surfaces: notification hooks that can enrich a live PTY session.

## Core Architecture

```txt
[Human TUI] [Automation Agent Client] [Optional Web Client]
      \              |                    /
       \             |                   /
        +--- [Control Plane Stream API (TCP/WS)] ---+
                       |
                       v
                 [Harness Daemon]
                  - Command Router
                  - Session Registry
                 - Agent Adapter Manager
                 - Event Bus (normalized)
                  - Log Core (`log-core`)
                  - Perf Core (`perf-core`)
                  - Config Core (`config-core`)
                  - Git Service (diff/worktree/branch)
                  - Notification Service (sound/OS)
                  - SQLite Event/State Store
                  - PTY Manager (attach/detach)
                     |                 |
                     |                 +--> [pty-host sessions for raw passthrough]
                     |
                     +--> [Codex Live Adapter -> pty-hosted codex CLI]
                     |      +--> [Codex Notify Tap (raw + classified lifecycle hints)]
                     +--> [Claude Adapter -> hooks + CLI]
                     +--> [Generic Adapter -> PTY parser fallback]
```

## Hierarchical Data Model

```txt
Tenant
  -> User
    -> Workspace (repo root)
      -> Worktree (branch checkout)
        -> Conversation (agent thread/session)
          -> Turn (one user request cycle)
            -> Events (lifecycle + attention + diff + output)
```

## Adapter Abstraction

```ts
export interface AgentAdapter {
  id: "codex" | "claude" | "generic";
  capabilities: {
    structuredEvents: boolean;
    diffStreaming: boolean;
    resumableThreads: boolean;
    approvalCallbacks: boolean;
    rawPtyAttach: boolean;
  };
  startConversation(input: StartConversationInput): Promise<ConversationRef>;
  resumeConversation(ref: ConversationRef): Promise<void>;
  sendTurn(ref: ConversationRef, message: string): Promise<void>;
  interrupt(ref: ConversationRef): Promise<void>;
  attachPty(ref: ConversationRef): Promise<PtyHandle>;
  onEvent(cb: (event: NormalizedEvent) => void): Unsubscribe;
}
```

## Human/API Parity and Strict Separation

Design rule:
- No client (including TUI) can call adapters or persistence directly.
- All reads and mutations flow through the same Control Plane Stream API.
- The TUI is an API client, not a privileged path.

Consequence:
- Programmatic clients can monitor progress, inspect changes over time, interrupt, queue, steer, fork, resume, and archive conversations exactly as a human can.
- Every action is represented as an auditable command with a corresponding event trail.

Control-plane boundaries:
- Clients issue commands.
- Daemon validates and executes commands.
- Daemon emits normalized events and state snapshots.
- Clients render state and subscribe to events.

This separation prevents UI-only behavior and enables reliable automation without computer-use tooling.

## Control Plane Stream Surface

Required command categories:
- Workspace/worktree: create, list, select, archive.
- Conversation lifecycle: create, fork, resume, interrupt, archive, delete, rename.
- Turn control: send user turn, steer active turn, cancel/interrupt active turn.
- Queueing: enqueue turn, reorder queue, pause queue, resume queue, drop queued turn.
- Approval/input: approve/decline command or file changes, answer tool input requests.
- Diff/history: fetch current turn diff, fetch conversation diff timeline, fetch event timeline.
- Terminal/session: attach PTY, detach PTY, list active sessions.
- Configuration: read effective config, validate proposed config, reload config.

Pass-through control primitives (required, first-class):
- `pty.start`: start a session by executable + args + cwd + env + profile.
- `pty.attach`: attach a client stream to an existing PTY session.
- `pty.input`: send raw input bytes/chunks to PTY (`stdin`) with ordering guarantees.
- `pty.resize`: send terminal size updates (`cols`, `rows`).
- `pty.signal`: send control signals (`interrupt`, `eof`, `terminate`) through the PTY control path.
- `pty.detach`: detach client without killing session.
- `pty.close`: close session intentionally.
- `pty.subscribe-events`: subscribe to normalized/provider/meta events for the same session.

Required read/stream categories:
- Conversation and turn status snapshots.
- Attention queue and pending approvals.
- Streaming normalized event feed for all subscribed conversations/workspaces.
- Time-ordered change history (diff snapshots and significant lifecycle transitions).
- Streaming provider-fidelity event feed for all subscribed conversations/workspaces.
- Streaming orchestration/meta event feed for queueing, scheduling, and handoff behavior.
- Query access to structured logs by workspace/worktree/conversation/turn/time range.
- Query access to performance traces/latency measurements by component and time range.

Pass-through stream invariants:
- PTY byte stream is authoritative session reality and is never rewritten by adapters.
- Provider/meta events are side-channel observability, never in-band PTY output.
- Human and agent clients use the exact same PTY and event commands; no privileged human path.
- High-level helper commands (for example `conversation.send-turn`) are optional wrappers that compile to the same PTY primitives.
- Session replay/reattach uses persisted PTY/output + event cursor state; no synthetic state not derivable from authoritative streams.

## Mux Interaction Rules

- Escape is forwarded to the active PTY session; mux does not reserve it as a quit key.
- `ctrl+c` handling is two-stage: first press forwards interrupt to the active PTY, second press within the interrupt window requests mux shutdown.
- Conversation "delete" in the mux is soft-delete (archive); hard delete remains an explicit control-plane command.
- Directory lifecycle in the mux is first-class: `directory.upsert`, `directory.list`, and `directory.archive` drive add/close behavior through the same control-plane stream API as automation clients.
- The left rail includes clickable action rows (new conversation, archive conversation, add directory, close directory) with keybind parity.
- The pane separator is draggable; divider moves recompute layout and PTY resize through the normal mux resize path.

## Control Plane Transport Principles

- Stream-first interface: long-lived full-duplex connection is primary (`tcp` or `ws` transport profile).
- Commands, progress, events, and terminal/session signals flow over the same stream envelope.
- Each command includes stable correlation and idempotency fields (`command_id`, `trace_id`, `seq`, `idempotency_key`).
- Server emits explicit lifecycle envelopes per command:
  - `command.accepted`
  - `command.progress` (0..n)
  - `command.completed` or `command.failed`
- Support backpressure and bounded queues so slow consumers do not stall hot paths.
- Support heartbeat/keepalive plus reconnect with cursor/resume token for stream continuity.
- Request/response wrappers are optional convenience layers over the stream protocol, not the primary control path.

## Event Normalization

Adapters publish two coordinated event classes:

1. Provider-fidelity events:
  - Preserve native semantics, ordering, and payload shape at fine granularity.
  - Track details similar to model-provider streams (deltas, tool lifecycle, reasoning, approvals, compaction, turn lifecycle).
  - Designed for instrumentation and debugging accuracy, not forced semantic flattening.

2. Canonical/meta events:
  - Canonical lifecycle events for common harness behavior.
  - Additional orchestration events for multi-conversation scheduling, attention, and control-plane state.

Canonical lifecycle events:

- `thread.started`
- `turn.started`
- `turn.completed`
- `turn.failed`
- `turn.interrupted`
- `diff.updated`
- `attention.required` (approval, user input, stalled prompt)
- `output.delta` (agent text/tool/terminal output)
- `conversation.archived`

Provider-fidelity event families (examples):
- `provider.text.delta`
- `provider.reasoning.delta`
- `provider.tool.call.started`
- `provider.tool.call.delta`
- `provider.tool.call.completed`
- `provider.context.compaction.started`
- `provider.context.compaction.completed`
- `provider.turn.completed`

Meta/orchestration event families (examples):
- `meta.queue.updated`
- `meta.attention.raised`
- `meta.attention.cleared`
- `meta.scheduler.assignment.changed`
- `meta.conversation.handoff`

The daemon computes derived status from both classes without dropping provider-level detail.

## Event Fidelity Rules

- Do not force a cross-model behavioral abstraction that erases provider-native semantics.
- Keep provider-built-in tools (for example native web search) as explicit tool events, not generic text output.
- Keep context compaction as explicit lifecycle events, not hidden implementation details.
- Preserve raw provider payload references for traceability and replay.
- Provide stable event envelopes with schema versioning so clients can process streams safely.

## Status Model and Attention Routing

Primary statuses:
- `idle`
- `running`
- `needs_input`
- `completed`
- `failed`
- `interrupted`

State machine:

```txt
IDLE
  -> RUNNING_TURN
  -> NEEDS_INPUT (approval/tool/user input)
  -> RUNNING_TURN
  -> COMPLETED | FAILED | INTERRUPTED
```

Notification policy:
- Trigger sound/desktop notifications on transitions to `needs_input`, `completed`, or `failed`.
- Optionally focus/switch to target tab/session.
- De-duplicate repeated alerts for same turn.

Status routing invariants:
- Status is scoped to `(tenant_id, user_id, workspace_id, worktree_id, conversation_id)` and must never be inferred from shared process-level artifacts.
- Adapter enrichment channels (for example notify hooks) must use per-session isolation (unique sink/file/socket) to prevent cross-conversation status contamination.
- UI status badges must be driven from conversation-scoped events/state only; no global fallback that can mark sibling conversations as `completed`.

## Codex Live-Steering Integration (v1)

Use a PTY-hosted interactive `codex` session as the primary integration path. Human live steering is the first principle.

Layer optional enrichment channels on top of the same live session:
- `codex notify`-style hook/event surfaces for attention and lifecycle hints.

This ordering ensures terminal reality is authoritative while still allowing high-fidelity instrumentation.

Primary live-session capabilities:
- launch/attach/detach/re-attach a running `codex` terminal session with no privileged bypass
- human steering in-session (`prompt`, interrupt, continue, context edits) with PTY parity
- event stream derived from live session + notify hook emissions
- pseudo-screenshot capture from PTY-derived output for integration/e2e assertions (text-rendered terminal snapshot, machine-readable output option)
- raw notify discovery stream (`meta-notify-observed`) to inventory provider notify types in real sessions

Notify hook payload shape validated locally:
- Codex invokes notify command with a JSON payload argument (for example `agent-turn-complete` including `thread-id`, `turn-id`, `cwd`, and message fields).

## Model-Agnostic Strategy

Integration tiers:

1. Live PTY adapter (primary): human-steerable terminal session with attach/detach and low-latency control.
2. Hook/notify enrichment: provider-native notification channels for attention and lifecycle hints.
3. Heuristic parser fallback: parse terminal output only when no richer signal exists.

This keeps live steering universal across agents while still taking advantage of structured provider signals when available.

Provider policy (Codex/Claude direct usage):
- Prefer launching provider CLIs directly inside PTY (`codex`, `claude`) with no protocol translation in the hot path.
- Adapter responsibilities are limited to launch config, optional hook ingestion, and event normalization.
- If a provider offers richer APIs, they are optional enrichment channels and must not replace PTY-first steering for parity-critical flows.

## Terminal Compatibility Strategy

- Sequence starts with one terminal session only and optimizes it for direct-terminal parity before any multi-session features.
- Default to PTY-backed sessions for universal pass-through.
- Layer structured control/event channels when adapter supports them.
- Preserve attach/detach behavior so users can jump into any live conversation terminal instantly.
- First-party terminal multiplexer UI is the active split-view path.
- Never mix event/log output into the managed PTY byte stream. Event views are separate consumers of persisted/streamed data.

## VTE Correctness Program (Codex + Vim)

Correctness target:
- Harness terminal behavior must be indistinguishable from a direct terminal for Codex and Vim workflows.
- Correctness is defined as byte-accurate control handling plus equivalent visible terminal state and key semantics.

Hot-path architecture (first-party):

```txt
[stdin bytes]
   -> [input normalizer]
   -> [pty write]
   -> [pty read bytes]
   -> [vt parser state machine]
   -> [terminal action stream]
   -> [terminal state model]
   -> [renderer diff]
   -> [screen flush]
```

Out-of-band paths:
- Event stream, logs, and instrumentation do not write into PTY session output.
- Parsed terminal actions can be mirrored to telemetry/events without mutating PTY bytes.

Protocol scope required for Codex and Vim parity:
- C0/C1 controls, ESC, CSI, OSC, DCS, ST/BEL terminators.
- DEC private modes used by terminal TUIs:
  - alternate screen and cursor save/restore (`?1047`, `?1048`, `?1049`)
  - mouse and focus tracking (`?1000`, `?1002`, `?1003`, `?1004`, `?1006`)
  - bracketed paste (`?2004`)
- Keyboard negotiation flows:
  - modifyOtherKeys and CSI-u negotiation/enable paths
  - kitty keyboard protocol progressive enhancement when present
- OSC handling needed by modern CLIs:
  - title/icon updates (`OSC 0/1/2`)
  - cwd hints (`OSC 7`)
  - hyperlinks (`OSC 8`)
  - dynamic color query/set (`OSC 10/11/12` and palette query/set families)
- UTF-8 correctness with grapheme-aware cell accounting and configurable width policy.

Terminal reply engine requirements:
- Support query/response sequences required by Codex and Vim startup/runtime probes.
- Minimum required replies include device/keyboard/color query paths observed in live sessions.
- Unknown queries are logged as typed events (`terminal-query-unknown`) and safely ignored or passthrough-configured by policy.

Capability profile model:
- Each session advertises a deterministic terminal capability profile (`terminalProfile`), e.g. `xterm-256color-harness-v1`.
- Profile governs enabled input protocols, reply behavior, and feature toggles.
- Profile changes are versioned and replayable for deterministic bug reproduction.

Required artifacts (code + tests, not separate authority docs):
- `vte-action-schema`: typed action/event model emitted by parser.
- `vte-state-model`: canonical in-memory screen/cursor/mode model with alt-screen and scrollback semantics.
- `vte-reply-engine`: deterministic query handler for DA/DSR/OSC/keyboard negotiation paths.
- `vte-corpus`:
  - captured Codex transcripts (raw PTY bytes + expected state checkpoints)
  - captured Vim transcripts (editing, split windows, mouse, paste, resize)
  - targeted sequence fixtures for high-risk controls/modes
- `snapshot-oracle`:
  - textual pseudo-screenshot API (stable machine-readable and human-readable forms)
  - canonical frame hash for deterministic equality in integration/e2e gates
- `compat-matrix`:
  - per-sequence support status: `implemented`, `passthrough`, `unsupported`
  - explicit owner test for every `implemented` entry.

Control Plane terminal API requirements:
- `terminal.attach`: stream raw rendered frames + cursor/mode metadata.
- `terminal.input`: send exact input bytes.
- `terminal.resize`: apply rows/cols resize.
- `terminal.signal`: interrupt, suspend, resume.
- `terminal.snapshot.get`: return current pseudo-screenshot frame (text and JSON forms).
- `terminal.capabilities.get`: return active `terminalProfile` and negotiated feature flags.
- `terminal.stream.events`: optional structured stream of parsed terminal actions (out-of-band from PTY display).

Pseudo-screenshot contract:
- Frame payload includes at minimum:
  - `rows`, `cols`
  - `cursor` position/style/visibility
  - `active_screen` (`primary` or `alternate`)
  - `lines[]` (cell text + optional attributes)
  - `frame_hash`
- Snapshot API is mandatory for integration/e2e and replaces manual screenshot-only debugging.

Verification ladder:
1. Parser/action unit gates:
   - full transition coverage across parser states and byte classes
   - fixtures for CSI/OSC/DCS edge cases, malformed and interrupted sequences
2. State-model integration gates:
   - replay corpus bytes, assert terminal state and snapshot hashes at checkpoints
   - assert reply-engine responses for known query probes
3. App-level conformance gates:
   - scripted Vim flows (insert/normal mode edits, splits, mouse, paste, resize)
   - scripted Codex flows (startup, turns, notify-linked cycles, interrupt/continue)
4. External compatibility gates:
   - vttest-driven checks for supported VT100/VT220/xterm behaviors in scope
5. Differential gates:
   - run identical workloads in direct terminal and harness, compare checkpointed snapshots
6. Performance gates:
   - preserve parity latency budgets (p50/p95/p99) while conformance tests run
   - verify no additional PTY output bytes are introduced by event/log plumbing

Failure policy:
- Any mismatch in snapshot hash, unsupported required sequence, or reply drift blocks milestone completion.
- Unknown sequence growth is tracked and triaged; it cannot be silently dropped.

## Git and Editor Integration

Per conversation:
- Track associated workspace/worktree/branch metadata.
- Use Git as the authoritative source of diff truth.
- Surface live diff summary from:
  - git queries (`git diff`, `git diff --name-only`, optional `git diff <remote>`) as canonical
  - adapter-native diff events (for preview/latency hints) when available

Open actions:
- Open repository root in editor.
- Open specific changed file.
- Open workspace/worktree in terminal attach mode.

## Persistence

Use one tenanted SQLite database for local durability and fast indexing.

Core tables:
- `tenants`
- `users`
- `tenant_memberships`
- `workspaces`
- `worktrees`
- `conversations`
- `turns`
- `events` (append-only canonical state history)
- `attention_queue`
- `notifications_sent`

Design constraints:
- No separate external event journal or projection service.
- The `events` table and query-oriented state tables live in the same SQLite store.
- Each command writes append-only events and state-table updates in one transaction.
- Rebuildable state from the `events` table.
- Crash-safe resume of all active sessions.
- Every row is tenant-scoped; user-scoped rows include `user_id`.
- All queries, streams, and mutations enforce tenant/user boundaries.

## Logging Architecture

- Single logger abstraction only (`log-core`) used by every subsystem and process.
- Single canonical structured file (JSONL) as the source of truth for diagnostics, replay, and performance tracing.
- One sibling pretty log file is derived from the exact same structured entries for human readability.
- No direct ad-hoc logging calls outside `log-core`.
- Log records must include stable correlation fields at minimum:
  - `ts`
  - `level`
  - `workspace_id`
  - `worktree_id`
  - `conversation_id`
  - `turn_id`
  - `event_id`
  - `source` (provider/meta/system)
  - `message`
  - `payload_ref` (when payload is externalized)
- Logging must be detailed enough to replay and reproduce behavior across turns and scheduling decisions.

## Performance Instrumentation Architecture

- Single instrumentation abstraction only (`perf-core`) used by every subsystem and process.
- `perf-core` writes structured performance events to the same canonical structured file used by `log-core`.
- Trace model must support flamegraph-style analysis:
  - `trace_id`
  - `span_id`
  - `parent_span_id`
  - `name`
  - `start_ns`
  - `duration_ns`
  - `attrs` (component, operation, ids)
- Key choke points are permanently instrumented, including:
  - keystroke round-trip latency (`stdin -> scheduler -> PTY -> render`)
  - PTY read/write buffering and flush timing
  - scheduler queue wait/run timing
  - renderer diff/flush timing
  - control-plane command handling latency
- Performance work must support an isolated hot-path harness mode that does not require provider startup or control-plane boot.
  - The harness must drive deterministic synthetic/replayed terminal output through the same terminal-model and render/diff code paths.
  - The harness must independently toggle protocol encode/decode overhead, parse-pass multiplicity, and recording-style snapshot passes to attribute cost by layer.
  - The harness must report render cadence, event-loop delay, and input-delay probes in the same run so throughput and interactivity regressions can be compared directly.
- Parse-pass budget is explicit and measured.
  - Duplicate terminal-model ingest passes across server/client/recording paths are treated as first-order latency risks and must be benchmarked with the harness matrix.
  - Hot-path rendering defaults to snapshot-without-hash; full-frame hash computation is opt-in diagnostic work, not the default frame path.
- Global runtime boolean controls instrumentation emission (enabled/disabled) without removing instrumentation calls from code.
- Disabled mode must be near-no-op: no formatting, no dynamic allocation, and no file write on disabled path.

## Configuration Architecture

- Single canonical config file: `harness.config.jsonc`.
- JSON-with-comments format (JSONC) is required to allow inline documentation and annotation.
- Single configuration abstraction only (`config-core`) used by every subsystem and process.
- No competing runtime config sources for core behavior (no shadow config files, no duplicate per-module configs).
- Runtime behavior toggles are config-first; environment variables are reserved for bootstrap/transport wiring and test harness injection, not the primary control surface.
- Config lifecycle:
  - parse -> validate -> publish immutable runtime snapshot
  - on reload, replace snapshot atomically
  - on invalid config, keep last known good snapshot and emit error events/logs
- Config values affecting hot paths must be read from in-memory snapshot, never reparsed on critical operations.

## Client Surfaces

### TUI (v1)
- Current verified implementation:
  - left rail: directories -> conversations -> process telemetry -> git stats
  - right pane: active live steerable PTY session
  - left-rail conversation activation via keyboard and mouse click with deterministic row hit-testing
  - normalized action-oriented conversation status labels (`needs action`, `working`, `idle`, `complete`, `exited`)
  - keybindings loaded from `harness.config.jsonc` using VS Code-style action IDs and parseable key strings
- Next target layout iterations:
  - first-class directory/worktree actions in rail (`add/select/archive`) via control-plane commands
  - explicit background-process rows beyond conversation-host process telemetry
  - rail interactions for focus/switch without breaking PTY pass-through invariants
- Global shortcuts:
  - switch workspace/worktree/conversation
  - attach terminal
  - send message
  - steer active turn
  - queue turn
  - interrupt
  - open file/project

Target layout sketch:

```txt
┌───────────────────────────────┬──────────────────────────────────────────────────────┐
│  📁 Directories               │                                                      │
│  › harness (main)             │  Active Conversation PTY                             │
│    api (feature/auth)         │  (Codex / Claude Code / shell / vim passthrough)    │
│                               │                                                      │
│  💬 Conversations             │                                                      │
│  ● fix-mux-scroll     RUN     │                                                      │
│  ○ docs-refresh       DONE    │                                                      │
│  ○ parity-vim         NEEDS   │                                                      │
│                               │                                                      │
│  ⚙ Processes                 │                                                      │
│  ● test-watch   3.1% 120MB    │                                                      │
│  ○ dev-server   0.4%  82MB    │                                                      │
│                               │                                                      │
│  ⎇ git: feature/mux-left-rail │                                                      │
│  Δ +12 ~3 -4  | 2 files       │                                                      │
└───────────────────────────────┴──────────────────────────────────────────────────────┘
```

Left-rail rendering/style principles:
- Visual hierarchy from typography and spacing first; color is secondary reinforcement.
- Stable row order by default; selection changes highlight only.
- Status indicators are short, icon-assisted, and action-oriented (`needs action`, `working`, `idle`, `complete`, `exited`).
- Status text is normalized for operator action semantics rather than provider-specific phrasing.
- Git and process stats remain visible at all times to reduce context switches.

### Optional Remote/Web Client
- Connect to daemon over authenticated stream transport (WebSocket profile by default).
- Subscribe to normalized events and status snapshots.
- Reuse same server-side adapter and state model.

### Automation Agent Client
- Connect over the same authenticated stream protocol as TUI and web clients.
- Use command envelopes for all actions a human can perform.
- Subscribe to event streams for monitoring, intervention, and orchestration logic.

## Language and Runtime Choice

### Recommendation: TypeScript first
- Fastest development path.
- Strong familiarity.
- Native fit with Node built-in process, stream, and net primitives.
- Works with generated Codex TS bindings and supports strict hot-path boundary enforcement.

### Optimization path
- Keep adapter/event boundaries stable.
- Move PTY-heavy or scheduling-critical components to Rust/Go sidecar only if profiling requires it.

## Dependency Policy (Latency-Critical Control)

Policy:
- Third-party dependencies are allowed only outside latency-critical paths.
- The input hot path (`stdin -> parser -> scheduler -> PTY write`) and output hot path (`PTY read -> diff/render prep -> screen flush`) must be implemented in-repo.
- External libraries are acceptable for non-interactive concerns (storage, tests, networking helpers, tooling), provided they do not sit on hot-path execution.

Scope note:
- This is an initial performance-governed policy.
- Any dependency used in or near hot paths requires explicit latency measurement and approval.

Architecture impact:
- Draw explicit boundaries around hot-path modules and enforce them with import rules.
- Keep PTY, multiplexer, scheduler, and terminal renderer as first-party modules.
- Keep non-hot-path capabilities modular so best-in-class libraries can be used without affecting interaction latency.

## Build In-House (From Scratch)

Subsystems that remain first-party for quality and latency control:

- PTY process integration:
  - Build: `pty-host`
  - Reason: direct control over buffering, backpressure, and write coalescing on the input/output hot path.

- Terminal multiplexer/session scheduler:
  - Build: `mux-core`
  - Reason: deterministic scheduling, queue/steer/interrupt semantics, and low-overhead session switching.

- Terminal UI:
  - Build: `tui-core`
  - Reason: control raw input handling, render diffing, and flush behavior; avoid high-level frameworks with measurable lag.

- Hot-path observability and benchmarking:
  - Build: `perf-core`
  - Reason: provide trace/flamegraph-capable instrumentation and latency budgets with a permanent no-op disable path.

- Agent orchestration core:
  - Build: `control-core`
  - Reason: guarantee parity semantics for human/API operations (queue, steer, interrupt, approvals) with auditable eventing.

## Use External Libraries (Intentionally)

Subsystems where mature dependencies are acceptable because they are outside direct interaction hot paths:

- SQLite access and migrations:
  - Use: `better-sqlite3` or `sqlite3` plus simple migration tooling.
  - Rationale: avoid rebuilding storage engines/bindings.

- Testing framework and assertions:
  - Use: `node:test`, `jest`, or `vitest`.
  - Rationale: avoid rebuilding test runners and assertion ecosystems.

- Networking and protocol helpers:
  - Use: runtime primitives and/or focused libraries (for example WebSocket utilities).
  - Rationale: reliability and protocol correctness outside terminal hot-path rendering/input loops.

- CLI parsing and config ergonomics:
  - Use: `yargs`/`commander` and config parsing libraries.
  - Rationale: not latency sensitive; faster iteration and fewer parser edge-case bugs.

- Validation and serialization helpers:
  - Use: `zod`/`ajv` or similar.
  - Rationale: safer API boundaries with lower maintenance burden.

- Logging and diagnostics:
  - Use: a mature backend behind `log-core` (for example `pino`), never directly from feature code.
  - Rationale: keep one logging contract while using reliable non-hot-path plumbing.

## Verifiable Outputs

Output 0: Dependency Boundary Baseline
- Dependency policy is enforced: hot paths are first-party; non-hot-path libraries are allowed.
- Demonstration:
  - define and publish module boundary map for hot-path vs non-hot-path code
  - automated import guard prevents external dependencies inside hot-path modules
  - smoke test validates daemon/TUI startup with selected external libs enabled
  - latency benchmark confirms hot-path budgets remain intact with non-hot-path dependencies present

Output 1: Single-Session Terminal Pass-Through Parity
- One harness-managed terminal session behaves like direct terminal usage with no perceptible added latency.
- Demonstration:
  - enforce PTY stream isolation (no event/log byte interleaving in terminal output)
  - publish and verify Codex+Vim sequence compatibility matrix and query/reply matrix
  - verify pseudo-screenshot API returns deterministic frames/hashes for replay checkpoints
  - benchmark direct terminal vs harness-managed terminal using identical command/input workloads
  - collect end-to-end input-to-echo timing for both paths
  - compute harness overhead (`harness_latency - direct_latency`) across p50/p95/p99
  - pass criteria:
    - p50 overhead <= 1 ms
    - p95 overhead <= 3 ms
    - p99 overhead <= 5 ms
  - run blind A/B typing test where operator cannot reliably distinguish harness session from direct terminal

Output 2: Daemon Core
- Includes session registry, adapter manager, normalized event bus, and SQLite persistence.
- Demonstration:
  - start daemon
  - create tenant/user/workspace/worktree records
  - persist and replay synthetic normalized events
  - rebuild in-memory status from SQLite `events` table after restart

Output 3: Codex Live-Steering Session + Event Stream
- Uses a PTY-hosted interactive `codex` session as the control source of truth.
- Demonstration:
  - launch and attach to one live `codex` session from the harness
  - steer the session directly as a human (message, interrupt, continue)
  - observe normalized stream events emitted from live session activity
  - verify event persistence and replay for the steered session

Output 4: Codex Notify Discovery + Classification
- Adds provider-native notification surfaces on top of the same live session.
- Demonstration:
  - persist raw `codex notify` payloads as `meta-notify-observed` events
  - produce notify-type inventory directly from captured sessions
  - wire known notify types into attention/lifecycle event mapping
  - correlate notify signals with terminal and normalized event stream ids
  - verify unknown notify types are preserved losslessly as raw discovery events

Output 5: Programmatic Steering on Live Session
- Uses the same control-plane commands as human steering against the same live session.
- Demonstration:
  - issue steering commands over stream API (`send-input`, interrupt, queue-next)
  - verify resulting PTY state and event trail match equivalent human actions
  - verify agent can monitor progress and steer without computer-use emulation

Output 6: Multi-Conversation Control in TUI
- Lists workspaces, worktrees, and active conversations with live status badges.
- Demonstration:
  - run 6 concurrent Codex conversations
  - switch active view among them
  - attach/detach terminal pass-through for any conversation
  - queue and steer a turn in a selected conversation
  - interrupt and resume selected conversation

Output 7: Attention and Notification Loop
- Notification service emits deterministic alerts from state transitions.
- Demonstration:
  - trigger `needs_input`, `completed`, and `failed` states
  - verify one notification per transition (deduped)
  - verify attention queue ordering and clear-on-action behavior

Output 8: Diff + Open Actions
- Every conversation exposes file/project open actions and a diff summary.
- Demonstration:
  - verify Git-derived diff is canonical
  - use adapter diff updates only as optional preview hints
  - open selected file and repo root from harness action handlers

Output 9: Model-Agnostic Fallback Path
- Generic PTY adapter supports arbitrary terminal agents.
- Demonstration:
  - launch non-Codex terminal app via PTY adapter
  - retain attach/detach and manual attention controls
  - keep conversation indexed under workspace/worktree model

Output 10: Optional Remote Client Contract
- Authenticated event subscription and status snapshot API from daemon.
- Demonstration:
  - connect second client process
  - receive live normalized events
  - issue stream commands and receive accepted/progress/completed envelopes
  - reconnect using resume token/cursor and continue event consumption without duplication
  - render same conversation status as TUI for a shared session

Output 11: Human/API Parity Contract
- No operation is available exclusively through TUI internals.
- Demonstration:
  - execute a parity test matrix where each human action is invoked via API:
    - monitor progress stream
    - inspect diff/change history over time
    - interrupt running turn
    - queue and reorder pending turns
    - steer active turn
    - resume/fork/archive conversation
  - verify resulting state/events match equivalent TUI-triggered actions

Output 12: Event Fidelity + Meta-Orchestration Contract
- Harness exposes provider-fidelity events and separate orchestration/meta events without collapsing either stream.
- Demonstration:
  - subscribe to provider-fidelity stream and verify ordered delta/tool/compaction events for a tool-heavy turn
  - subscribe to meta stream and verify queue/attention/scheduler updates for the same conversation
  - correlate both streams by workspace/worktree/conversation/turn ids
  - verify no event loss across compaction boundaries

Output 13: Replay-Grade Logging Contract
- Structured and pretty logs are emitted from one shared logger abstraction and support reproducible replay.
- Demonstration:
  - verify all modules log through `log-core` only
  - verify canonical structured log file and sibling pretty log file are both generated from same entries
  - replay a captured session from structured logs and reproduce turn/order/decision flow
  - verify correlation ids link commands, events, queue transitions, approvals, and terminal interactions

Output 14: Global Instrumentation Contract
- One shared instrumentation abstraction (`perf-core`) is used everywhere and writes trace-grade events to the canonical structured file.
- Demonstration:
  - verify all modules emit performance events only through `perf-core`
  - verify traces can be transformed into flamegraph/span timeline views
  - verify keystroke round-trip latency is captured with trace correlation to scheduler/PTY/render spans
  - verify disabling instrumentation via single boolean yields near-no-op behavior with no code removal

Output 15: Single Config Contract
- One config file (`harness.config.jsonc`) and one shared abstraction (`config-core`) govern runtime behavior.
- Demonstration:
  - verify no subsystem reads config outside `config-core`
  - verify JSONC parsing and schema validation behavior
  - verify atomic reload updates runtime snapshot without process restart
  - verify invalid config rollback to last known good snapshot with explicit log/event emission

## Milestones

Milestone 1: Transparent PTY Self-Hosting (Vim-grade)
- Goal: self-host a single terminal session with behavior parity to direct terminal use, including complex TUI apps such as `vim`.
- Exit criteria:
  - alternate screen, cursor modes, resize, mouse, paste, and color behavior match direct terminal behavior
  - keystroke-to-echo overhead meets defined latency thresholds (p50 <= 1 ms, p95 <= 3 ms, p99 <= 5 ms)
  - blind A/B usage test does not reliably distinguish harness terminal from direct terminal

Milestone 1 execution plan:
- Step 1: PTY substrate (`pty-host`) with raw attach/detach.
  - Deliverable: spawn shell in managed PTY, pass stdin/stdout/stderr transparently, handle resize.
  - Verification: deterministic PTY integration tests for echo, resize propagation, and session lifecycle.
- Step 2: VTE parser/action/state core.
  - Deliverable: first-party parser state machine + terminal state model + renderer diff path.
  - Verification: parser transition coverage and state replay tests across targeted sequence fixtures.
- Step 3: Terminal reply engine + capability profile.
  - Deliverable: deterministic query/reply behavior for Codex and Vim required probes.
  - Verification: query/reply conformance tests and unknown-query telemetry coverage.
- Step 4: Snapshot oracle and deterministic replay.
  - Deliverable: `terminal.snapshot.get` with text/JSON frame output and frame hashing.
  - Verification: integration/e2e tests assert frame hashes on Codex and Vim scripted checkpoints.
- Step 4a: Parity scene matrix (Codex first, Vim next).
  - Deliverable: machine-readable parity scene contract and runner producing pass/fail + frame hashes for codex/vim/core profiles.
  - Verification: `terminal:parity` gate passes in CI and emits deterministic scene-level results for regression triage.
- Step 5: Single-session harness path.
  - Deliverable: one session managed end-to-end by daemon + stream client with attach/detach and reconnect.
  - Verification: e2e test that restarts client while preserving live PTY session continuity and snapshot parity.
- Step 6: Latency instrumentation and budgets.
  - Deliverable: `perf-core` spans for `stdin -> scheduler -> PTY -> render` with per-keystroke timing.
  - Verification: benchmark harness comparing direct terminal vs managed session; enforce p50/p95/p99 thresholds.
- Step 7: Human indistinguishability gate.
  - Deliverable: repeatable blind A/B protocol and result capture.
  - Verification: documented test runs showing operators cannot reliably distinguish harness from direct terminal.
- Step 8: Hardening and regression gate.
  - Deliverable: CI suite for protocol correctness + latency regression + reconnect stability.
  - Verification: Milestone 1 marked complete only when all gates pass and results are committed.

### Milestone 1 Active Backlog (Detailed)

Terminal correctness backlog (Codex/Vim parity critical):
- Pending-wrap semantics at right margin (`DECAWM` behavior):
  - status: in progress
  - expected output: line-ending behavior matches direct terminal when glyph lands in last column and next glyph arrives.
  - verification: parity scene + snapshot tests for plain and SGR-interleaved writes at the right margin.
- Tab stops (`HT`, default every 8 cols, `HTS`, `TBC`):
  - status: in progress
  - expected output: shell prompts and Codex tab-aligned UI fields render correctly.
  - verification: parity scene + snapshot tests for default stops, set/clear current stop, and clear-all stops.
- Insert/delete character controls (`CSI @`, `CSI P`):
  - status: in progress
  - expected output: inline-edit TUIs preserve row content shifts without line corruption.
  - verification: snapshot tests and parity scene coverage for insert/delete char edits.

Mux/runtime backlog (post-correctness, latency-focused):
- Full-screen redraw elimination in mux:
  - status: in progress
  - expected output: dirty-row/region repaint path replaces 33ms full-frame loop.
  - verification: perf traces demonstrate reduced render work and lower keystroke-to-paint variance under heavy output.

Pane interaction backlog (human/operator UX):
- Pane-aware mouse routing:
  - status: in progress
  - expected output: mouse wheel/click is routed to pane under pointer.
  - verification: integration tests for pane hit-testing and scroll routing.
- Per-pane scrollback navigation:
  - status: in progress
  - expected output: each pane can scroll backward independently with pinned/live mode transitions.
  - verification: snapshot-oracle-backed integration tests asserting per-pane viewport state.
- Selection/copy in pane:
  - status: planned
  - expected output: select text in a pane and copy without breaking live steering mode.
  - verification: deterministic selection model tests + e2e clipboard command assertions on macOS.

Vim expansion backlog (after above foundations):
- Extended Vim protocol support set:
  - status: planned
  - expected output: higher-fidelity behavior for split windows, mouse interactions, and inline edits.
  - verification: expanded vttest/Vim scripted corpus with parity matrix checkpoints.

Milestone 2: Codex Live-Steering Session (Human-First)
- Goal: self-host an interactive `codex` session inside the harness where human steering is first-class and event streaming is continuous.
- Exit criteria:
  - one live Codex session can be launched, attached, detached, and reattached with state continuity
  - human steering actions (message, interrupt, continue) flow through PTY with no privileged bypass
  - normalized event stream is emitted and persisted from live session activity
  - `codex notify`-style signals are ingested when available and mapped into attention/lifecycle events

Milestone 3: Programmatic Steering Parity on the Same Live Session
- Goal: expose the same live steering operations to agents/API clients without creating a separate control path.
- Exit criteria:
  - stream API can invoke the same steering operations used by the human client
  - command/event parity matrix passes for message, interrupt, queue, and steer operations
  - no divergence between human-driven and API-driven outcomes for the same conversation

Milestone 4: Multi-Conversation Model (Directories > Conversations)
- Goal: support multiple directories with multiple conversations per directory, with deterministic switching and control.
- Exit criteria:
  - stable mapping among tenant/user/workspace/worktree/conversation/turn
  - queue, steer, interrupt, resume, and diff actions function per conversation without cross-talk
  - concurrent activity preserves correct status, diff, and attention routing

Milestone 5: Remote Local-Gateway Access
- Goal: connect to the harness daemon remotely through an authenticated local gateway.
- Exit criteria:
  - authenticated login/session establishment is required and enforced
  - remote clients receive the same authoritative state snapshots and event streams as local clients
  - remote clients can execute control commands over the same stream protocol with lifecycle envelopes
  - gateway path does not violate hot-path latency guarantees for local interaction

Milestone 6: Agent Operator Parity (Wake, Query, Interact)
- Goal: allow an automation agent to control live sessions with the same operational capabilities as a human client.
- Exit criteria:
  - agent can wake, query, and interact with conversations through the Control Plane Stream API
  - parity matrix passes for monitor, diff-history query, queue, reorder, steer, interrupt, resume, fork, and archive actions
  - all agent actions are auditable through command/event correlation

## Risks and Mitigations

- Hot-path custom implementations can drift in quality if not continuously benchmarked.
  - Mitigation: enforce latency benchmarks and import-boundary checks in CI.
- API churn in experimental protocols.
  - Mitigation: adapter isolation + versioned capability checks.
- Incomplete structured events for some providers.
  - Mitigation: fallback PTY adapter + manual controls.
- Notification spam in high-parallel runs.
  - Mitigation: rate limiting + dedupe + per-conversation silence controls.
- State divergence after crashes.
  - Mitigation: append-only `events` table, transactional state updates, and startup reconciliation.
- Log volume and retention can degrade storage/performance.
  - Mitigation: configurable retention/rotation and payload externalization with references.
- Instrumentation overhead can distort measured latency if poorly implemented.
  - Mitigation: enforce disabled-mode near-no-op checks and compare enabled vs disabled benchmark baselines.
- Single-file config corruption can impact startup/reload.
  - Mitigation: strict validation, last-known-good fallback, and startup diagnostics.

## Initial Success Criteria

- Strict TypeScript + lint gates pass with zero warnings/errors.
- Dependency boundary policy is enforced: no third-party imports in declared hot-path modules.
- Single-session terminal pass-through meets direct-terminal parity thresholds (p50 <= 1 ms, p95 <= 3 ms, p99 <= 5 ms overhead) and passes blind A/B perception test.
- Live-steered Codex session operates via PTY as primary control path, with continuous event emission.
- Provider-fidelity and meta event streams are both available, correlated by ids, and lossless across tool-heavy/compaction turns.
- Replay-grade logging is operational: one canonical structured log + one sibling pretty log, both emitted via `log-core`.
- Replay-grade instrumentation is operational: `perf-core` spans are present in the canonical structured file and support flamegraph-style analysis.
- Instrumentation disabled mode is validated as near-no-op in benchmark runs.
- Tenant boundaries are enforced across reads/writes/streams in the shared SQLite store.
- Single config contract is operational: `harness.config.jsonc` is the sole runtime config source through `config-core`.
- 6 concurrent Codex conversations across multiple worktrees remain responsive.
- Accurate `needs_input` and `completed` notifications without polling the screen.
- Conversation switching under 100ms in TUI.
- Diff view is available for every active turn (adapter-native or git fallback).
- Session recovery after daemon restart without losing thread mappings.

## Implemented Baseline (Verified)

- Native PTY sidecar is Rust-based (`native/ptyd`) with typed TypeScript host integration (`src/pty/pty_host.ts`).
- Milestone 1 parity checks now include:
  - interactive `vim` self-hosting e2e
  - terminal control-sequence pass-through test coverage (alternate screen, cursor, bracketed paste, mouse mode, color sequences)
- Single-session attach/detach/reconnect baseline is implemented via `src/pty/session-broker.ts` with cursor-based replay for reattached clients.
- Latency benchmark gate is implemented and runnable via `npm run benchmark:latency`, reporting direct-framed vs harness overhead at p50/p95/p99 with configurable thresholds.
- Canonical event envelope in `src/events/normalized-events.ts`.
- Transactional append-only SQLite `events` persistence in `src/store/event-store.ts` (tenant/user scoped reads).
- Milestone 2 live-steered checkpoint is implemented:
  - `src/codex/live-session.ts` hosts a PTY-backed live Codex session with attach/detach, steering writes/resizes, and event emission.
  - Live session now includes terminal query reply support for `OSC 10/11` and indexed palette `OSC 4` probes (0..15) to improve visual parity with direct terminal runs.
  - Live session now emits `perf-core` query-observation events (`codex.terminal-query`) for CSI/OSC/DCS startup-query attribution (handled vs unhandled).
  - `src/terminal/snapshot-oracle.ts` provides deterministic pseudo-snapshots (`rows`, `cols`, `activeScreen`, `cursor`, `lines`, `frameHash`) from live PTY output, including DEC scroll-region/origin handling required for pinned-footer UIs.
  - Supported terminal semantics now include `DECSTBM` (`CSI t;b r`), `DECOM` (`CSI ? 6 h/l`), `IND`/`NEL`/`RI`, and region-scoped `IL`/`DL` behavior.
  - `src/terminal/parity-suite.ts` defines codex/vim/core parity scenes and a deterministic matrix runner with scene-level failures and frame-hash output.
  - `scripts/codex-notify-relay.ts` captures Codex notify hook payloads into a local JSONL stream.
  - `scripts/codex-live.ts` provides a direct live entrypoint (`npm run codex:live -- ...`) with persisted normalized events, including raw `meta-notify-observed`.
  - `scripts/codex-live.ts` enforces terminal stream isolation: PTY output remains on stdout while events persist to SQLite (no event JSON mixed into terminal output).
  - `scripts/codex-live-tail.ts` tails persisted live events by conversation in real time, including notify-discovery mode (`--only-notify`).
  - `scripts/codex-live-snapshot.ts` renders PTY deltas into textual snapshot frames for deterministic integration/e2e assertions (`--json`).
  - `src/control-plane/stream-protocol.ts` defines typed newline-delimited TCP stream envelopes for command lifecycle, PTY pass-through signals, and async event delivery.
    - protocol now includes `auth`, `auth.ok`, `auth.error` envelopes and session query commands (`session.list`, `session.status`, `session.snapshot`).
    - `session.list` now supports deterministic sort (`attention-first`, `started-desc`, `started-asc`) and scope/status/live filters for multi-conversation clients.
    - protocol now includes persisted directory/conversation operations (`directory.upsert`, `directory.list`, `conversation.create`, `conversation.list`, `conversation.archive`, `conversation.delete`) and scoped live subscriptions (`stream.subscribe`, `stream.unsubscribe`, `stream.event`).
  - `src/control-plane/stream-server.ts` provides a session-aware control-plane server that executes PTY/session operations and broadcasts output/events to subscribed clients.
    - optional shared-token auth is enforced before non-auth commands when configured.
    - per-connection output buffering is bounded; slow consumers are disconnected once buffered output exceeds configured limits.
    - session runtime status tracking is exposed through `session.status` (`running`, `needs-input`, `completed`, `exited`) with attention reason and last-exit details.
    - session summaries now include PTY `processId` for per-session telemetry in operator clients.
    - exited sessions are tombstoned with TTL-based cleanup to avoid unbounded daemon memory growth while preserving short-lived post-exit status/snapshot queries.
    - control-plane wrappers now include `attention.list`, `session.respond`, `session.interrupt`, and `session.remove` to provide parity-safe steering and explicit tombstone cleanup.
    - stream subscriptions support scope filters (`tenant/user/workspace/directory/conversation`), optional output inclusion, and cursor replay backed by an in-memory bounded journal.
    - session runtime changes and directory/conversation mutations are persisted in `src/store/control-plane-store.ts` (tenanted SQLite state store) and published through the same stream.
    - conversation persistence now includes adapter-scoped state (`adapter_state_json`) so provider-native resume identifiers can survive daemon/client restarts.
    - per-session adapter state is updated from scoped provider events and reused on next launch, enabling conversation continuity (for Codex: `codex resume <session-id>`).
  - `src/control-plane/stream-client.ts` provides a typed client used by operators and automation to issue the same control-plane operations.
    - command ids are UUID-based and auth handshake is supported in `connectControlPlaneStreamClient`.
    - remote connect now supports bounded retry windows (`connectRetryWindowMs` + `connectRetryDelayMs`) to tolerate control-plane cold starts without requiring client-side sleep loops.
    - startup/operation attribution is captured via `perf-core` command RTT + connect-attempt events (`control-plane.command.rtt`, `control-plane.connect.*`) so mux startup command latency is directly measurable.
    - client/server role attribution is explicit in control-plane traces (`role: client|server`) with connection/auth lifecycle events (`control-plane.server.connection.*`, `control-plane.server.auth.*`) for negotiation-stage diagnosis.
  - `src/control-plane/codex-session-stream.ts` extracts mux/session control-plane wiring into reusable infrastructure (embedded or remote transport).
  - `scripts/control-plane-daemon.ts` provides a standalone control-plane process (`npm run control-plane:daemon`) for split client/server operation.
    - non-loopback bind now requires an auth token (`--auth-token` or `HARNESS_CONTROL_PLANE_AUTH_TOKEN`).
    - daemon state persistence path is configurable (`--state-db-path` / `HARNESS_CONTROL_PLANE_DB_PATH`).
  - `scripts/control-plane-daemon-fixture.ts` provides a deterministic fixture daemon path that runs a local command (default `/bin/sh`) instead of Codex, for startup paint/protocol isolation.
  - `scripts/codex-live-mux-launch.ts` provides a one-command launcher (`npm run codex:live:mux:launch -- ...`) that boots a dedicated daemon and connects the remote mux client for client/server parity without manual multi-terminal setup.
    - launcher mode sets local-exit policy so `Ctrl+C` cleanly tears down both mux client and daemon.
    - launcher now overlaps daemon and mux process startup; remote connect retries bridge daemon readiness instead of serially blocking mux spawn.
    - launcher/daemon/mux startup milestones now emit through `perf-core` only (single JSONL instrumentation stream, no side-channel startup tracer).
  - `scripts/mux-fixture-launch.ts` provides a one-command fixture launch (`npm run mux:fixture:launch`) that boots fixture daemon + mux client with isolated sqlite paths and controlled startup content for render-settle verification without Codex dependency.
  - `scripts/codex-live-mux.ts` provides the first-party split UI (left: workspace rail, right: live steerable Codex session rendered via shared snapshot oracle) with:
    - control operations routed over the control-plane stream (`pty.start`, `pty.attach`, `pty.input`, `pty.resize`, `pty.signal`, `pty.close`) instead of direct in-process session calls
    - remote-server mode via `--harness-server-host` and `--harness-server-port` for exact two-pane behavior against an external daemon
    - dirty-row diff rendering (no full-screen repaint loop)
    - event-driven render scheduling on dirty state (no fixed 60fps polling timer)
    - SGR mouse wheel routing for right-pane scrollback without leaking events into the live Codex PTY stream
    - VTE-driven cursor parity (position, visibility, and DECSCUSR shape/blink style)
    - VTE-driven bracketed paste mode parity (`?2004`) mirrored to host terminal mode
    - first-party gesture-based in-pane selection with visual highlight and keyboard-triggered copy, with modifier-based passthrough for app mouse input
    - multi-conversation rail + active session switching (`Ctrl+N`/`Ctrl+P`) + new conversation creation (`Ctrl+T`) while preserving live PTY pass-through for the active session
    - left rail composition uses directory-wrapped conversation blocks with inline git summary and per-conversation telemetry (CPU/memory sampled from `ps` via `processId`)
    - git summary and process-usage sampling run asynchronously in background tasks (`mux.background.git-summary`, `mux.background.process-usage`) and are disabled by default (`HARNESS_MUX_BACKGROUND_PROBES=1` to enable) so startup/render/input hot paths are not contended by probe subprocesses
    - control-plane operations are scheduled with interactive-first priority, and persisted non-active conversation warm-start is opt-in (`HARNESS_MUX_BACKGROUND_RESUME=1`) so startup and interactivity are not taxed by non-selected sessions
    - terminal-output persistence is buffered and flushed in batches (`mux.events.flush`) so per-chunk SQLite writes do not execute directly in the PTY output hot path
    - active-session attach now resumes from the last observed PTY cursor and inactive-session event subscriptions are removed on detach, preventing full-history replay and non-selected event churn
    - first-party styled rail rendering built from low-level terminal UI primitives rather than framework-driven VDOM
    - per-conversation notify sink isolation to keep status routing correct when multiple sessions run concurrently
    - optional terminal-frame recording to JSONL (`--record-path`, `--record-fps`) sourced from canonical full-frame mux snapshots (not incremental repaint diffs) for replay/debug artifact generation
    - one-step recording + export path (`--record-output <path.gif>`) writes JSONL sidecar + GIF at mux shutdown
    - startup performance spans/events for startup and conversation launch (`mux.startup.*`, `mux.conversation.start`) through `perf-core`
    - explicit startup checkpoints for active-session process startup, first PTY output, first visible paint, header-visible gate, and settled quiet-period (`mux.startup.active-start-command`, `mux.startup.active-first-output`, `mux.startup.active-first-visible-paint`, `mux.startup.active-header-visible`, `mux.startup.active-settle-gate`, `mux.startup.active-settled`)
    - runtime output-load checkpoints (`mux.output-load.sample`) attribute active vs inactive output pressure, render cost, and event-loop lag to diagnose interactivity starvation
    - background resume checkpointing now records explicit begin/skip events (`mux.startup.background-start.begin` / `mux.startup.background-start.skipped`) for startup tradeoff diagnosis
    - archive/delete controls wired through the same control-plane path used by human and automation clients
  - recording timestamps are monotonic relative wall-clock samples with footer close-time; GIF frame delays are quantized with drift compensation to preserve elapsed timing semantics.
  - `scripts/terminal-recording-gif-lib.ts` + `scripts/terminal-recording-to-gif.ts` provide offline recording-to-GIF export, enabling visual regression artifacts from mux render captures.
  - `scripts/perf-mux-startup-report.ts` provides a deterministic visual startup timeline report over captured `perf-core` JSONL traces, including launch/daemon/mux/client/server negotiation checkpoints and startup terminal-query handled/unhandled cataloging.
  - `scripts/perf-codex-startup-loop.ts` provides repeatable startup-loop measurement (first output, first visible paint, settled) using the same PTY/VTE model path.
  - `scripts/perf-mux-launch-startup-loop.ts` provides repeatable direct-vs-launch startup comparison and waits through `mux.startup.active-settled`, using only `perf-core` milestones from launch/daemon/mux.
  - startup-loop tooling supports optional readiness-pattern timing for provider-specific UI readiness (for example Codex tip banner visibility).
  - runtime debug/perf behavior is config-governed in `harness.config.jsonc` under `debug.*`, with overwrite-on-start artifact control for deterministic runs.
  - `src/mux/dual-pane-core.ts` is the typed mux core for layout, SGR mouse parsing/routing, and row-diff rendering.
  - `src/mux/conversation-rail.ts` provides deterministic conversation ordering and rail rendering primitives for multi-session mux navigation.
  - `src/mux/workspace-rail-model.ts` separates left-rail data/view modeling from terminal rendering so future UI technologies can reuse the same model pipeline.
  - `src/mux/workspace-rail.ts` provides left-rail rendering for directory-scoped conversation stacks with inline git + process telemetry and compact unicode/emoji scanning cues.
  - `src/ui/surface.ts` provides reusable immediate-mode terminal UI primitives (cell surface, row fill, text draw, ANSI row render) to compose panes, selectors, and future modal/splitter widgets.
  - `test/mux-dual-pane-core.test.ts` deterministically verifies mux layout, mouse routing, viewport follow/pin transitions, and row-diff behavior.
  - terminal parity now includes footer background persistence checks via `codex-footer-background-persistence`.
  - `scripts/terminal-parity.ts` exposes the parity matrix gate (`npm run terminal:parity`).

## Sources
- https://openai.com/index/unlocking-codex-in-your-agent-harness/
- https://docs.anthropic.com/en/docs/claude-code/hooks
- https://github.com/ThePrimeagen/agent-of-empires
- https://github.com/coder/mux
- https://github.com/amacneil/vibetunnel
- https://ecma-international.org/publications-and-standards/standards/ecma-48/
- https://www.invisible-island.net/xterm/ctlseqs/ctlseqs.html
- https://www.invisible-island.net/vttest/
- https://vimhelp.org/term.txt.html
- https://neo.vimhelp.org/term.txt.html
- https://sw.kovidgoyal.net/kitty/keyboard-protocol/
- https://unicode.org/reports/tr11/
- https://unicode.org/reports/tr29/
- https://github.com/microsoft/node-pty
- https://github.com/creack/pty
- https://github.com/wezterm/wezterm/tree/main/pty
