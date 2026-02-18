# Codex Live Mux Refactor Plan (Temporary)

Status: active
Owner: codex + jmoyers
Last updated: 2026-02-18
Delete this file after the refactor is complete.

## Why This Plan Changed

The previous approach extracted helpers but did not change ownership boundaries enough. This plan pivots to responsibility-first decomposition so state and behavior move together.

## Primary Goals

- Preserve pre-refactor interactive behavior (left rail + split pane + input parity).
- Refactor by responsibility, not by existing file boundaries.
- Reach and enforce LOC target: no source file above 2000 non-empty LOC.
- Keep human/client behavior equivalent with control-plane parity.

## Architectural Target (Codified)

```text
src/
  domain/
    conversations.ts      # ConversationManager — owns Map, lifecycle, status transitions
    repositories.ts       # RepositoryManager — repos, associations, git state, folding
    tasks.ts              # TaskManager — tasks, reordering, composers, autosave
    directories.ts        # DirectoryManager — directory records, git state sync
    workspace.ts          # WorkspaceModel — coordinates managers, owns shared state

  services/
    control-plane.ts      # ControlPlaneService — wraps streamClient, returns domain objects
    event-store.ts        # EventPersistence — batched writes, flush logic
    recording.ts          # RecordingService — recording writer + oracle

  ui/
    screen.ts             # Screen — layout, render loop, dirty tracking, cursor state
    panes/
      conversation.ts     # ConversationPane — render + input for terminal view
      project.ts          # ProjectPane — render + input for project view
      home.ts             # HomePane — render + input for task-focused view
      left-rail.ts        # LeftRail — navigation rail render + input
    modals/
      manager.ts          # ModalManager — overlay lifecycle, dismiss, priority
      new-thread.ts
      task-editor.ts
      ...
    input.ts              # InputRouter — focus events, shortcut detection, pane dispatch

  runtime.ts              # Thin bootstrap: create domain -> create services -> create UI -> run
```

## Design Rules For This Refactor

- State ownership is explicit: each manager/class owns its own maps and lifecycle.
- Domain emits state-change events; UI subscribes and marks dirty.
- Services return validated domain objects, not raw stream records.
- Runtime is composition/wiring only, not feature logic.
- No feature behavior changes unless explicitly planned and tested.

## Refactor Order (Best Yield + Lowest Risk)

1. Workspace model first
   - Extract mutable runtime variables into `WorkspaceModel`.
   - Keep current call sites working through adapters.
   - Exit criteria: runtime state surface is centralized.

2. Conversation manager
   - Move conversation maps/lifecycle/start/activate/archive/remove ownership into `ConversationManager`.
   - Replace threaded callback bundles with manager methods.
   - Exit criteria: conversation logic leaves runtime body.

3. Repository + directory managers
   - Introduce `RepositoryManager` and `DirectoryManager` with owned state + git sync behaviors.
   - Unify repository fold/association operations behind manager APIs.
   - Exit criteria: repository/directory mutations happen only through managers.

4. Task manager
   - Move task ordering/composer/autosave logic into `TaskManager`.
   - Keep existing task UI behavior intact.
   - Exit criteria: task actions route through task manager API.

5. Control plane service
   - Create `ControlPlaneService` wrappers for stream operations.
   - Consolidate record parsing/validation in service layer.
   - Exit criteria: runtime/actions stop parsing raw records directly.

6. Screen extraction
   - Move render loop, diffing, cursor writes, dirty tracking to `ui/screen.ts`.
   - Keep draw output equivalent.
   - Exit criteria: runtime no longer directly implements frame assembly.

7. Pane extraction
   - Introduce pane interfaces and move Home/Project/Conversation/LeftRail rendering and input handling into pane modules.
   - Exit criteria: active pane handles its own render/input dispatch.

8. Modal manager + input router
   - Centralize modal lifecycle in `ui/modals/manager.ts`.
   - Centralize keyboard/mouse dispatch in `ui/input.ts`.
   - Exit criteria: runtime no longer contains modal/input branching trees.

9. Thin runtime
   - Replace legacy glue with `src/runtime.ts` bootstrap wiring only.
   - Remove obsolete intermediate helpers once covered by tests.
   - Exit criteria: runtime is thin and all files pass LOC gate.

## Verification Gates (Required)

Run at every checkpoint:

```bash
bun run typecheck
bun run lint
bun test test/codex-live-mux-startup.integration.test.ts
bun test test/mux-runtime-wiring.integration.test.ts
bun run loc:verify
```

Run every 2-3 checkpoints and before merging:

```bash
bun run verify
bun run perf:mux:hotpath
bun run perf:mux:startup
bun run loc:verify:enforce
```

## Manual Equivalence Checklist (Per Phase)

- Left rail selection changes active pane correctly.
- Split pane remains visible and interactive.
- Mouse click/scroll behavior matches baseline in rail and content panes.
- Keyboard shortcuts still operate in expected focus contexts.
- Modal open/edit/submit/cancel flows remain unchanged.
- Conversation archive/takeover/new-thread flows match baseline.

## Current State Snapshot

- Current over-limit files:
  - `scripts/codex-live-mux-runtime.ts` (~3668 non-empty LOC)
  - `src/control-plane/stream-server.ts` (~2145 non-empty LOC)
- Existing extracted modules under `src/mux/live-mux/*` are transitional and should be absorbed into domain/service/ui ownership above.
- `scripts/check-max-loc.ts` now prints responsibility-first refactor guidance in advisory and enforce modes.

## Execution Tracker

- [x] Pivot accepted: responsibility-first architecture codified.
- [x] Phase 1: WorkspaceModel extraction completed.
- [~] Phase 2: ConversationManager extraction in progress.
- [~] Phase 3: RepositoryManager + DirectoryManager extraction in progress.
- [x] Phase 4: TaskManager extraction.
- [~] Phase 5: ControlPlaneService extraction.
- [~] Phase 6: Screen extraction in progress.
- [~] Phase 7: Pane extraction in progress.
- [~] Phase 8: ModalManager + InputRouter extraction in progress.
- [ ] Phase 9: Thin runtime + cleanup + strict gates.

