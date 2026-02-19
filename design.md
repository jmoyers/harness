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
- Codex OpenTelemetry + history surfaces: structured lifecycle, tool, and thread continuity signals.

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
                     |      +--> [Codex OTel + history ingestion (status + thread-id hints)]
                     +--> [Claude Adapter -> hooks + CLI]
                     +--> [Cursor Adapter -> managed hooks + CLI]
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
  id: 'codex' | 'claude' | 'cursor' | 'generic';
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
- Parity is continuously enforced by automated tests:
  - `test/control-plane-api-parity.test.ts` asserts parser registry and stream-server dispatch stay in exact command lockstep.
  - `test/control-plane-api-parity.test.ts` also asserts every mux-issued command is represented by high-level agent API helpers.

Control-plane boundaries:

- Clients issue commands.
- Daemon validates and executes commands.
- Daemon emits normalized events and state snapshots.
- Clients render state and subscribe to events.

## Runtime Module Boundaries

The runtime follows a responsibility-first split:

- `src/domain/*` owns mutable business state and lifecycle transitions (conversations, repositories, tasks, directories, workspace state).
- `src/services/*` owns orchestration and IO-facing flows (control-plane calls, startup/hydration, persistence, runtime sequencing).
- `src/ui/*` owns rendering, modal/input routing, and pane-level interaction reducers.
- `scripts/codex-live-mux-runtime.ts` is composition and wiring only; behavior should be pushed into domain/service/ui modules.

Ownership rules:

- Domain managers expose explicit methods/projections; runtime code should not mutate raw maps directly.
- Service modules return validated records/domain data, not untyped payloads.
- UI modules consume domain/service interfaces and should not own persistence or control-plane mutation logic.
- New splits should be by responsibility seams (domain vs service vs ui), not by arbitrary code boundaries.

This boundary model keeps behavior equivalent while making the system testable, replaceable, and automation-safe.

## First-Party AI Library Package

Harness ships a first-party AI package at `packages/harness-ai` to keep latency-sensitive model orchestration and provider bugfixes under direct control.

Current scope:

- Anthropic-first provider surface (`createAnthropic`, provider tool helpers).
- Stream-first generation primitives (`streamText`, `generateText`, `streamObject`).
- Vercel-style event envelopes and UI message SSE serialization (`x-vercel-ai-ui-message-stream: v1`).
- Streaming tool lifecycle support:
  - tool input start/delta/end
  - tool call emission
  - local tool execution + streamed tool results/errors
  - provider-executed tool result mapping (including Anthropic web search/web fetch tool results)

Design intent:

- Keep the package dependency-minimal and first-party for hot-path reliability.
- Preserve event-shape parity where practical while allowing focused, controlled divergence when provider behavior requires it.
- Validate behavior through Bun unit, integration, and end-to-end tests under 100% coverage gates.

## Control Plane Stream Surface

Required command categories:

- Workspace/worktree: create, list, select, archive.
- Conversation lifecycle: create, fork, resume, interrupt, archive, delete, rename.
- Turn control: send user turn, steer active turn, cancel/interrupt active turn.
- Queueing: enqueue turn, reorder queue, pause queue, resume queue, drop queued turn.
- Task orchestration:
  - task lifecycle (`task.create`, `task.list`, `task.update`, `task.delete`, `task.claim`, `task.reorder`)
  - scheduler pull (`task.pull`) with readiness gating
  - project policy/settings (`project.status`, `project.settings-get`, `project.settings-update`)
  - automation policy (`automation.policy-get`, `automation.policy-set`) at `global`, `repository`, and `project` scopes
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

## Task Orchestration Model

- Task scope is explicit and normalized: `global`, `repository`, or `project`.
- Pull eligibility is status-gated: only `ready` tasks are pull candidates (`draft` is never auto-pulled).
- Project-level pull order:
  - project-scoped `ready` tasks first
  - then repository/global fallback unless project `taskFocusMode` is `own-only`
- Repository fan-out uses oldest eligible project ordering (stable by creation time, then id).
- Project availability checks are hard gates before claim:
  - automation enabled (not disabled/frozen by policy scope)
  - tracked repository/git state available
  - repository match when requested
  - pinned branch match (if configured)
  - clean git status (no pending changes)
  - no live thread occupancy
