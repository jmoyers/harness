# Platform-Agnostic Control Plane + Shared State Plan

Date: 2026-02-21
Owner: Harness runtime team
Status: In progress
Branch: `jm/client-abstraction`

## Objective
Build one canonical state path that both TUI and web clients consume, using a shared vanilla Zustand store and client-specific adapters, while removing protocol/UI coupling from the control plane.

## Delivery Mode (Active For This Refactor)
- Take large, milestone-sized slices. Avoid narrow incremental wiring-only steps that leave the system in prolonged transitional states.
- Prefer domain-owned delegations over app-layer glue. Composition roots assemble concrete domain/service collaborators; they do not become forwarding hubs.
- Each milestone must leave a coherent, runnable end state for the affected surface (TUI first, then web parity).

## Current Coupling Hotspots
- `src/mux/runtime-app/codex-live-mux-runtime.ts`: composition root mixes transport, domain state, and terminal UI wiring.
- `src/domain/workspace.ts`: domain state imports mux/UI-derived types.
- `src/services/control-plane.ts`: service parses through mux path (`src/mux/live-mux/control-plane-records.ts`).
- `src/control-plane/stream-protocol.ts`: `StreamSessionStatusModel` includes presentation tokens (`glyph`, `badge`).
- `src/control-plane/agent-realtime-api.ts` and `src/mux/live-mux/control-plane-records.ts`: hard-parse presentation tokens.

## Decisions To Lock Before Refactor

### 1) Session status semantics (`runtimeStatus`, `phase`, `activityHint`)
Decision:
- `runtimeStatus` is authoritative process/runtime truth.
- `phase` is authoritative interpreted state for UX.
- `activityHint` is optional telemetry metadata and not a competing phase source.

Rule:
- Clients must trust `runtimeStatus` and `phase`.
- `activityHint` must never override `phase`.

### 2) Store ownership + wiring
Decision:
- Store creation is centralized in one runtime factory.
- Adapters receive store via dependency injection.
- No module-scoped implicit store references in handler modules.
- No standalone "wiring-only" modules that relay behavior without owning invariants or decisions.

### 3) Selector stability
Decision:
- No allocating selectors in reactive hooks (`map/filter` in selector body).
- Use memoized selectors or `useStoreWithEqualityFn`/`shallow` for derived arrays.

### 4) Optimistic updates
Decision:
- Allow optimistic updates for local navigation.
- For mutation commands, standardize rollback/resync behavior:
  - On failure: emit error notice and issue authoritative resync command.
  - Use optimistic-only for operations where temporary divergence is acceptable.

## Target Architecture

## Core
- `src/core/contracts/*`: protocol-facing record parsers and shared types.
- `src/core/state/*`: pure reducers (`bootstrap`, `applyObservedEvent`, `applyCommandResult`).
- `src/core/store/*`: vanilla Zustand store factory and action API.
- `src/core/runtime/*`: non-serializable registries (PTY attachments, terminal oracles, timers).

## Adapters
- `src/clients/tui/*`: TUI selectors, input handlers, presentation mapping.
- `src/clients/web/*`: React selectors/hooks/components, presentation mapping.

## Control-plane contract boundary
- Control plane emits semantic status objects only.
- Presentation tokens are adapter-local derivation.

## Execution Phases

## Phase 0: Contract and naming freeze
Deliverables:
- ADR-like note in `design.md` defining status field semantics.
- `behavior.md` update describing authoritative status interpretation.

Tasks:
- Define final status model and remove overlapping phase-hint fields.
- Define rollback policy by command class (navigation vs destructive vs idempotent).

Exit criteria:
- Semantics documented and reviewed.
- No ambiguity on which field is authoritative.
- Milestone scope and temporary coverage policy accepted for branch execution.

## Phase 1: Extract shared contracts/parsers
Deliverables:
- `src/core/contracts/records.ts` replacing mux-scoped parser path.
- `ControlPlaneService` switched to core contracts.

Tasks:
- Move `parseConversationRecord`/related parsers out of `src/mux/live-mux/control-plane-records.ts`.
- Update imports in services and runtime.
- Keep strict typing; no `any`.

Tests:
- Parser unit tests moved/added in core contract test file.
- Regression tests for malformed payload rejection.