## Notes

- Avoid helper-fragment churn; each extraction must reduce runtime responsibility and improve ownership clarity.
- Do not carry parallel legacy paths longer than one checkpoint after equivalent behavior is verified.
- If any phase causes UI parity regression, halt and fix before continuing.
- Second-pass target after Phase 8 extraction: collapse callback/options bags so UI input modules depend on domain managers/services via constructor-owned references instead of runtime closure callbacks.

## Checkpoint Log

### Checkpoint A (2026-02-18): WorkspaceModel state-surface start

- Added `src/domain/workspace.ts` with a class-based `WorkspaceModel` and typed ownership for:
  - active directory and pane mode state
  - left-nav selection and repository selection state
  - repository-group and shortcuts collapsed UI state
  - project/home pane scroll + selected task/repository state
  - task-pane focus/notice/edit-click/drag state
  - modal/selection state fields staged for follow-up migration
- Updated `scripts/codex-live-mux-runtime.ts` to initialize one `WorkspaceModel` instance and route core navigation/task-pane state reads/writes through it (instead of free mutable locals).
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4674 non-empty LOC

### Checkpoint B (2026-02-18): ConversationManager lifecycle state start

- Added `src/domain/conversations.ts` with a class-based `ConversationManager` that owns:
  - conversation record map
  - in-flight start task map
  - removed conversation id set
  - active conversation id field (staged for fuller ownership migration)
- Updated `scripts/codex-live-mux-runtime.ts` to use `ConversationManager` for:
  - removed-conversation tracking (`clearRemoved`, `isRemoved`, `remove`)
  - in-flight conversation-start tracking (`getStartInFlight`, `setStartInFlight`, `clearStartInFlight`)
  - canonical ordered conversation id reads (`orderedIds`)
  - synchronized active id updates at key assignment points (staged migration)
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4676 non-empty LOC

### Checkpoint C (2026-02-18): ConversationManager ensure/active ownership

- Extended `src/domain/conversations.ts` with class-owned lifecycle behavior:
  - `ensure(...)` now owns conversation creation/update hydration semantics
  - `requireActiveConversation()` now owns active-session presence validation
- Updated `scripts/codex-live-mux-runtime.ts` to delegate:
  - `ensureConversation(...)` to `conversationManager.ensure(...)`
  - active-conversation resolution to `conversationManager.requireActiveConversation()`
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4649 non-empty LOC

### Checkpoint D (2026-02-18): ConversationManager start in-flight ownership

- Extended `src/domain/conversations.ts` with `runWithStartInFlight(...)` so the manager owns in-flight start deduplication behavior.
- Updated `scripts/codex-live-mux-runtime.ts` to delegate `startConversation(...)` in-flight guards to `conversationManager.runWithStartInFlight(...)`.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4639 non-empty LOC

### Checkpoint E (2026-02-18): ConversationManager active-id source of truth

- Updated `scripts/codex-live-mux-runtime.ts` to remove duplicate local active-session state and use `conversationManager.activeConversationId` directly as the single runtime source of truth.
- Cleaned call-site payloads to pass explicit `activeConversationId` fields where needed after the ownership shift.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4632 non-empty LOC

### Checkpoint F (2026-02-18): ConversationManager persisted-record hydration

- Extended `src/domain/conversations.ts` with:
  - `PersistedConversationRecord` type
  - `upsertFromPersistedRecord(...)` lifecycle method
- Updated `scripts/codex-live-mux-runtime.ts` persisted hydration path to delegate record upsert semantics to `conversationManager.upsertFromPersistedRecord(...)`.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4623 non-empty LOC

### Checkpoint G (2026-02-18): ConversationManager exit transition ownership

- Extended `src/domain/conversations.ts` with `markSessionExited(...)` so exit-status transitions are class-owned.
- Updated `scripts/codex-live-mux-runtime.ts` to use `conversationManager.markSessionExited(...)` in both `pty.event` (`session-exit`) and `pty.exit` handlers.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4621 non-empty LOC

### Checkpoint H (2026-02-18): ConversationManager PTY output ingest ownership

- Extended `src/domain/conversations.ts` with `ingestOutputChunk(...)` so output cursor regression handling + oracle ingest state mutation are class-owned.
- Updated `scripts/codex-live-mux-runtime.ts` `pty.output` envelope handling to call `conversationManager.ingestOutputChunk(...)` and consume structured regression metadata for instrumentation.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4624 non-empty LOC

### Checkpoint I (2026-02-18): ConversationManager controller/attachment ownership

- Extended `src/domain/conversations.ts` with:
  - `setAttached(...)`
  - `markSessionUnavailable(...)`
  - `isControlledByLocalHuman(...)`
- Updated `scripts/codex-live-mux-runtime.ts` to delegate:
  - attach/detach attached-flag state transitions
  - session-not-live fallback transitions during activation retries
  - local-human control guard checks
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4610 non-empty LOC

### Checkpoint J (2026-02-18): ConversationManager attach/detach flow ownership

- Extended `src/domain/conversations.ts` with:
  - `attachIfLive(...)`
  - `detachIfAttached(...)`
- Updated `scripts/codex-live-mux-runtime.ts` attach/detach flow to delegate live/attached guards and state transitions through manager methods, while retaining stream command and perf event emission in runtime.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4605 non-empty LOC

### Checkpoint K (2026-02-18): ConversationManager summary/active-id ownership

- Extended `src/domain/conversations.ts` with:
  - `upsertFromSessionSummary(...)`
  - `setActiveConversationId(...)`
  - `ensureActiveConversationId(...)`
