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

- Current primary over-limit file: `scripts/codex-live-mux-runtime.ts` (~4586 LOC).
- Existing extracted modules under `src/mux/live-mux/*` are transitional and should be absorbed into domain/service/ui ownership above.
- `scripts/check-max-loc.ts` now prints responsibility-first refactor guidance in advisory and enforce modes.

## Execution Tracker

- [x] Pivot accepted: responsibility-first architecture codified.
- [x] Phase 1: WorkspaceModel extraction completed.
- [~] Phase 2: ConversationManager extraction in progress.
- [~] Phase 3: RepositoryManager + DirectoryManager extraction in progress.
- [ ] Phase 4: TaskManager extraction.
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