Exit criteria:
- No runtime/service import depends on mux parser path.
- Control-plane contract ownership is domain-centered (no mux-coupled parser references).

## Phase 2: Introduce shared store + pure reducers
Deliverables:
- `createHarnessStore()` (vanilla Zustand) in core.
- `applyObservedEvent` reducer with cursor idempotency guard.
- Separate UI-local slice and synced slice.

Tasks:
- Model synced entities (`conversations`, `directories`, `repositories`, `tasks`, stream cursor).
- Model UI-local entities (pane mode, selected conversation, modal/expansion state).
- Move non-serializable session objects to runtime registry.

Tests:
- Reducer tests for event ordering, duplicate cursor, delete/archive flows.
- Store action tests for deterministic transitions.

Exit criteria:
- Reducers are pure and test-covered.
- Runtime objects are absent from Zustand state.
- Store API is consumed through explicit domain/service adapters, not broad option-bag relays.

## Phase 3: TUI adapter migration
Deliverables:
- TUI runtime wires envelopes -> store actions.
- TUI render invalidation subscribes to minimal selectors.
- Input handlers receive store/actions via explicit dependencies.

Tasks:
- Replace module/global state references with injected store accessors.
- Introduce stable/memoized selectors for thread/task/project lists.
- Implement optimistic+rollback wrapper for command dispatch.

Tests:
- Integration tests for conversation selection attach failure -> resync path.
- Render invalidation tests proving non-active chatter does not trigger excessive redraw.
- Existing UI behavior tests still pass.

Exit criteria:
- TUI behavior unchanged from user perspective.
- No module-scoped implicit store in handlers.
- Render and input paths delegate to domain services/selectors rather than mixed runtime glue.

## Phase 4: Web adapter proof of parity
Deliverables:
- Minimal React app adapter using same core store + reducers.
- Shared control-plane client subscription path.

Tasks:
- Implement selector hooks with stable equality.
- Implement status presentation mapping for web (chips/badges from semantic fields).
- Verify parity for core operations: list/open conversation, session status updates, task updates.

Tests:
- Adapter-level tests for selectors and event application.
- End-to-end parity smoke checks against same control-plane instance.

Exit criteria:
- Same command/event stream drives both TUI and web clients.
- Shared selectors/contracts are domain-owned and reused by both adapters.

## Phase 5: Protocol cleanup (breaking-change prep)
Deliverables:
- Remove `phaseHint` from canonical status model and use `activityHint` semantics.
- Optional removal of `glyph`/`badge` from canonical protocol model.

Tasks:
- Remove deprecated status-hint overlap and keep one telemetry hint field.
- Remove presentation fields once both first-party clients no longer consume them.

Tests:
- Protocol parsing compatibility tests across transition versions.

Exit criteria:
- Canonical protocol contains semantic state only.
- Temporary relaxed branch quality gates are removed.

## Cross-Cutting Quality Gates
- Bun-only commands for lint/test/coverage.
- No skipped tests.
- `design.md` and `behavior.md` kept in sync with implemented behavior.
- No dead code retention after each phase completion.

## Temporary Coverage Policy (Branch-Scoped)
Scope: active only on `jm/client-abstraction` during refactor milestones.

### Refactor window policy
- Global 100% coverage gate is temporarily relaxed on this branch.
- Coverage reports still run on every milestone and are tracked in PR notes.
- New or changed behavior still requires targeted tests (especially reducers/contracts/runtime boundaries).
- Lint/typecheck remain strict gates.

### Re-tightening milestones
1. After Phase 2 completion (shared contracts + store/reducers in place): enforce minimum 90% global statement/branch coverage and 100% for new `src/core/*` modules.
2. After Phase 4 completion (TUI + web parity on shared state path): raise to 95% global minimum.
3. Before merge to `main` (post-Phase 5): restore full 100% project standard.

## Milestone-Sized Delivery Slices
1. Slice A: Contract extraction + status semantics freeze + service import migration (`src/core/contracts/*` live and used).
2. Slice B: Shared store/reducer introduction + TUI adapter cutover (TUI fully driven by shared store path).
3. Slice C: Web adapter parity + protocol/presentation cleanup + coverage gate restoration.

## Execution Log
- 2026-02-21 (Slice A completed):
  - Moved control-plane record parsers to `src/core/contracts/records.ts`.
  - Updated runtime/service imports to consume core contracts.
  - Migrated parser tests to `test/core-contracts-records.test.ts`.