- Updated `scripts/codex-live-mux-runtime.ts` to delegate:
  - session summary hydration (`session.status` + `session.list`) through manager APIs
  - active-id bootstrap and mutation through manager setters
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4606 non-empty LOC

### Checkpoint L (2026-02-18): ConversationManager query API adoption

- Extended `src/domain/conversations.ts` with query/update helpers:
  - `getActiveConversation()`
  - `directoryIdOf(...)`
  - `isLive(...)`
  - `setController(...)`
  - `setLastEventAt(...)`
  - `findConversationIdByDirectory(...)`
- Updated `scripts/codex-live-mux-runtime.ts` to replace callback/threaded map access with manager API calls across:
  - archive/takeover wiring
  - add-directory + close-directory wiring
  - left-nav activation/global shortcut conversation lookups
  - active conversation resolution in render/input paths
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4597 non-empty LOC

### Checkpoint M (2026-02-18): Runtime direct map access removal

- Updated `scripts/codex-live-mux-runtime.ts` to remove direct `conversations.get/has` access; runtime now uses `ConversationManager` APIs for conversation reads/guards.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4597 non-empty LOC

### Checkpoint N (2026-02-18): Active conversation access cleanup

- Updated `scripts/codex-live-mux-runtime.ts` to use `conversationManager.getActiveConversation()` for pin/copy/escape flows and removed dead `activeConversation()` wrapper.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4598 non-empty LOC

### Checkpoint O (2026-02-18): RepositoryManager extraction start

- Added `src/domain/repositories.ts` with class-owned repository state maps and helpers:
  - repository records map
  - directory->repository association map
  - directory git snapshot map
  - repository group resolution + directory sync methods
- Updated `scripts/codex-live-mux-runtime.ts` to instantiate/use `RepositoryManager` and delegate:
  - directory git-status hydration map writes
  - repository association/snapshot sync behavior
  - repository group id resolution
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4586 non-empty LOC

### Checkpoint P (2026-02-18): ConversationManager escape-hatch tightening

- Extended `src/domain/conversations.ts` to harden manager ownership:
  - internal map renamed to private `conversationsBySessionId`
  - added read-only exposure + query helpers (`readonlyMap()`, `values()`, `size()`)
  - moved `ensure(...)` behavior dependencies to manager-owned configuration via `configureEnsureDependencies(...)`
  - simplified `ensure(...)` call shape to `ensure(sessionId, seed?)`
- Updated `scripts/codex-live-mux-runtime.ts` to:
  - remove direct `conversationManager.conversations` access
  - use explicit transitional alias `_unsafeConversationMap` from `readonlyMap()` at helper boundaries
  - configure conversation creation/normalization dependencies once at startup
  - use manager-native iteration/count APIs where direct map reads were unnecessary
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4585 non-empty LOC

### Checkpoint Q (2026-02-18): DirectoryManager extraction start

- Added `src/domain/directories.ts` with class-owned directory and git-summary state:
  - directory record map + active-directory helpers (`firstDirectoryId`, `resolveActiveDirectoryId`)
  - git-summary map + synchronization helpers (`ensureGitSummary`, `syncGitSummariesWithDirectories`)
- Updated `scripts/codex-live-mux-runtime.ts` to instantiate/use `DirectoryManager` and delegate:
  - directory map lifecycle operations (hydrate/set/get/has/delete/size/keys)
  - active-directory resolution through manager API
  - git-summary defaulting/sync through manager API
  - helper callsites now consume `_unsafeDirectoryMap` / `_unsafeDirectoryGitSummaryMap` transitional views
