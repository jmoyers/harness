# Agent Harness Behavior Reference

This document is feature behavior reference, not architecture law.

Use this when changing specific interaction flows. For boundary and architecture constraints, use `design.md`.

## How to Read This

- Each section is a behavior surface.
- Statements are concise behavior fragments.
- Primary owning modules and test anchors are listed for fast traceability.

## Command Menu

Behavior fragments:

- Scoped command registry and provider-driven action lists.
- Query matching/ranking with deterministic ordering.
- Empty-query grouping with stable default focus behavior.
- Modal wheel scrolling moves command selection with the same wrap behavior as keyboard navigation.
- Action execution through runtime-owned handlers.

Owners:

- `src/mux/live-mux/command-menu.ts`
- `src/services/runtime-command-menu-agent-tools.ts`

Test anchors:

- `test/mux-live-mux-command-menu.test.ts`
- `test/mux-live-mux-modal-command-menu-handler.test.ts`
- `test/services-runtime-command-menu-agent-tools.test.ts`

## Modal System

Behavior fragments:

- Modal open/close lifecycle with explicit dismissal rules.
- Outside-click behavior and escape-key handling.
- Modal input reducers with deterministic transitions.

Owners:

- `src/mux/live-mux/modal-input-reducers.ts`
- `src/mux/live-mux/modal-prompt-handlers.ts`
- `packages/harness-ui/src/modal-manager.ts`

Test anchors:

- `test/mux-live-mux-uncovered-modals.test.ts`
- `test/ui-modal-manager.test.ts`

## Global and Local Shortcuts

Behavior fragments:

- Shortcut decoding across raw/control/protocol variants.
- Global shortcut routing separate from pane-local semantics.
- Config override support with deterministic normalization.
- Command-menu shortcuts catalog (`cmd+p` -> `Show Keybindings`) with `shortcuts`/`keybinds` aliases and filterable binding table.

Owners:

- `src/mux/input-shortcuts.ts`
- `src/mux/task-screen-keybindings.ts`
- `src/mux/live-mux/global-shortcut-handlers.ts`

Test anchors:

- `test/mux-input-shortcuts.test.ts`
- `test/task-screen-keybindings.test.ts`
- `test/mux-live-mux-global-shortcut-handlers.test.ts`

## Left Rail and Pointer Interaction

Behavior fragments:

- Rail row/cell hit testing with clamped coordinates.
- Action-first then entity routing semantics.
- Selection/edit guards before dispatch.
- Rapid left-nav conversation cycling uses latest-wins keyed control-plane activation with abort signal propagation to drop stale switches.

Owners:

- `packages/harness-ui/src/interaction/rail-pointer-input.ts`
- `src/services/left-rail-pointer-handler.ts`
- `src/mux/workspace-rail-model.ts`

Test anchors:

- `test/ui-left-rail-pointer-input.test.ts`
- `test/mux-workspace-rail-model.test.ts`
- `test/mux-live-mux-uncovered-dispatchers.test.ts`
- `test/ui-left-nav-fast-cycle.integration.test.ts`
- `test/services-runtime-conversation-activation.test.ts`

## Conversation Link Clicks

Behavior fragments:

- Command-click in conversation VTE resolves the token under the pointer as either URL or file-like path.
- URL targets open through the configured browser command override when set, otherwise platform default browser opener.
- File targets prefer configured pinned file command override; otherwise they use detected `open in` targets with `zed` priority, then platform default file opener fallback.

Owners:

- `src/mux/live-mux/input-forwarding.ts`
- `src/mux/live-mux/link-click.ts`
- `src/mux/runtime-app/codex-live-mux-runtime.ts`

Test anchors:

- `test/mux-live-mux-link-click.test.ts`
- `test/mux-live-mux-uncovered-small.test.ts`

## Pane Rendering and Navigation

Behavior fragments:

- Left/right pane layout and divider semantics.
- Home/project/task pane render branching.
- Left rail keeps project-scoped GitHub PR nodes hidden until explicitly opened from command palette (`Open GitHub Thread (git)`).
- Selecting a GitHub rail node opens the project main panel in GitHub review mode and renders full tracked-branch PR details (lifecycle + open/resolved review threads and comments).
- GitHub rail rows show compact PR summary detail inline when the rail node is active.
- GitHub review data loads via centralized runtime cache with TTL freshness, in-flight dedupe, and active-pane timed refresh.
- GitHub review refresh work runs in latest-wins background control-plane slots so rapid interactive left-nav cycling is not starved by review refresh backlog.
- Entering project pane does not trigger GitHub review loading; default project tree render stays instant from existing local snapshot state.
- GitHub review mode exposes an explicit refresh action for GitHub review data; force refresh is user-driven.
- Gateway prewarms and serves cached project review data by repository+tracked branch so non-force reads avoid direct GitHub API fetches.
- Navigation transitions and selection synchronization.
- Local Git repositories without GitHub remotes still hydrate into repository groups (not `untracked`).

Owners:

- `src/services/runtime-right-pane-render.ts`
- `src/mux/project-pane-github-review.ts`
- `src/services/runtime-project-pane-github-review-cache.ts`
- `src/mux/harness-core-ui.ts`
- `src/mux/live-mux/project-pane-pointer.ts`
- `src/services/runtime-left-rail-render.ts`
- `src/mux/live-mux/rail-layout.ts`

Test anchors:

- `test/services-runtime-right-pane-render.test.ts`
- `test/project-pane-github-review.test.ts`
- `test/services-runtime-project-pane-github-review-cache.test.ts`
- `test/mux-harness-core-ui.test.ts`
- `test/mux-live-mux-uncovered-small.test.ts`
- `test/services-runtime-left-rail-render.test.ts`
- `test/mux-live-mux-rail-layout.test.ts`

## nim Pane Runtime

Behavior fragments:

- Left rail includes a persistent top-level `nim` entry that routes to a dedicated nim pane.
- nim in mux is modeled as a single workspace-scoped conversation process (`nim-workspace-<workspaceId>`) for now.
- First entry into nim resolves or creates that conversation in the control plane and activates it through the same start/attach stream path used by regular threads.
- nim launch profile uses the harness runtime entrypoint (`node scripts/harness.ts nim`) via control-plane PTY lifecycle.
- nim pane rendering in mux is conversation-frame based (same stream snapshot model as threads). Missing-key onboarding is rendered by the standalone `packages/nim` UI itself inside that stream.
- standalone nim transcript rendering now supports block markdown primitives (headings, blockquotes, lists, code fences, horizontal rules), markdown tables rendered as box-drawn terminal grids, per-tool activity rows, and explicit per-turn in-progress indicators while assistant output is still streaming.
- When `ANTHROPIC_API_KEY` is missing, nim boots into an onboarding empty state (`Anthropic API Key required`) and routes composer submit to secure key setup instead of agent turns.
- Key setup is available from onboarding and command palette (`Set Anthropic API Key`), persists through `~/.harness/secrets.env`, confirms save, and transitions back to regular nim landing/chat flow without restarting mux.
- Main-pane input routing in nim mode forwards text directly to the active nim session stream input for normal runtime behavior, and raw `Esc` is passed through for runtime handling.
- Main-pane selection and copy behavior in nim mode follows the same mouse-selection and copy-shortcut flow used by conversation mode.
- nim process status is projected into the same status model pipeline used for other agent sessions and is persisted/restored with conversation runtime state.
- nim provider turn context is session-scoped and reconstructed from persisted event history (user turn input + assistant message output), so restart/resume retains the same conversation context while remaining isolated per session.
- nim provider stream contract is fail-closed: successful provider completions must include streamed assistant text deltas and a terminal `provider.turn.finished` signal; violations emit turn-failure notices into the nim UI stream.
- nim launches with workspace/session scope args and control-plane connection env injected by the stream server, then resolves tool calls through `runtime-nim-tool-bridge -> runtime-nim-control-plane-api -> control-plane stream commands`.
- nim control-plane tool surface includes workspace inspection (`directory.list`, `repository.list`, `task.list`, `session.list`) plus thread lifecycle/runtime control (`thread.list`, `thread.create`, `thread.update`, `thread.archive`, `thread.delete`, `thread.status`, `thread.snapshot`, `thread.respond`, `thread.interrupt`, `thread.claim`, `thread.release`, `thread.start`, `thread.attach`, `thread.detach`, `thread.events.subscribe`, `thread.events.unsubscribe`, `thread.close`, `thread.remove`).