- 2026-02-21 (Slice B started):
  - Refactored `RuntimeEnvelopeHandler` to use one observed-event callback (`applyObservedEvent`) instead of split workspace/git/task wiring callbacks.
  - Added per-subscription cursor idempotency guard for `stream.event` envelopes (duplicate or regressed cursors are ignored).
  - Extracted cursor monotonicity logic into pure core reducer state (`src/core/state/observed-stream-cursor.ts`) with dedicated tests.
  - Updated runtime wiring in `src/mux/runtime-app/codex-live-mux-runtime.ts` to delegate observed stream events through one domain callback.
  - Added regression coverage in `test/services-runtime-envelope-handler.test.ts` for duplicate-cursor suppression and monotonic replay handling.
- 2026-02-21 (Slice B progress):
  - Added pure synced observed-event reducer in `src/core/state/synced-observed-state.ts` for directory/conversation/repository/task/session-status projection.
  - Added vanilla Zustand synced store in `src/core/store/harness-synced-store.ts` with per-subscription cursor monotonicity gating.
  - Rewired runtime observed-event path to feed the shared core store first, then delegate existing runtime services for current TUI parity.
  - Shifted cursor idempotency ownership out of `RuntimeEnvelopeHandler` into the shared store path to avoid duplicated cursor-gating logic.
- 2026-02-21 (Slice B milestone progress):
  - Replaced event-level duplicate reducers in `WorkspaceObservedEvents` and `TaskPlanningObservedEvents` with synced projection services (`WorkspaceSyncedProjection`, `TaskPlanningSyncedProjection`) driven by core reducer outputs.
  - Runtime observed-event wiring now applies canonical synced reductions directly to workspace/task domain projections, removing second-pass parsing from TUI runtime wiring.
  - `RuntimeWorkspaceObservedEvents` remains the post-reduction UI/fallback coordinator, preserving active/selected conversation fallback semantics while consuming reducer output from core state.
  - Full quality gate revalidated after projection cutover: `bun run typecheck`, `bun run lint`, and `bun run test:coverage` all passed at `100/100/100`.
- 2026-02-21 (Slice B structural cleanup):
  - Removed reducer-forwarding responsibility from `RuntimeWorkspaceObservedEvents`; runtime now applies `workspaceSyncedProjection` at the composition call site and passes explicit store transitions (`previous`/`current` + removed ids) into workspace fallback policy handling.
  - Extended `HarnessSyncedStoreApplyResult` with `previousState` so post-reduction coordinators can react to transitions without pre-apply snapshot plumbing.
  - Replaced render-surface `() => ReadonlyMap` thunk shims with one per-frame render snapshot contract (`readRenderSnapshot`) in `RuntimeRenderPipeline`; `RuntimeLeftRailRender` and `RuntimeRightPaneRender` now receive concrete snapshot state per render call.
  - Converted session status hint field from `phaseHint` to `activityHint` across protocol, reducers, normalizers, and tests; removed dead parse branch and restored full coverage.
  - Revalidated quality gates after the cleanup slice: `bun run typecheck`, `bun run lint`, and `bun run test:coverage` passed at `100/100/100`.
- 2026-02-21 (Slice B event/subscription cleanup):
  - Moved workspace fallback coordination to a synced-store subscription boundary: `RuntimeWorkspaceObservedEvents` now subscribes to `HarnessSyncedStore` state transitions and no longer receives observed-event payloads.
  - Transition deltas (removed conversations/directories) are derived from `previous/current` synced store state within the subscriber, removing call-site relay glue.
  - Routed workspace reaction async side effects (unsubscribe + fallback activation) through queued async reactions (`enqueueAsyncReaction`) instead of inline fire-and-forget calls.
  - Wired lifecycle cleanup into `RuntimeShutdownService` (`stopWorkspaceObservedEvents`) so store subscriptions are always detached on shutdown.
  - Revalidated quality gates for this slice: `bun run typecheck`, `bun run lint`, and `bun run test:coverage` passed at `100/100/100`.