- Added unit coverage in `test/domain-directories.test.ts` for:
  - active-directory resolution semantics
  - git-summary synchronization with directory lifecycle
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/domain-directories.test.ts`: 2 pass / 0 fail
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4582 non-empty LOC

### Checkpoint R (2026-02-18): Strict dead-code hygiene + full-verify cadence

- Kept dead-code gate strict and moved toward compliance instead of relaxing thresholds:
  - dead exported type surfaces removed where no external use existed
  - dead helper exports/functions removed from transitional mux modules
  - dead-code checker now scans `scripts/**/*.ts` imports so script-owned runtime modules are treated as live references
- Added/refined targeted unit tests:
  - `test/domain-directories.test.ts` expanded to exercise all `DirectoryManager` public methods
  - `test/mux-live-mux-selection.test.ts` now covers `reduceConversationMouseSelection(...)` branches
  - `test/mux-live-mux-rail-layout.test.ts` now covers repository snapshot merge and missing-session filtering paths
- Validation at checkpoint:
  - `bun run lint`: pass
  - `bun run typecheck`: pass
  - `bun scripts/check-dead-code.ts`: pass
  - `bun run verify`: **fails at `coverage:check` only**
    - remaining blocker: missing coverage-report entries for 34 transitional mux/domain files
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4582 non-empty LOC

### Checkpoint S (2026-02-18): Repository manager hardening + high-yield coverage debt burn-down

- Hardened manager ownership in `src/domain/repositories.ts`:
  - repository/association/snapshot maps are now private
  - transitional accessors are explicitly named unsafe
  - added explicit `clearRepositories()` lifecycle helper
- Updated `scripts/codex-live-mux-runtime.ts` to consume `RepositoryManager` unsafe transitional accessors instead of direct public map fields.
- Added focused coverage suites for extracted and transitional modules:
  - `test/domain-repositories.test.ts`
  - `test/domain-workspace.test.ts`
  - `test/mux-live-mux-uncovered-small.test.ts`
  - `test/mux-live-mux-uncovered-dispatchers.test.ts`
- Expanded existing suites to close per-file deficits:
  - `test/mux-live-mux-actions-conversation.test.ts`
  - `test/mux-live-mux-conversation-state.test.ts`
  - `test/config-core.test.ts`
- Validation at checkpoint:
  - `bun run lint`: pass
  - `bun run typecheck`: pass
  - `bun scripts/check-dead-code.ts`: pass
  - `bun run verify`: **fails at `coverage:check` only**
    - remaining missing coverage-report entries reduced from 34 -> 10 files
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4582 non-empty LOC

### Checkpoint T (2026-02-18): Strict verify fully green while keeping dead-code gate tight

- Kept the dead-code gate strict and drove full compliance to green without loosening thresholds.
- Added full-coverage suites for previously missing modules:
  - `test/domain-conversations.test.ts`
  - `test/mux-live-mux-actions-repository.test.ts`
  - `test/mux-live-mux-repository-folding.test.ts`
  - `test/mux-live-mux-task-pane-shortcuts.test.ts`
  - `test/mux-live-mux-terminal-palette.test.ts`
- Expanded targeted suites to close residual uncovered-line deficits:
  - `test/mux-live-mux-uncovered-modals.test.ts`
  - `test/agent-session-state.test.ts`
  - `test/control-plane-stream-server-split-modules.test.ts`
  - `test/cursor-managed-hooks.test.ts`
  - `test/mux-live-mux-conversation-state.test.ts`
- Small coverage-accounting cleanups:
  - added explicit constructor in `src/domain/conversations.ts` so class function coverage is fully explicit
  - tightened formatting in `src/cursor/managed-hooks.ts` path helper to remove a persistent uncovered mapping line
- Validation at checkpoint:
  - `bun run lint`: pass
  - `bun run typecheck`: pass
  - `bun scripts/check-dead-code.ts`: pass
  - `bun run verify`: **pass**
    - `coverage check passed for 100 files`
    - `global lines=100.00 functions=100.00 branches=100.00`
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4582 non-empty LOC

### Checkpoint U (2026-02-18): Repository fold ownership moved into RepositoryManager

- Continued Phase 3 ownership work by moving repository fold state out of runtime locals and into `RepositoryManager`.
- Extended `src/domain/repositories.ts` with class-owned fold state + methods:
  - `readonlyCollapsedRepositoryGroupIds()`
  - `collapseRepositoryGroup(...)`
  - `expandRepositoryGroup(...)`
  - `toggleRepositoryGroup(...)`
  - `collapseAllRepositoryGroups()`
  - `expandAllRepositoryGroups()`
- Updated `scripts/codex-live-mux-runtime.ts`:
  - removed local `collapsedRepositoryGroupIds` / `expandedRepositoryGroupIds` state
  - delegated fold mutations and collapse/expand-all actions to manager APIs
  - rail rendering now consumes `repositoryManager.readonlyCollapsedRepositoryGroupIds()`
- Expanded `test/domain-repositories.test.ts` to cover manager-owned fold transitions.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun run verify`: pass
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4598 non-empty LOC

### Checkpoint V (2026-02-18): WorkspaceModel now owns left-nav transitions

- Continued Phase 1/3 boundary cleanup by moving navigation state transitions into `WorkspaceModel`.
- Extended `src/domain/workspace.ts` with explicit methods:
  - `selectLeftNavHome()`
  - `selectLeftNavRepository(...)`
  - `selectLeftNavProject(...)`
  - `selectLeftNavConversation(...)`
- Updated `scripts/codex-live-mux-runtime.ts` to call workspace-owned transition methods instead of ad-hoc local closure functions.
- Expanded `test/domain-workspace.test.ts` to cover the new state transition methods.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun run verify`: pass
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4581 non-empty LOC

### Checkpoint W (2026-02-18): Task map ownership moved into TaskManager

- Started Phase 4 by moving runtime-owned task map lifecycle into `TaskManager`.
- Added `src/domain/tasks.ts` with class-owned task state APIs:
  - `readonlyTasks()`
  - `values()`
  - `getTask(...)`
  - `hasTask(...)`
  - `setTask(...)`
  - `deleteTask(...)`
  - `clearTasks()`
- Updated `scripts/codex-live-mux-runtime.ts` to delegate task map reads/writes through `TaskManager` instead of a direct local `Map`.
- Added `test/domain-tasks.test.ts` to cover manager lifecycle and CRUD methods.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun run verify`: pass
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4583 non-empty LOC

### Checkpoint X (2026-02-18): Task composer buffer ownership moved into TaskManager

- Continued Phase 4 by moving per-task editor buffer state into `TaskManager`.
- Extended `src/domain/tasks.ts` with composer buffer APIs:
  - `readonlyTaskComposers()`
  - `getTaskComposer(...)`
  - `setTaskComposer(...)`
  - `deleteTaskComposer(...)`
  - `clearTaskComposers()`
- Updated `scripts/codex-live-mux-runtime.ts` to delegate task editor buffer reads/writes through `TaskManager` instead of a standalone runtime map.
- Expanded `test/domain-tasks.test.ts` to cover composer buffer lifecycle methods.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun run verify`: pass
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4582 non-empty LOC

### Checkpoint Y (2026-02-18): Task autosave timer ownership moved into TaskManager

- Continued Phase 4 by moving per-task autosave timer state into `TaskManager`.
- Extended `src/domain/tasks.ts` with autosave timer APIs:
  - `autosaveTaskIds()`
  - `getTaskAutosaveTimer(...)`
  - `setTaskAutosaveTimer(...)`
  - `deleteTaskAutosaveTimer(...)`
  - `clearTaskAutosaveTimers()`
- Updated `scripts/codex-live-mux-runtime.ts` autosave lifecycle to delegate timer map reads/writes through `TaskManager`.
- Expanded `test/domain-tasks.test.ts` to cover autosave timer lifecycle methods.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun run verify`: pass
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4581 non-empty LOC

### Checkpoint Z (2026-02-18): Task reorder semantics moved into TaskManager

- Continued Phase 4 by moving task ordering/repository-filter/reorder payload semantics into `TaskManager`.
- Extended `src/domain/tasks.ts` with class-owned methods:
  - `orderedTasks(...)`
  - `tasksForRepository(...)`
  - `taskReorderPayloadIds(...)`
  - `reorderedActiveTaskIdsForDrop(...)`