Owners:

- `src/mux/new-thread-prompt.ts`
- `src/mux/live-mux/conversation-state.ts`
- `src/mux/runtime-app/codex-live-mux-runtime.ts`
- `src/control-plane/stream-server.ts`
- `src/control-plane/status/session-status-engine.ts`
- `src/store/control-plane-store.ts`
- `src/services/runtime-render-state.ts`
- `src/services/runtime-right-pane-render.ts`
- `src/services/runtime-nim-tool-bridge.ts`
- `src/services/runtime-nim-control-plane-api.ts`
- `packages/nim/src/*`

Test anchors:

- `test/unit/mux/mux-new-thread-prompt.test.ts`
- `test/unit/mux/live-mux/mux-live-mux-conversation-state.test.ts`
- `test/unit/control-plane/control-plane-status-engine.test.ts`
- `test/unit/control-plane/control-plane-store.test.ts`
- `test/unit/control-plane/control-plane-stream-server.test.ts`
- `test/unit/services/runtime/services-runtime-render-state.test.ts`
- `test/unit/services/runtime/services-runtime-right-pane-render.test.ts`
- `test/integration/ui/ui-harness-ui-e2e.integration.test.ts`
- `test/integration/ui/ui-harness-ui-matrix.integration.test.ts`
- `test/integration/codex/codex-live-mux-startup-hydration.integration.test.ts`

## Task Pane and Editing

Behavior fragments:

- Task create/edit/reorder lifecycle.
- Draft composer persistence and keyboard flows.
- Repository-scoped task projection and selection.

Owners:

- `src/services/runtime-task-pane-actions.ts`
- `src/services/runtime-task-editor-actions.ts`
- `src/services/runtime-task-composer-persistence.ts`

Test anchors:

- `test/services-runtime-task-pane-actions.test.ts`
- `test/services-runtime-task-editor-actions.test.ts`
- `test/services-runtime-task-pane-shortcuts.test.ts`

## Status and Attention Projection

Behavior fragments:

- Provider/runtime events projected into canonical status model.
- `runtimeStatus` is process/runtime truth; `phase` is interpreted client-facing state.
- `activityHint` is optional telemetry metadata and does not supersede `phase`.
- Attention hints and completion/inactivity transitions.
- Rail/status line text from normalized event timelines.
- Each live thread writes per-conversation diagnostics (`status-transition`, unsupported control sequence observations) to session-scoped JSONL files and deletes that file when the thread is archived/removed.

Owners:

- `src/control-plane-status-engine/*`
- `src/mux/runtime-wiring.ts`
- `src/mux/workspace-rail-model.ts`

Test anchors:

- `test/control-plane-status-engine.test.ts`
- `test/mux-runtime-wiring.test.ts`
- `test/mux-workspace-rail-model.test.ts`

## Startup, Hydration, and Shutdown

Behavior fragments:

- Startup hydration from persisted state and subscriptions.
- Deferred/background startup work after initial UX readiness.
- Ordered shutdown of runtime dependencies.

Owners:

- `src/services/startup-*.ts`
- `src/services/runtime-shutdown.ts`
- `src/services/conversation-lifecycle.ts`

Test anchors:

- `test/codex-live-mux-startup.integration.test.ts`
- `test/services-startup-*.test.ts`
- `test/services-runtime-shutdown.test.ts`