- Branch pinning is a project setting (`pinnedBranch`), and branch/base-branch assignment from pull is record-only (no auto-branch creation).
- Thread spawn behavior is policy-driven per project (`new-thread` default; optional `reuse-thread`).
- Automation distribution is optional and controllable at each scope (`global`, `repository`, `project`) via `automationEnabled` and `frozen`.

Pass-through stream invariants:

- PTY byte stream is authoritative session reality and is never rewritten by adapters.
- Provider/meta events are side-channel observability, never in-band PTY output.
- Human and agent clients use the exact same PTY and event commands; no privileged human path.
- High-level helper commands (for example `conversation.send-turn`) are optional wrappers that compile to the same PTY primitives.
- Session replay/reattach uses persisted PTY/output + event cursor state; no synthetic state not derivable from authoritative streams.

## Mux Interaction Rules

- Escape is forwarded to the active PTY session; mux does not reserve it as a quit key.
- `ctrl+c` requests mux shutdown immediately and is not forwarded to active threads.
- In canonical remote/gateway mode, mux exits without closing live sessions so work continues after client disconnect.
- In embedded/local mode, mux shutdown also closes live PTYs.
- Gateway CLI lifecycle commands (`start`/`stop`/`status`/`restart`/`run`) are serialized through a per-session lock file (`gateway.lock`) to prevent concurrent start/stop races.
- Gateway identity is persisted in `gateway.json` (`pid`, `host`, `port`, `authToken`, `stateDbPath`, `startedAt`, `workspaceRoot`, optional `gatewayRunId`).
- If `gateway.json` is missing but the endpoint is reachable, the CLI may adopt the running daemon by matching process-table host/port/auth/db-path identity; ambiguous matches fail closed.
- `ctrl+p` and `cmd+p` open the command menu; command search is live-filtered and executes context-aware actions.
- Left-rail `[+ thread]` opens a thread-scoped command-menu variant (same matcher/autocomplete path) instead of a dedicated chooser modal.
- Command-menu `Set a Theme` opens a second autocomplete theme picker; moving selection previews theme changes live, and dismiss restores the pre-picker theme unless confirmed. Confirming with `enter` commits and persists the selected theme.
- Mux startup is Home-first: initial render enters Home pane even when persisted conversations exist.
- Gateway profiling moved to `ctrl+shift+p` so command menu invocation and profiling controls do not collide.

### Command Menu Model

- Command menu actions are registered through one registry abstraction; actions can be static or provider-driven.
- Every action executes with runtime selection context (`activeConversationId`, target directory, selected text, navigation mode, runtime toggle state).
- Command menu action execution still uses existing control-plane-backed runtime actions; no privileged side path is introduced.
- Core shipped actions include:
  - start thread by agent type (`codex`, `claude`, `cursor`, `terminal`, `critique`)
  - run Critique AI review for unstaged changes (`critique review`) from command menu (`Critique AI Review: Unstaged Changes (git)`)
  - run Critique AI review for staged changes (`critique review --staged`) from command menu (`Critique AI Review: Staged Changes (git)`)
  - run Critique AI review against base branch (`critique review <base> HEAD`) from command menu (`Critique AI Review: Current Branch vs Base (git)`)
  - close active thread
  - go to project
  - open GitHub for the active-project repository (`Open GitHub for This Repo (git)`)
  - show a filtered GitHub URL for your open pull requests in the active-project repository (`Show My Open Pull Requests (git)`)
  - open/create GitHub PR for the tracked active-project non-default branch (open when present, create when absent; `Open PR (git)` / `Create PR (git)`)
  - open a theme picker and set a built-in OpenCode preset or the special `default` theme
  - start/stop profiler
  - start/stop status logging
  - quit