- Updated `scripts/codex-live-mux-runtime.ts` to delegate:
  - selected-repository task list derivation
  - task reorder payload assembly for `task.reorder`
  - drag-drop task reorder validation + active-task id reordering
- Expanded `test/domain-tasks.test.ts` to cover new ordering/reorder behavior and edge cases.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun run verify`: pass
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4580 non-empty LOC

### Checkpoint AA (2026-02-18): ControlPlaneService extraction start for task/repository flows

- Started Phase 5 with a class-based `ControlPlaneService` under `src/services/control-plane.ts`.
- Added service-owned command wrappers + parsing for:
  - `repository.list`
  - `task.list`
  - `task.create`
  - `task.update`
  - `task.ready`
  - `task.draft`
  - `task.complete`
  - `task.reorder`
  - `task.delete`
- Updated `scripts/codex-live-mux-runtime.ts` to route task/repository planning operations through `ControlPlaneService` instead of issuing/parsing raw stream commands at runtime callsites.
- Added `test/services-control-plane.test.ts` with success + malformed-payload coverage for all service methods.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun run verify`: pass
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4498 non-empty LOC

### Checkpoint AB (2026-02-18): ControlPlaneService expands to directory/conversation metadata flows

- Continued Phase 5 by extending `ControlPlaneService` to cover directory/conversation metadata operations:
  - `directory.upsert`
  - `directory.list`
  - `directory.archive`
  - `conversation.list`
  - `conversation.create`
  - `conversation.update` (title)
  - `conversation.archive`
- Updated `scripts/codex-live-mux-runtime.ts` to delegate startup and project-metadata command flows through the service:
  - startup `directory.upsert`
  - directory hydration + path repair upserts
  - persisted conversation hydration by directory
  - conversation title persistence update flow
  - conversation create/archive callbacks in conversation/directory actions
  - directory archive callback
- Expanded `test/services-control-plane.test.ts` with success/malformed coverage for new service methods.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun run verify`: pass
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4441 non-empty LOC

### Checkpoint AC (2026-02-18): ControlPlaneService expands to session/PTy lifecycle wrappers

- Continued Phase 5 by extending `ControlPlaneService` with session/PTy lifecycle wrappers:
  - `pty.attach`
  - `pty.detach`
  - `pty.subscribe-events`
  - `pty.unsubscribe-events`
  - `pty.close`
  - `session.remove`
  - `session.claim` (with parsed controller record output)
- Updated `scripts/codex-live-mux-runtime.ts` callsites to delegate these flows through the service:
  - conversation event subscribe/unsubscribe
  - attach/detach flows
  - stop/archive/close-directory PTY close + session removal flows
  - takeover claim flow
- Expanded `test/services-control-plane.test.ts` to cover new session/PTy service methods including malformed controller parsing fallback.
- Validation at checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun run verify`: pass
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4416 non-empty LOC

### Checkpoint AD (2026-02-18): ControlPlaneService absorbs startup/session hydration + repository mutations

- Continued Phase 5 by extending `ControlPlaneService` wrappers to cover the remaining runtime startup/session hydration and repository mutation commands:
  - `repository.upsert`
  - `repository.update`
  - `repository.archive`
  - `directory.git-status`
  - `pty.start`
  - `session.status`
  - `session.list`
- Updated `scripts/codex-live-mux-runtime.ts` to route these flows through service methods:
  - repository hydration through `listRepositories()`
  - startup git-status hydration through `listDirectoryGitStatuses()`
  - PTY start/session-status startup flow through `startPtySession()` + `getSessionStatus()`
  - live-session hydration through `listSessions(...)`
  - repository priority reorder/update, repository upsert/edit, and repository archive through service wrappers
- Runtime now has zero direct `streamClient.sendCommand(...)` callsites; command dispatch is centralized behind `ControlPlaneService`.
- Expanded `test/services-control-plane.test.ts` for new service wrappers and malformed-payload coverage on repository mutation parsing.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4364 non-empty LOC

### Checkpoint AE (2026-02-18): Phase 6 start with `Screen` abstraction for dirty/render flush state

- Started Phase 6 by introducing `src/ui/screen.ts` with a class-based `Screen` abstraction that owns:
  - dirty state + render scheduling signal (`isDirty`, `markDirty`, `clearDirty`)
  - frame cache/full-clear lifecycle (`resetFrameCache`)
  - terminal flush internals (row diffing, overlay reset writes, cursor style/visibility control, bracketed-paste mode control)
  - ANSI integrity validation/reporting seam
- Updated `scripts/codex-live-mux-runtime.ts` render loop to delegate flush/output responsibilities through `Screen.flush(...)` while keeping pane composition in runtime for now.
- Replaced direct runtime frame-cache mutations (`previousRows`/`forceFullClear`) with `screen.resetFrameCache()` at pane/layout transition points.
- Added `test/ui-screen.test.ts` and drove it to full function/line/branch coverage, including default dependency fallback paths and selection-row merge behavior.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4281 non-empty LOC

### Checkpoint AF (2026-02-18): Phase 7 start with pane render abstractions

- Started Phase 7 by introducing class-based pane render modules:
  - `src/ui/panes/conversation.ts` (`ConversationPane`)
  - `src/ui/panes/home.ts` (`HomePane`)
  - `src/ui/panes/project.ts` (`ProjectPane`)
  - `src/ui/panes/left-rail.ts` (`LeftRailPane`)
- Updated `scripts/codex-live-mux-runtime.ts` render loop to delegate pane rendering to pane classes while preserving existing runtime-owned state transitions.
- Added `test/ui-panes.test.ts` to validate pane seams and fallback behavior.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4286 non-empty LOC

### Checkpoint AG (2026-02-18): Phase 8 start with class-based `ModalManager`