- 2026-02-21 (Slice B sequencing cleanup):
  - Extracted observed-event projection sequencing out of `codex-live-mux-runtime.ts` into `src/services/runtime-observed-event-projection-pipeline.ts` with explicit ordering and cursor short-circuit invariants.
  - Runtime observed-event handling now delegates to the pipeline service; call-site glue no longer owns synced-store gating + workspace/task/git projection ordering logic.
  - Preserved explicit non-synced directory git projection boundary in the pipeline (`applyDirectoryGitProjection`).
  - Added focused tests in `test/services-runtime-observed-event-projection-pipeline.test.ts` for cursor-regression short-circuit and canonical projection order.
  - Revalidated quality gates for this slice: `bun run typecheck`, `bun run lint`, and `bun run test:coverage` passed at `100/100/100`.
- 2026-02-21 (Slice B render/input state boundary cleanup):
  - Removed `latestRailViewRows` from `WorkspaceModel`; render-produced rail rows now live in dedicated runtime state (`src/services/runtime-rail-view-state.ts`).
  - Runtime render pipeline writes latest rail rows to `RuntimeRailViewState`, and left-nav / rail-pointer handlers consume that concrete state object directly instead of closure shims.
  - Updated `packages/harness-ui/src/interaction/left-nav-input.ts` and `src/services/left-rail-pointer-handler.ts` to read rail rows via `railViewState`.
  - Added `test/services-runtime-rail-view-state.test.ts` and updated affected input/render tests and startup integration suites.
- 2026-02-21 (Slice B render-state domain lookup cleanup):
  - Refactored `RuntimeRenderState` to consume concrete domain lookups (`directories`, `conversations`) instead of callback triplets (`hasDirectory`, `activeConversationId`, `activeConversation`).
  - Runtime composition now injects `directoryManager` and `conversationManager` directly into render-state evaluation.
  - Updated `test/services-runtime-render-state.test.ts` and `test/services-runtime-render-pipeline.test.ts` to verify behavior with the new domain lookup contracts.
- 2026-02-21 (Slice B parser and render-snapshot cleanup):
  - Consolidated runtime status-model parsing to one canonical parser: `parseStreamSessionStatusModel` in `src/core/contracts/records.ts`.
  - Removed duplicate status-model parser implementations from `src/control-plane/agent-realtime-api.ts` and `src/control-plane/session-summary.ts`; both now delegate to core contracts.
  - Clarified workspace-reaction queue semantics by renaming to `enqueueQueuedReaction` in `RuntimeWorkspaceObservedEvents`, with coverage proving non-inline subscriber behavior in `test/services-runtime-workspace-observed-events.test.ts`.
  - Clarified in `src/services/runtime-render-pipeline.ts` that `readRenderSnapshot` is a frame-local TUI optimization, not the shared cross-client data access pattern.
  - Added immutable task-composer snapshotting (`src/services/runtime-task-composer-snapshot.ts`) so right-pane render snapshots do not retain live task-composer map references.
- 2026-02-21 (Slice B final transition/effects split):
  - Split workspace observed coordination into explicit collaborators:
    - transition policy: `src/services/runtime-workspace-observed-transition-policy.ts`
    - queued side-effect executor: `src/services/runtime-workspace-observed-effect-queue.ts`
    - subscriber orchestration only: `src/services/runtime-workspace-observed-events.ts`
  - Moved removed-id diffing out of the store subscriber into the transition policy so subscriber code no longer computes transition deltas.
  - Rewired runtime composition (`src/mux/runtime-app/codex-live-mux-runtime.ts`) to construct and inject policy + effect queue directly.
  - Updated `test/services-runtime-workspace-observed-events.test.ts` to validate new execution ordering and queued-reaction non-reentrancy semantics.
- 2026-02-21 (Slice C scaffold started: adapter boundaries):
  - Added a concrete TUI adapter module for frame-local render snapshots: `src/clients/tui/render-snapshot-adapter.ts`.
  - Runtime render pipeline now reads snapshots from `TuiRenderSnapshotAdapter` instead of assembling the snapshot object inline in `codex-live-mux-runtime.ts`.
  - Added a web selector scaffold over `HarnessSyncedStore` in `src/clients/web/synced-selectors.ts`:
    - memoized conversation list selector
    - memoized task list selector
    - directory/by-id selectors
    - store subscription helper for selector-driven updates (`subscribeStoreSelector`)
  - Added adapter tests:
    - `test/clients-tui-render-snapshot-adapter.test.ts`
    - `test/clients-web-synced-selectors.test.ts`