- Thread "delete" in the mux is soft-delete (archive); hard delete remains an explicit control-plane command.
- Project lifecycle in the mux is first-class: `directory.upsert`, `directory.list`, and `directory.archive` drive add/close behavior through the same control-plane stream API as automation clients.
- Mux applies workspace lifecycle observed events (`directory-upserted`, `directory-archived`, `conversation-created`, `conversation-updated`, `conversation-archived`, `conversation-deleted`) directly into in-memory state so cross-client project/thread changes appear without restart.
- Key-event status handling keeps PTY event subscriptions aligned with `session-status.live` transitions, so externally started/stopped sessions track correctly in real time.
- Session status rendering is gateway-canonical: one `SessionStatusEngine` abstraction projects `statusModel` (`phase`, `glyph`, `badge`, `detailText`, `attentionReason`, `lastKnownWork*`) for agent-like sessions (`codex`, `claude`, `cursor`), and emits `statusModel: null` when no semantic status exists.
- `SessionStatusEngine` uses one interface with agent-specific reducer subclasses (`codex`, `claude`, `cursor`, `terminal`, `critique`); unknown agent labels normalize to `terminal`.
- Clients do zero status interpretation and zero fallback synthesis: mux/API consumers render the emitted `statusModel` exactly as provided by the gateway (including explicit `null`).
- Left-rail status detail rendering is intentionally suppressed when `statusModel` is `null` (notably `terminal` and `critique` threads); those rows still render a fixed one-cell type glyph (`⌨` for terminal, `✎` for critique) so thread-title icon alignment stays stable.
- Mux exposes a dedicated conversation interrupt action (`mux.conversation.interrupt`) mapped to control-plane `session.interrupt` for parity-safe thread interruption without quitting the client.
- The left rail treats Home as a first-class selectable entry (directory-style block with its own emoji); `ctrl+j/k` cycles visible left-nav selection in visual order: Home -> repository group -> project header -> project threads -> next visible item.
- Repository/task planning is exposed through a dedicated Home entry in the left rail; Home unifies repository and task CRUD in one scrollable right-pane view while control-plane repository/task commands and subscriptions remain the source of truth.
- Active project directories are scraped for GitHub remotes at startup/refresh; remotes are normalized and deduped, auto-upserted into canonical repository records, and reused for rail grouping.
- Gateway-side GitHub sync persists PR records + per-PR CI job records and emits realtime observed events (`github-pr-upserted`, `github-pr-closed`, `github-pr-jobs-updated`) so UI/API clients stay live without polling their own GitHub state.
- GitHub auth resolution is lazy and non-fatal: gateway prefers configured token env, falls back to `gh auth token`, and keeps startup healthy when auth is unavailable.
- Command-menu GitHub PR actions surface a soft hint when auth is missing instead of throwing hard UI errors.
- Left rail projects are grouped by canonical repository; projects with no detected canonical remote are grouped under `untracked`.
- Repository groups are collapsible (`left/right` collapse/expand selected group, `ctrl+k ctrl+0` collapse all, `ctrl+k ctrl+j` expand all), and collapsed groups hide child projects/threads from keyboard traversal.
- Project rows in the left rail are selectable; selecting a project switches the right pane into a project view and scopes project actions to that explicit selection.
- `new thread` preserves thread-project affinity when a thread row is selected; in project view it uses the selected project.
- Projects may remain thread-empty; mux does not auto-seed a thread on startup/project-add/fallback and instead exposes explicit `new thread` entry points.
- Creating a thread uses command-menu actions (`codex`, `claude`, `cursor`, `terminal`, `critique`); terminal threads launch a plain interactive shell over the same PTY/control-plane path, while critique threads default to `critique --watch`.
- Critique AI review command-menu actions execute in a new terminal thread and prefer `--agent claude` when available, falling back to `--agent opencode` when installed.
- Clicking the active thread title row enters inline title-edit mode; edits update locally immediately and persist through debounced `conversation.update` control-plane commands.
- The pane separator is draggable; divider moves recompute layout and PTY resize through the normal mux resize path.
- The mux status row is performance-focused: live FPS and throughput (`KB/s`) plus render/output/event-loop timing stats.

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

- `thread.created`
- `thread.updated`
- `thread.archived`
- `thread.deleted`
- `session.started`
- `session.exited`
- `turn.started`
- `turn.completed`
- `turn.failed`
- `input.required` (approval/user-input required)
- `tool.started`
- `tool.completed`
- `tool.failed`

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

### Lifecycle Hook Adapter Model