- Started Phase 8 by introducing `src/ui/modals/manager.ts` with class-owned modal responsibilities:
  - overlay builder delegation for new-thread/add-directory/task-editor/repository/conversation-title modals
  - ordered current-overlay resolution
  - outside-click dismiss routing (with input remainder threading and optional inside-click consumption)
- Updated `scripts/codex-live-mux-runtime.ts` to delegate modal overlay assembly and outside-click dismissal through `ModalManager`, removing inline modal orchestration logic from runtime.
- Added `test/ui-modal-manager.test.ts` with default + injected-dependency coverage for priority ordering, dismiss behavior, and constructor dependency seams.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4245 non-empty LOC

### Checkpoint AH (2026-02-18): Phase 8 continues with class-based `InputRouter`

- Added `src/ui/input.ts` with class-based `InputRouter` that owns modal prompt input routing order and prompt-handler wiring for:
  - task editor prompt
  - repository prompt
  - new-thread prompt
  - conversation-title edit prompt
  - add-directory prompt
- Updated `scripts/codex-live-mux-runtime.ts` to delegate modal prompt routing to `InputRouter` and removed inline per-modal input-dispatch functions from runtime.
- Added `test/ui-input-router.test.ts` to cover task-editor submit/dirty/prompt transitions, dispatch short-circuit order, and default dependency behavior.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4174 non-empty LOC

### Checkpoint AI (2026-02-18): Phase 8 continues with class-based repository-fold input routing

- Added `src/ui/repository-fold-input.ts` with a class-based `RepositoryFoldInput` that owns:
  - repository-group selection resolution for left-nav context
  - left/right arrow fold routing
  - collapse/expand-all chord prefix routing
- Updated `scripts/codex-live-mux-runtime.ts` to delegate repository fold keyboard handling to `RepositoryFoldInput`, removing inline repository fold reducer/arrow handlers from runtime.
- Added `test/ui-repository-fold-input.test.ts` to cover tree-arrow behavior, selection mapping, chord prefix timing, and conversation-branch reset behavior.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4143 non-empty LOC

### Checkpoint AJ (2026-02-18): Phase 8 continues with class-based left-nav input routing

- Added `src/ui/left-nav-input.ts` with a class-based `LeftNavInput` that owns:
  - visible left-nav target derivation for current rail rows
  - left-nav target activation routing
  - left-nav cycle routing and activation delegation
- Updated `scripts/codex-live-mux-runtime.ts` to delegate left-nav target activation/cycle behavior to `LeftNavInput`, removing inline visible-target/activate/cycle left-nav routing from runtime.
- Added `test/ui-left-nav-input.test.ts` to cover injected dependency seams plus default dependency activation/empty-cycle paths.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4120 non-empty LOC

### Checkpoint AK (2026-02-18): Phase 8 continues with class-based left-rail pointer input routing

- Added `src/ui/left-rail-pointer-input.ts` with a class-based `LeftRailPointerInput` that owns:
  - left-rail pointer hit routing to action vs conversation handlers
  - action-handler wiring through `handleLeftRailActionClick`
  - conversation-handler wiring through `handleLeftRailConversationClick`
- Updated `scripts/codex-live-mux-runtime.ts` to delegate left-rail pointer click orchestration to `LeftRailPointerInput`, removing inline action/conversation callback trees from the `onInput` mouse branch.
- Added `test/ui-left-rail-pointer-input.test.ts` to cover injected dependency routing and default dependency fallback behavior.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4098 non-empty LOC

### Checkpoint AL (2026-02-18): Phase 8 continues with class-based main-pane pointer click routing

- Added `src/ui/main-pane-pointer-input.ts` with a class-based `MainPanePointerInput` that owns:
  - project-pane click eligibility + dispatch through `handleProjectPaneActionClick`
  - home-pane click eligibility + dispatch through `handleHomePanePointerClick`
- Updated `scripts/codex-live-mux-runtime.ts` to delegate project/home right-pane click routing to `MainPanePointerInput`, removing inline `project`/`home` click option assembly from the `onInput` mouse branch.
- Added `test/ui-main-pane-pointer-input.test.ts` for injected dispatch coverage and default dependency ineligible-click behavior.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4107 non-empty LOC

### Checkpoint AM (2026-02-18): Phase 8 continues with class-based pointer routing helpers

- Added `src/ui/pointer-routing-input.ts` with a class-based `PointerRoutingInput` that owns wrapper routing for:
  - pane-divider drag release/move handling
  - home-pane drag-release reorder dispatch
  - separator press drag-start handling
  - main-pane wheel routing delegation
  - home-pane drag-move updates
- Updated `scripts/codex-live-mux-runtime.ts` to delegate these pointer-routing helper invocations to `PointerRoutingInput`, reducing inline callback option assembly in the `onInput` mouse loop.
- Added `test/ui-pointer-routing-input.test.ts` for injected handler wiring coverage and default dependency ineligible-event behavior.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4161 non-empty LOC

### Checkpoint AN (2026-02-18): Phase 8 continues with class-based conversation selection routing

- Added `src/ui/conversation-selection-input.ts` with a class-based `ConversationSelectionInput` that owns:
  - selection clear on text-input transitions
  - conversation mouse-selection reduce routing (start/drag/release/clear)
  - viewport pin/release + dirty signaling from reducer outcomes
- Updated `scripts/codex-live-mux-runtime.ts` to delegate inline selection clear/reduce logic in the `onInput` mouse loop to `ConversationSelectionInput`.
- Added `test/ui-conversation-selection-input.test.ts` for injected reducer wiring coverage and default dependency no-op behavior.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4147 non-empty LOC

### Checkpoint AO (2026-02-18): Phase 8 continues with class-based global shortcut routing

- Added `src/ui/global-shortcut-input.ts` with a class-based `GlobalShortcutInput` that owns:
  - shortcut detection delegation via `detectMuxGlobalShortcut`
  - global shortcut handler wiring via `handleGlobalShortcut`
  - project/conversation mode-aware resolvers for archive/takeover/close flows
