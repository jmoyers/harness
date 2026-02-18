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
  - `scripts/codex-live-mux-runtime.ts` (~4582 non-empty LOC)
  - `src/control-plane/stream-server.ts` (~2145 non-empty LOC)
- Existing extracted modules under `src/mux/live-mux/*` are transitional and should be absorbed into domain/service/ui ownership above.
- `scripts/check-max-loc.ts` now prints responsibility-first refactor guidance in advisory and enforce modes.

## Execution Tracker

- [x] Pivot accepted: responsibility-first architecture codified.
- [x] Phase 1: WorkspaceModel extraction completed.
- [~] Phase 2: ConversationManager extraction in progress.
- [~] Phase 3: RepositoryManager + DirectoryManager extraction in progress.
- [~] Phase 4: TaskManager extraction.
- [ ] Phase 5: ControlPlaneService extraction.
- [ ] Phase 6: Screen extraction.
- [ ] Phase 7: Pane extraction.
- [ ] Phase 8: ModalManager + InputRouter extraction.
- [ ] Phase 9: Thin runtime + cleanup + strict gates.

## Notes

- Avoid helper-fragment churn; each extraction must reduce runtime responsibility and improve ownership clarity.
- Do not carry parallel legacy paths longer than one checkpoint after equivalent behavior is verified.
- If any phase causes UI parity regression, halt and fix before continuing.

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