- Hooks are config-governed in `harness.config.jsonc` under `hooks.lifecycle.*`.
- A normalized lifecycle envelope is produced from stream-observed events (`conversation-*`, `session-status`, `session-event`, `session-key-event`) with provider tagging (`codex`, `claude`, `cursor`, `control-plane`, `unknown`).
- Prompt capture is emitted as a first-class observed event (`session-prompt-event`) alongside status/telemetry events. Prompt extraction is adapter-specific (`codex`, `claude`, `cursor`) and preserves source/confidence metadata for downstream automation.
- Provider filters are first-class (`hooks.lifecycle.providers.*`) so operators can enable/disable lifecycle dispatch per provider family without changing runtime code.
- Hook dispatch runs asynchronously behind an internal queue so control-plane command/PTY hot paths are not blocked by connector IO.
- Connector model is pluggable and currently includes:
  - `peon-ping`: maps lifecycle event types to category playback requests (`GET /play?category=...`) for local sound-pack integration.
  - `webhooks`: generic outbound HTTP connector with method/headers/timeout + optional event-type filtering.
- Connector failures are non-fatal and recorded through `perf-core` lifecycle hook spans/events for diagnosis.

## Event Fidelity Rules

- Do not force a cross-model behavioral abstraction that erases provider-native semantics.
- Keep provider-built-in tools (for example native web search) as explicit tool events, not generic text output.
- Keep context compaction as explicit lifecycle events, not hidden implementation details.
- Preserve raw provider payload references for traceability and replay.
- Provide stable event envelopes with schema versioning so clients can process streams safely.

## Status Model and Attention Routing

Control-plane runtime statuses:

- `running`
- `needs-input`
- `exited`
- `completed` (turn-level terminal state for explicit interrupts and provider turn-complete signals)

Workspace rail display statuses:

- `starting`
- `working` (`active`)
- `idle` (`inactive`)
- `needs-action`
- `exited`

Display transition contract:

```txt
session start -> active (or starting fallback when no fresh work signal is available)
user prompt / stream progress -> active
turn e2e metric -> inactive
explicit interrupt / abort-complete status -> inactive
needs-input -> needs-action
session exit -> exited
```

High-signal classification rules:

- Start-work signal: `codex.user_prompt`, `codex.sse_event` progress kinds (`response.created`, `response.in_progress`, `response.output_text.delta`, `response.output_item.added`, `response.function_call_arguments.delta`), Claude hook `claude.userpromptsubmit`, and Cursor hook `cursor.beforesubmitprompt` (plus Cursor tool-start hooks).
- Turn-complete signal: `otlp-metric` `codex.turn.e2e_duration_ms`, explicit `session.interrupt` / `pty.signal interrupt`, Claude hook `claude.stop`, Claude notification abort/cancel/interrupt token variants, and Cursor hooks `cursor.stop` / `cursor.sessionend` (including aborted/cancelled terminal states normalized to completed).
- Attention signal: explicit `needs-input`/approval-required values from structured payload fields only (severity/error-like and summary-text fallbacks are intentionally disabled).
- Notify signal transport: provider hook records are surfaced as `session-event notify` on the same stream (for example Codex payload type `agent-turn-complete` and Claude hook payloads).
- Prompt signal transport: provider prompt-start hooks and Codex telemetry/history prompt events are normalized into `session-prompt-event` with source (`hook-notify`/`otlp-log`/`history`) and per-session dedupe keys to preserve mid-conversation prompt ordering without duplicate bursts.
- Prompt-aware thread naming: gateway stores sanitized per-thread prompt history in adapter state and can invoke Anthropic Haiku to refresh a concise two-word lowercase title (title text only; agent label rendering remains client-side), emitting canonical `conversation-updated` observed events so all clients render the same title updates. A mux shortcut (`mux.conversation.titles.refresh-all`, default `ctrl+r`) refreshes all eligible agent-thread titles with progress notices.
- Status-neutral noise: tool/api/websocket chatter, trace churn, and task-complete fallback text do not mutate the status line.

Invariant:

- No foreground/background or controller-specific status heuristics are used for telemetry classification.
- Fallback completion formats are intentionally disabled; only explicit provider lifecycle signals and explicit interrupt commands complete a turn.
- Session ownership is orthogonal to status mapping; controller metadata never overrides rail status text.

Notification policy:

- Trigger sound/desktop notifications on transitions to `needs-input`, `idle` after `working:*`, or `exited`.
- Optionally focus/switch to target tab/session.
- De-duplicate repeated alerts for same turn.

Status routing invariants:

- Status is scoped to `(tenant_id, user_id, workspace_id, worktree_id, conversation_id)` and must never be inferred from shared process-level artifacts.
- Adapter enrichment channels (telemetry, history, hooks) must retain per-thread and per-session correlation to prevent cross-conversation status contamination.
- UI status badges must be driven from conversation-scoped events/state only; no global fallback that can mark sibling conversations as `completed`.

## Codex Live-Steering Integration (v1)

Use a PTY-hosted interactive `codex` session as the primary integration path. Human live steering is the first principle.

Layer optional enrichment channels on top of the same live session:

- Codex OpenTelemetry logs/metrics/traces.
- Codex `history.jsonl` ingestion for thread continuity and event backfill.

This ordering ensures terminal reality is authoritative while still allowing high-fidelity instrumentation.

Primary live-session capabilities:

- launch/attach/detach/re-attach a running `codex` terminal session with no privileged bypass
- human steering in-session (`prompt`, interrupt, continue, context edits) with PTY parity
- event stream derived from live session + Codex telemetry/history enrichment
- pseudo-screenshot capture from PTY-derived output for integration/e2e assertions (text-rendered terminal snapshot, machine-readable output option)
- status/key-event synthesis from structured provider events, with deterministic fallback to PTY lifecycle when enrichment is unavailable

## Model-Agnostic Strategy

Integration tiers:

1. Live PTY adapter (primary): human-steerable terminal session with attach/detach and low-latency control.
2. Telemetry/hook enrichment: provider-native structured channels for attention and lifecycle hints.
3. Heuristic parser fallback: parse terminal output only when no richer signal exists.

This keeps live steering universal across agents while still taking advantage of structured provider signals when available.

Provider policy (Codex/Claude direct usage):

- Prefer launching provider CLIs directly inside PTY (`codex`, `claude`) with no protocol translation in the hot path.
- Adapter responsibilities are limited to launch config, optional telemetry/history/hook ingestion, and event normalization.
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

Mouse ownership policy (current runtime behavior):

- Right-pane mouse passthrough to PTY is enabled only when all are true:
  - main pane is `conversation`
  - terminal state is on alternate screen
  - PTY has enabled DEC mouse tracking (`?1000/?1002/?1003`)
  - viewport is in follow-output mode (not user scrollback)
- `Shift` is a force-local override: even when passthrough is eligible, mouse input stays local for mux scrollback/selection interactions.
- When passthrough is disabled, right-pane wheel input remains local scrollback (never dual-routed).

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
  - canonical artifact: `src/terminal/compat-matrix.ts` (locked by `test/terminal-compat-matrix.test.ts`).

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
   - scripted Codex flows (startup, turns, telemetry-linked cycles, interrupt/continue)
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

Recorded climb checklist (checkpoint: February 19, 2026):

- Canonical checklist data lives in `src/terminal/compat-matrix.ts`; status claims must stay test-locked in `test/terminal-compat-matrix.test.ts`.
- L0 `Grammar + Core Controls`: complete.
- L1 `Screen State Model`: complete.
- L2 `DEC TUI Modes`: in-progress.
- L3 `Query + Reply Engine`: in-progress.
- L4 `Unicode Fidelity`: in-progress.
- L5 `External + Differential Conformance`: planned.
- L6 `Modern Extensions`: planned.

Current P0 Codex/Vim blockers from the matrix:

1. `differential-terminal-checkpoints` (direct terminal vs harness checkpoints) is unsupported.

Immediate climb order:

1. Add automated direct-terminal differential checkpoints for Codex/Vim corpora as a blocking gate.

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
- `repositories`
- `tasks`
- `project_settings`
- `automation_policies`
- `conversations`
- `turns`
- `events` (append-only canonical state history)
- `attention_queue`
- `notifications_sent`

Task/policy schema notes:

- `tasks` includes `scope_kind` and `project_id` to model project/repository/global planning explicitly.
- `project_settings` stores per-project orchestration controls (`pinned_branch`, `task_focus_mode`, `thread_spawn_mode`).
- `automation_policies` stores optional scope overrides (`automation_enabled`, `frozen`) for global/repository/project control.

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
- `perf-core` write-path is hot-path aware: records are buffered and flushed in batches, and high-frequency events can use deterministic sampling (for example `pty.stdout.chunk`) to bound instrumentation overhead.
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
- Config location is user-global with XDG precedence:
  - `$XDG_CONFIG_HOME/harness/harness.config.jsonc` when `XDG_CONFIG_HOME` is set
  - `~/.harness/harness.config.jsonc` otherwise