- Updated `scripts/codex-live-mux-runtime.ts` to delegate global shortcut detection + handler option assembly to `GlobalShortcutInput` from `onInput`.
- Added `test/ui-global-shortcut-input.test.ts` to cover injected dependency wiring and default no-match fallback behavior.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4141 non-empty LOC

### Checkpoint AP (2026-02-18): Phase 8 continues with class-based input token routing

- Added `src/ui/input-token-router.ts` with a class-based `InputTokenRouter` that owns:
  - `onInput` token-loop orchestration for mouse/text token routing
  - pane-target classification + pointer-handler dispatch ordering
  - conversation viewport snapshot refresh on wheel-scroll routing
  - left-rail click eligibility gating and conversation-selection fallback routing
- Updated `scripts/codex-live-mux-runtime.ts` to delegate the inline `for (token of parsed.tokens)` mouse/text routing loop to `InputTokenRouter`.
- Added `test/ui-input-token-router.test.ts` for staged routing behavior coverage, dependency-override coverage, and null-conversation wheel path coverage.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4027 non-empty LOC

### Checkpoint AQ (2026-02-18): Phase 8 continues with class-based conversation input forwarding

- Added `src/ui/conversation-input-forwarder.ts` with a class-based `ConversationInputForwarder` that owns:
  - parsed-input remainder updates for conversation input routing
  - token routing -> pane-forwarding orchestration bridge
  - main-pane scroll routing + dirty signaling for active conversation viewport
  - session-forward gating on controller ownership before PTY input writes
- Updated `scripts/codex-live-mux-runtime.ts` to delegate the parse/route/forward tail of `onInput` to `ConversationInputForwarder`.
- Added `test/ui-conversation-input-forwarder.test.ts` for scroll/forward behavior, controller gating, forward-empty behavior, and default dependency coverage.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 4002 non-empty LOC

### Checkpoint AR (2026-02-18): Phase 8 continues with class-based input preflight gating

- Added `src/ui/input-preflight.ts` with a class-based `InputPreflight` that owns:
  - early `onInput` gating for shutdown + modal short-circuit
  - escape-input short-circuit dispatch
  - focus-event extraction/notification gating
  - repository fold / global shortcut / task shortcut / copy shortcut pre-routing gates
- Updated `scripts/codex-live-mux-runtime.ts` to delegate the `onInput` preflight branch tree to `InputPreflight`, leaving runtime with a thin sanitized-input handoff into `ConversationInputForwarder`.
- Added `test/ui-input-preflight.test.ts` for shutdown, modal, escape, shortcut-gate ordering, custom extraction, and default focus-marker extraction coverage.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 3995 non-empty LOC

### Checkpoint AS (2026-02-18): Service extraction continues with class-based recording shutdown service

- Added `src/services/recording.ts` with a class-based `RecordingService` that owns:
  - recording-writer close lifecycle with explicit error capture
  - post-shutdown gif export flow orchestration
  - recording-related stderr status/error formatting and emission
- Updated `scripts/codex-live-mux-runtime.ts` shutdown path to delegate recording close + gif-export/reporting behavior to `RecordingService`.
- Added `test/services-recording.test.ts` covering close lifecycle success/failure, gif export success/failure, and close-error formatting branches.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 3971 non-empty LOC

### Checkpoint AT (2026-02-18): Service extraction continues with class-based startup span lifecycle tracking

- Added `src/services/startup-span-tracker.ts` with a class-based `StartupSpanTracker` that owns:
  - startup active-session span lifecycle for start-command, first-output, first-visible-paint, and settled checkpoints
  - target startup session tracking for first-paint/settled gate correlation
  - idempotent per-span `end(...)` behavior so duplicate runtime paths stay safe
- Updated `scripts/codex-live-mux-runtime.ts` to delegate startup span lifecycle handling to `StartupSpanTracker` and remove inline startup-span locals/helper closures.
- Added `test/services-startup-span-tracker.test.ts` covering startup span begin lifecycle, idempotent span end behavior, and target-session clear behavior.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 3926 non-empty LOC

### Checkpoint AU (2026-02-18): Service extraction continues with class-based startup visibility helpers

- Added `src/services/startup-visibility.ts` with a class-based `StartupVisibility` that owns:
  - visible non-empty glyph-cell counting for startup paint/settle checkpoints
  - codex-header visibility detection over the active terminal snapshot
- Updated `scripts/codex-live-mux-runtime.ts` startup render/settle paths to delegate visibility calculations to `StartupVisibility` and remove inline visibility helper closures.
- Added `test/services-startup-visibility.test.ts` covering glyph-cell counting and positive/negative codex-header visibility detection.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 3898 non-empty LOC

### Checkpoint AV (2026-02-18): Service extraction continues with class-based startup settled-gate orchestration

- Added `src/services/startup-settled-gate.ts` with a class-based `StartupSettledGate` that owns:
  - startup settled-probe scheduling callbacks from `StartupSequencer`
  - settled-gate perf event emission + settled-span completion coordination
  - settled timer clear/signal passthrough lifecycle used at shutdown and steady state
- Updated `scripts/codex-live-mux-runtime.ts` to delegate startup settled timer/probe orchestration to `StartupSettledGate`, removing inline settled-probe helper closures.
- Added `test/services-startup-settled-gate.test.ts` with coverage for clear/signal passthrough, non-target probe ignore behavior, and settled event emission with both visible-glyph and zero-glyph fallback paths.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 3877 non-empty LOC

### Checkpoint AW (2026-02-18): Service extraction continues with class-based startup background-probe orchestration

- Added `src/services/startup-background-probe.ts` with a class-based `StartupBackgroundProbeService` that owns:
  - startup background-probe wait/skip event emission
  - settled-or-timeout gating before starting background probe loops
  - idempotent startup probe-loop start semantics and interval lifecycle stop behavior
