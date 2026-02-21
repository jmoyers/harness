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

## Pane Rendering and Navigation

Behavior fragments:

- Left/right pane layout and divider semantics.
- Home/project/task pane render branching.
- Left rail exposes a project-scoped GitHub PR node that opens like a thread target.
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
- Attention hints and completion/inactivity transitions.
- Rail/status line text from normalized event timelines.

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

## Control Plane Command Surface

Behavior fragments:

- Parser/dispatch command parity.
- Typed command wrappers for agent clients.
- Observed-event subscription filtering and replay semantics.

Owners:

- `src/control-plane-stream-command-parser.ts`
- `src/control-plane-stream-server.ts`
- `src/control-plane-agent-realtime-api.ts`

Test anchors:

- `test/control-plane-api-parity.test.ts`
- `test/control-plane-stream-server*.test.ts`
- `test/control-plane-agent-realtime-api*.test.ts`

## Maintenance Rule

When behavior changes:

1. Update tests first or in the same change.
2. Update this section for the affected surface.
3. Keep architecture-level decisions in `design.md`, not here.