- Runtime artifact location is user-global and workspace-scoped:
  - `$XDG_CONFIG_HOME/harness/workspaces/<workspace-slug>/...` when `XDG_CONFIG_HOME` is set
  - `~/.harness/workspaces/<workspace-slug>/...` otherwise
- Gateway runtime artifacts are session-scoped within each workspace runtime root:
  - default session: `<workspace-runtime>/gateway.json`, `<workspace-runtime>/gateway.log`, `<workspace-runtime>/gateway.lock`, `<workspace-runtime>/control-plane.sqlite`
  - named sessions: `<workspace-runtime>/sessions/<session-name>/gateway.json|gateway.log|gateway.lock|control-plane.sqlite`
- Config payloads are explicitly versioned with top-level `configVersion`.
- JSON-with-comments format (JSONC) is required to allow inline documentation and annotation.
- Single configuration abstraction only (`config-core`) used by every subsystem and process.
- No competing runtime config sources for core behavior (no shadow config files, no duplicate per-module configs).
- Runtime behavior toggles are config-first; environment variables are reserved for bootstrap/transport wiring and test harness injection, not the primary control surface.
- Bootstrap secrets may be loaded from user-global `secrets.env` alongside `harness.config.jsonc` (dotenv-style `KEY=VALUE`) into process env before startup; explicitly exported environment variables remain authoritative over file-provided values.
- GitHub sync policy is config-governed under `github.*`:
  - `enabled` defaults to `true`
  - `apiBaseUrl`, `tokenEnvVar`, `pollMs`, `maxConcurrency`, `branchStrategy`, and optional `viewerLogin` are normalized by `config-core`
- Launch policy is config-governed under each provider section:
  - `codex.launch`, `claude.launch`, and `cursor.launch`
  - each supports `defaultMode` (`yolo` or `standard`) as the fallback for all directories
  - each supports `directoryModes` for per-directory overrides keyed by workspace path
- Tool install commands are config-governed under each provider section:
  - `codex.install.command`, `claude.install.command`, `cursor.install.command`, `critique.install.command`
  - values are shell command strings (or `null`) surfaced by `agent.tools.status` and used by thread-scoped install actions
- Mux theme policy is config-governed under `mux.ui.theme`:
  - `preset` selects a built-in OpenCode-compatible preset set mirrored from canonical upstream OpenCode themes, with special value `default` for the legacy default mux theme
  - `mode` selects `dark` or `light` variant resolution
  - `customThemePath` optionally loads a local OpenCode theme JSON file (`https://opencode.ai/theme.json`) and overrides preset colors when valid
  - invalid custom files or unknown presets must fall back deterministically to a safe preset while keeping mux startup healthy
- Config lifecycle:
  - on first run, bootstrap config by copying the checked-in template (`src/config/harness.config.template.jsonc`)
  - when upgrading from legacy local workspace state (`<workspace>/.harness`), copy runtime artifacts into the user-global workspace-scoped runtime path on first run without overwriting an existing global config file
  - parse -> validate -> publish immutable runtime snapshot
  - unversioned legacy files migrate forward to the current `configVersion`
  - unknown future `configVersion` values must fail closed and preserve startup health via last-known-good fallback
  - on reload, replace snapshot atomically
  - on invalid config, keep last known good snapshot and emit error events/logs
- Config values affecting hot paths must be read from in-memory snapshot, never reparsed on critical operations.

## Client Surfaces

### TUI (v1)

- Core requirements:
  - left rail: Home -> repository-group tree -> projects -> conversations, with per-repository collapse and untracked grouping
  - right pane: active live steerable PTY session
  - left-rail activation via keyboard and mouse with deterministic row hit-testing
  - normalized action-oriented conversation status labels (`starting`, `needs action`, `working`, `idle`, `exited`)
  - keybindings loaded from `harness.config.jsonc` using action IDs and parseable key strings (including Home task-composer actions under `mux.home.*`)
  - keybinding matcher aliases `ctrl` and `cmd`/`meta` in both directions for the same chord so configured shortcuts stay cross-platform when terminal/OS delivery allows it