- Updated `scripts/codex-live-mux-runtime.ts` to delegate startup background-probe wait/start/stop behavior to `StartupBackgroundProbeService`, removing inline settled-wait Promise race and interval lifecycle locals.
- Added `test/services-startup-background-probe.test.ts` covering disabled wait/skip flow, settled-start idempotency, timeout-driven start, and shutdown gating behavior.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 3845 non-empty LOC

### Checkpoint AX (2026-02-18): Service extraction continues with class-based startup background-resume orchestration

- Added `src/services/startup-background-resume.ts` with a class-based `StartupBackgroundResumeService` that owns:
  - startup background-resume wait/skip event emission
  - settled-or-timeout wait gating before background queueing begins
  - queued-count event emission after persisted conversation background queue scheduling
- Updated `scripts/codex-live-mux-runtime.ts` to delegate startup background-resume wait/race/queue orchestration to `StartupBackgroundResumeService`, removing inline runtime Promise race + event emission wiring.
- Added `test/services-startup-background-resume.test.ts` with coverage for disabled skip behavior, settled completion path, timeout path, and queue/session-id event payload integrity.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 3821 non-empty LOC

### Checkpoint AY (2026-02-18): Service extraction continues with class-based startup output tracking

- Added `src/services/startup-output-tracker.ts` with a class-based `StartupOutputTracker` that owns:
  - per-session first-output observation dedupe for `mux.session.first-output`
  - startup target-session first-output gate coordination with `StartupSequencer`
  - startup first-output span completion (`StartupSpanTracker.endFirstOutputSpan`) on the first eligible target output
- Updated `scripts/codex-live-mux-runtime.ts` `pty.output` handling to delegate first-output observation and startup-first-output gating to `StartupOutputTracker`, removing inline set/gate logic.
- Added `test/services-startup-output-tracker.test.ts` with coverage for session-level dedupe, target startup first-output success path, and mark-failure no-op behavior.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 3804 non-empty LOC

### Checkpoint AZ (2026-02-18): Service extraction continues with class-based startup paint/header/gate tracking

- Added `src/services/startup-paint-tracker.ts` with a class-based `StartupPaintTracker` that owns:
  - active-target startup first-visible-paint perf event + span completion wiring
  - active-target startup header-visible and settle-gate selection perf emission
  - settled-probe scheduling for eligible target output and rendered frame flushes
- Updated `scripts/codex-live-mux-runtime.ts` to delegate:
  - startup render flush paint/header/gate logic to `StartupPaintTracker.onRenderFlush(...)`
  - target output settled-probe scheduling to `StartupPaintTracker.onOutputChunk(...)`
  - and removed the corresponding inline startup condition trees from runtime.
- Added `test/services-startup-paint-tracker.test.ts` with coverage for:
  - active-target render flush success path
  - ineligible render flush guard paths
  - output-chunk target scheduling behavior
  - first-paint-already-observed branch with header-only emission
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 3754 non-empty LOC

### Checkpoint BA (2026-02-18): Service extraction continues with class-based startup shutdown finalization

- Added `src/services/startup-shutdown.ts` with a class-based `StartupShutdownService` that owns:
  - startup span finalization ordering at shutdown (`start-command`, `first-output`, `first-paint`, `settled`)
  - startup settled-gate teardown sequencing (`clearTimer` + `signalSettled`)
  - settled-gate fallback normalization (`gate: none`) when startup snapshot has no selected gate
- Updated `scripts/codex-live-mux-runtime.ts` shutdown path to delegate startup teardown flow to `StartupShutdownService.finalize()`, removing inline shutdown startup-span and settled-gate teardown logic.
- Added `test/services-startup-shutdown.test.ts` with coverage for full finalize call ordering and settle-gate fallback behavior.
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 3745 non-empty LOC

### Checkpoint BB (2026-02-18): Service extraction continues with class-based event persistence batching

- Added `src/services/event-persistence.ts` with a class-based `EventPersistence` that owns:
  - pending normalized-event queue state
  - timer-based flush scheduling and dedupe
  - immediate flush on batch threshold
  - perf span emission for flush success/error
  - stderr error reporting for append failures
- Updated `scripts/codex-live-mux-runtime.ts` to delegate event batching and flush behavior to `EventPersistence`, removing inline queue/timer/flush functions and replacing:
  - `enqueuePersistedEvent(...)` calls with `eventPersistence.enqueue(...)`
  - shutdown flush with `eventPersistence.flush('shutdown')`
  - perf sample pending count with `eventPersistence.pendingCount()`
- Added `test/services-event-persistence.test.ts` with coverage for:
  - timer flush success path
  - immediate flush threshold behavior with scheduled timer clearing
  - timer dedupe across repeated under-threshold enqueues
  - append error reporting for both `Error` and non-error throw values
  - empty flush no-op behavior
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 3697 non-empty LOC

### Checkpoint BC (2026-02-18): Service extraction continues with class-based mux UI-state persistence

- Added `src/services/mux-ui-state-persistence.ts` with a class-based `MuxUiStatePersistence` that owns:
  - debounced mux UI-state persistence queueing
  - timer lifecycle and dedupe behavior
  - unchanged-state suppression
  - persist/apply delegation and persistence error reporting
- Updated `scripts/codex-live-mux-runtime.ts` to delegate mux UI-state persistence to `MuxUiStatePersistence`, removing inline persisted-state/pending-state/timer fields and persistence logic.
- Added `test/services-mux-ui-state-persistence.test.ts` with coverage for:
  - debounce queue behavior and latest-state persistence
  - unchanged-state skip behavior
  - disabled-mode no-op behavior
  - error reporting for both `Error` and non-error failure values
- Validation at checkpoint:
  - `bun run verify`: pass (global lines/functions/branches = 100%)
  - `bun run loc:verify`: advisory pass (runtime still over limit)
  - Runtime LOC snapshot: `scripts/codex-live-mux-runtime.ts` = 3668 non-empty LOC