## UI Contract Harness

Behavior fragments:

- UI look-and-feel contracts are captured as deterministic fixtures from rendered rows plus per-cell style projection.
- Visual contracts use fixture approval mode (`HARNESS_UPDATE_UI_CONTRACTS=1`) and fail closed on unapproved drift.
- Contract snapshots include viewport, ANSI rows, and style dictionaries so diffs are reviewable.
- Live harness matrix e2e validates command menu + nim pane behavior across constrained and standard viewports with keyboard and pointer dismissal flows.

Owners:

- `test/support/ui-contract.ts`
- `test/support/harness-ui-e2e-driver.ts`
- `packages/harness-ui/src/testing/pilot.ts`

Test anchors:

- `test/contracts/ui/ui-look-and-feel.contract.test.ts`
- `test/integration/ui/ui-harness-ui-matrix.integration.test.ts`

## Control Plane Command Surface

Behavior fragments:

- Parser/dispatch command parity.
- Typed command wrappers for agent clients.
- Observed-event subscription filtering and replay semantics.
- Observed stream-event envelopes are applied with per-subscription monotonic cursor guards (duplicate/regressed cursors are ignored).
- Synced directory/conversation/repository/task projection is reduced through `src/core/state/synced-observed-state.ts` and persisted in `src/core/store/harness-synced-store.ts`.
- TUI workspace and task collections consume synced reducer deltas through domain projections (`src/services/workspace-observed-events.ts`, `src/services/task-planning-observed-events.ts`) instead of parsing observed payloads a second time.

Owners:

- `src/control-plane/stream-command-parser.ts`
- `src/control-plane/stream-server.ts`
- `src/control-plane/agent-realtime-api.ts`
- `src/core/contracts/records.ts`

Test anchors:

- `test/control-plane-api-parity.test.ts`
- `test/control-plane-stream-server*.test.ts`
- `test/control-plane-agent-realtime-api*.test.ts`

## Storage Lifecycle

Behavior fragments:

- Event/telemetry write guardrails run before persistence.
- Rolling-window maintenance execution is temporarily disabled in mux runtime and control-plane server polling; manual maintenance runs only when explicitly invoked through `harness gateway gc`.
- Provider `provider-text-delta` events are streamed to the UI but dropped before event-store persistence.
- WAL checkpoints remain available for explicit/offline maintenance workflows.
- Incremental vacuum remains deferred for live paths while maintenance execution is disabled.
- SQLite `busy_timeout` is configurable via `storage.lifecycle.busyTimeoutMs` (default 5 000 ms) and propagated to every store connection opened by the gateway and mux processes.
- Storage lifecycle policy values are configured under `storage.lifecycle` and applied to both mux event storage and control-plane telemetry storage.
- Mux event-store maintenance ticks are currently disabled; event writes continue through the append-only store path.
- Control-plane storage lifecycle policy is hot-reloaded from config while the server is live, but hot-path maintenance execution remains disabled.
- `harness gateway gc` runs manual offline telemetry truncation/compaction for retained session/default control-plane databases that are not live.
- Event and telemetry storage maintenance is coordinated through one module.
- Existing SQLite files are upgraded on open to incremental auto-vacuum mode (best-effort).

Owners:

- `src/storage/storage-lifecycle-core.ts`
- `src/store/event-store.ts`
- `src/store/control-plane-store.ts`
- `src/control-plane/stream-server.ts`
- `src/mux/runtime-app/codex-live-mux-runtime.ts`

Test anchors:

- `test/unit/storage/storage-lifecycle-core.test.ts`
- `test/unit/events/event-store.test.ts`
- `test/unit/control-plane/control-plane-store.test.ts`
- `test/unit/control-plane/control-plane-stream-server.test.ts`

## Maintenance Rule

When behavior changes:

1. Update tests first or in the same change.
2. Update this section for the affected surface.
3. Keep architecture-level decisions in `design.md`, not here.