- Global shortcuts:
  - switch workspace/worktree/conversation
  - attach terminal
  - send message
  - steer active turn
  - queue turn
  - interrupt
  - toggle gateway profiler capture (`mux.gateway.profile.toggle`, default `ctrl+p`)
  - toggle interleaved status timeline capture (`mux.gateway.status-timeline.toggle`, default `alt+r`)
  - toggle focused render diagnostics capture (`mux.gateway.render-trace.toggle`, default `ctrl+]`)
  - open file/project

Target layout sketch:

```txt
┌───────────────────────────────┬──────────────────────────────────────────────────────┐
│  ├─ 🏠 home                   │  Active Conversation PTY                             │
│  ├─ 📁 harness (3,2) [-]      │  (Codex / terminal shell / vim passthrough)         │
│  │  ├─ 📁 api (main:+4,-1)    │                                                      │
│  │  │  ├─ ◆ codex - auth      │                                                      │
│  │  │  │    writing…          │                                                      │
│  │  │  └─ ○ terminal - logs   │                                                      │
│  │  │       inactive          │                                                      │
│  ├─ 📁 infra (2,0) [+]        │                                                      │
│  ├─ 📁 untracked (1,0) [-]    │                                                      │
│  │  └─ 📁 scratch [+ thread]  │                                                      │
│  │      └─ ◔ codex - draft    │                                                      │
│  │          starting          │                                                      │
│                 [> add project]│                                                      │
│  ├─ shortcuts [-]             │                                                      │
└───────────────────────────────┴──────────────────────────────────────────────────────┘
```

Left-rail rendering/style principles:

- Visual hierarchy from typography and spacing first; color is secondary reinforcement.
- Stable row order by default; selection changes highlight only.
- Selected-row background styling is content-scoped (label text only), not applied to tree connector glyphs.
- Status indicators are short, icon-assisted, and action-oriented (`starting`, `needs action`, `working`, `idle`, `exited`).
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
  - Use: runtime-native SQLite bindings behind one shared wrapper (`bun:sqlite`) plus simple migration tooling.
  - Rationale: avoid rebuilding storage engines/bindings.

- Testing framework and assertions:
  - Use: `bun test` plus strict assertion/type tooling.
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

## Verification Tenets

- Behavior equivalence is mandatory: refactors must preserve interaction semantics (input routing, pane behavior, control-plane parity).
- Verification is gate-based and continuous: lint, typecheck, dead-code, full tests, and coverage must stay green.
- Coverage is non-negotiable: all code paths must remain covered at 100% lines/functions/branches.
- Terminal parity is regression-tested with deterministic snapshots and parity scenes, not visual guesswork.
- Latency-sensitive changes require before/after benchmark evidence from the mux hot-path harness.
- Config, logging, and instrumentation must remain centralized (`config-core`, `log-core`, `perf-core`) with no side channels.

## Sources

- https://openai.com/index/unlocking-codex-in-your-agent-harness/
- https://developers.openai.com/codex/config#advanced
- https://docs.anthropic.com/en/docs/claude-code/hooks
- https://github.com/PeonPing/peon-ping
- https://github.com/ThePrimeagen/agent-of-empires
- https://github.com/coder/mux
- https://github.com/amacneil/vibetunnel
- https://ecma-international.org/publications-and-standards/standards/ecma-48/
- https://www.invisible-island.net/xterm/ctlseqs/ctlseqs.html
- https://vt100.net/docs/vt220-rm/chapter4.html
- https://www.invisible-island.net/vttest/
- https://man7.org/linux/man-pages/man5/terminfo.5.html
- https://vimhelp.org/term.txt.html
- https://neo.vimhelp.org/term.txt.html
- https://sw.kovidgoyal.net/kitty/keyboard-protocol/
- https://iterm2.com/feature-reporting/Hyperlinks_in_Terminal_Emulators.html
- https://contour-terminal.org/vt-extensions/synchronized-output/
- https://unicode.org/reports/tr11/
- https://unicode.org/reports/tr29/
- https://github.com/microsoft/node-pty
- https://github.com/creack/pty
- https://github.com/wezterm/wezterm/tree/main/pty