- 2026-02-22 (Slice B input-orchestration extraction):
  - Extracted left-rail input orchestration from `src/mux/runtime-app/codex-live-mux-runtime.ts` into `src/clients/tui/left-rail-interactions.ts`.
  - Runtime composition now delegates `LeftNavInput`, `RepositoryFoldInput`, `GlobalShortcutInput`, and `RailPointerInput` construction to one TUI adapter factory with explicit domain collaborators.
  - Removed runtime-local repository fold and left-rail pointer wiring glue that duplicated repository-group mutation wiring.
  - Wired `mux.debug-bar.toggle` in the TUI shortcut path with explicit UI-state persistence (`queuePersistMuxUiState`) and repaint (`markDirty`) behavior.
  - Added focused adapter coverage in `test/clients-tui-left-rail-interactions.test.ts`.
  - Revalidated this slice with `bun run typecheck`, `bun run lint`, and targeted integration tests (`test/mux-runtime-wiring.integration.test.ts`, `test/codex-live-mux-startup.integration.test.ts`, `test/ui-left-nav-fast-cycle.integration.test.ts`).
- 2026-02-22 (Slice B main-pane input extraction):
  - Extracted main-pane input orchestration from `src/mux/runtime-app/codex-live-mux-runtime.ts` into `src/clients/tui/main-pane-interactions.ts`.
  - Runtime now delegates construction of `MainPanePointerInput`, `PointerRoutingInput`, `ConversationSelectionInput`, `InputTokenRouter`, and `InputPreflight` to one TUI adapter factory.
  - Removed inline ANSI-strip/home-selection helpers and pointer/input strategy wiring from runtime composition root.
  - Preserved escape-routing, task-shortcut selection clearing, and copy-shortcut behavior through the new adapter boundary.
  - Added focused tests in `test/clients-tui-main-pane-interactions.test.ts`.
  - Revalidated this slice with `bun run typecheck`, `bun run lint`, and targeted integration tests (`test/mux-runtime-wiring.integration.test.ts`, `test/codex-live-mux-startup.integration.test.ts`, `test/ui-left-nav-fast-cycle.integration.test.ts`).
- 2026-02-22 (Slice B input-forwarding extraction):
  - Moved `ConversationInputForwarder` assembly and runtime `onInput` orchestration into `src/clients/tui/main-pane-interactions.ts`.
  - Runtime now consumes adapter-provided `handleInput` and no longer wires `parseMuxInputChunk`, `routeInputTokensForConversation`, `classifyPaneAt`, or `normalizeMuxKeyboardInputForPty` directly.
  - Preserved shared modal/input remainder behavior by keeping remainder accessors (`getInputRemainder`/`setInputRemainder`) explicit at the adapter boundary.
  - Added adapter-level forwarding coverage in `test/clients-tui-main-pane-interactions.test.ts` for sanitized text input delivery to active conversation sessions.
  - Revalidated this slice with `bun run typecheck`, `bun run lint`, and targeted integration tests (`test/mux-runtime-wiring.integration.test.ts`, `test/codex-live-mux-startup.integration.test.ts`, `test/ui-left-nav-fast-cycle.integration.test.ts`).

## Immediate Next Slice (Slice B)
1. Continue reducing runtime composition writes to workspace/domain state by promoting transition-driven coordinators over inline mutation in render/input wiring.
2. Preserve directory git-status handling as an explicit non-synced projection path and document that boundary in behavior docs.
3. Start web-adapter parity scaffold against the same shared store/reducer path (selectors + status presentation mapping).

## Risks and Mitigations
- Risk: Status semantics drift during migration.
  Mitigation: enforce one authoritative source (`phase`) and contract tests.
- Risk: TUI perf regression due to broad subscriptions.
  Mitigation: scoped selectors + render-invalidation benchmarks.
- Risk: optimistic UI divergence.
  Mitigation: command wrapper with standard rollback/resync behavior.

## Coverage Baseline
- Captured on: 2026-02-21
- Command: `bun run test:coverage`
- Result: `1689` pass, `0` fail
- Result (latest): `1701` pass, `0` fail
- Coverage gate result: passed
- Global coverage at baseline: lines `100.00`, functions `100.00`, branches `100.00`
