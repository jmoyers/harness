# Codex Live Mux Refactor Plan (Temporary)

Status: active
Owner: codex + jmoyers
Delete this file after the refactor is complete.

## Objectives

- Restore and preserve pre-refactor interactive behavior while reducing implementation risk.
- Refactor `scripts/codex-live-mux.ts` into clear modules with stable boundaries.
- Reach LOC target: no file above 2000 non-empty LOC.
- Keep behavior equivalent for human workflows and control-plane parity.

## Non-Negotiable Invariants

- Split-pane UI must remain interactive (left rail + right pane).
- Mouse and keyboard interactions must remain equivalent to current behavior.
- All client actions continue through control-plane stream APIs.
- No privileged path for mux behavior.
- Performance hot-path behavior must not regress without measured justification.

## Target Module Design

- `scripts/codex-live-mux.ts`
  - Tiny entrypoint only: parse args + invoke runtime + set exit code.
- `src/mux/live-mux/runtime.ts`
  - Top-level orchestration lifecycle.
- `src/mux/live-mux/runtime-state.ts`
  - Runtime state container and selectors.
- `src/mux/live-mux/startup.ts`
  - Startup hydration/subscriptions/initial activation logic.
- `src/mux/live-mux/renderer.ts`
  - Render pipeline and frame/cursor composition.
- `src/mux/live-mux/envelope-handler.ts`
  - Stream envelope handling (`pty.output`, `pty.event`, `pty.exit`, observed stream events).
- `src/mux/live-mux/input-router.ts`
  - Input parsing/routing and gesture handling.
- `src/mux/live-mux/modals.ts`
  - Modal builders and modal input reducers.
- `src/mux/live-mux/actions-conversation.ts`
- `src/mux/live-mux/actions-directory.ts`
- `src/mux/live-mux/actions-repository.ts`
- `src/mux/live-mux/actions-task.ts`

## Verification Gates

Run at every checkpoint commit:

```bash
bun run typecheck
bun run lint
bun test test/codex-live-mux-startup.integration.test.ts
bun test test/mux-runtime-wiring.integration.test.ts
bun run loc:verify
```

Run every 2-3 checkpoints and before final merge:

```bash
bun run verify
bun run perf:mux:hotpath
bun run perf:mux:startup
bun run loc:verify:enforce
```

## Phase Plan

1. Phase 0: Baseline lock
   - Confirm baseline behavior with current integration tests and LOC report.
   - Capture current top-LOC order for targeting.

2. Phase 1: Runtime shell extraction
   - Make script entrypoint thin.
   - Move lifecycle orchestration into `runtime.ts` with no behavior changes.

3. Phase 2: State extraction
   - Move mutable state and selectors into `runtime-state.ts`.

4. Phase 3: Renderer extraction
   - Move render logic and rendering side effects into `renderer.ts`.

5. Phase 4: Envelope handler extraction
   - Move stream envelope processing into `envelope-handler.ts`.

6. Phase 5: Modal subsystem extraction
   - Move modal composition and modal-specific input handling into `modals.ts`.

7. Phase 6: Input router extraction
   - Move global shortcut handling, mouse routing, left-nav movement into `input-router.ts`.

8. Phase 7: Action domain extraction
   - Move control-plane action functions into `actions-*` domain modules.

9. Phase 8: Final consolidation
   - Remove dead code.
   - Make sure every file is under LOC gate.
   - Run full strict validation gates.

## Execution Tracker

- [x] Phase 0 started
- [x] Phase 0 completed
- [x] Phase 1 completed
- [~] Phase 2 in progress
- [ ] Phase 3 completed
- [ ] Phase 4 completed
- [ ] Phase 5 completed
- [ ] Phase 6 completed
- [ ] Phase 7 completed
- [ ] Phase 8 completed

## Baseline Results (to update as we execute)

- Date: 2026-02-17
- Baseline gate command results:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass (1 violation)
- Baseline LOC ranking (top):
  - `scripts/codex-live-mux.ts`: 6048 LOC (limit 2000)
  - `src/control-plane/stream-server.ts`: 1992 LOC
  - `src/control-plane/agent-realtime-api.ts`: 1893 LOC
  - `scripts/harness.ts`: 1851 LOC
- Perf baseline snapshots:
  - `bun run perf:mux:hotpath`: pass (`render-total avg=0.352ms`, `fps=115.99`)
  - `bun run perf:mux:startup`: pass (startup markers incomplete in current fixture run; report captured)

## Checkpoint Log

### Checkpoint 1 (2026-02-17): conversation state extraction

- Added `src/mux/live-mux/conversation-state.ts`:
  - `ConversationState` type.
  - Conversation scope/state creation.
  - Session-summary application.
  - Conversation ordering/summary helpers.
  - Debug footer command formatting helpers.
- Updated `scripts/codex-live-mux.ts` to consume extracted helpers.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux.ts`: 6048 -> 5894 LOC

### Checkpoint 2 (2026-02-17): thin entrypoint wrapper

- Moved runtime implementation file:
  - `scripts/codex-live-mux.ts` -> `scripts/codex-live-mux-runtime.ts`
- Replaced `scripts/codex-live-mux.ts` with a thin wrapper:
  - `await import('./codex-live-mux-runtime.ts');`
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC state:
  - `scripts/codex-live-mux.ts`: thin wrapper
  - `scripts/codex-live-mux-runtime.ts`: 5894 LOC (current primary target)

### Checkpoint 3 (2026-02-17): terminal palette probe extraction

- Added `src/mux/live-mux/terminal-palette.ts` and moved `probeTerminalPalette` into it.
- Updated `scripts/codex-live-mux-runtime.ts` to import `probeTerminalPalette` from the new module.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5894 -> 5823 LOC

### Checkpoint 4 (2026-02-17): modal overlay builder extraction

- Added `src/mux/live-mux/modal-overlays.ts`:
  - New thread modal overlay
  - Add project modal overlay
  - Task editor modal overlay
  - Repository modal overlay
  - Conversation title modal overlay
- Updated `scripts/codex-live-mux-runtime.ts` to call extracted overlay builders.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5823 -> 5684 LOC

### Checkpoint 5 (2026-02-17): observed stream helper extraction

- Added `src/mux/live-mux/observed-stream.ts`:
  - read stream cursor baseline helper
  - subscribe observed stream helper
  - unsubscribe observed stream helper
- Updated `scripts/codex-live-mux-runtime.ts` to use extracted observed stream helpers.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5684 -> 5637 LOC

### Checkpoint 6 (2026-02-17): modal input reducer extraction

- Added `src/mux/live-mux/modal-input-reducers.ts`:
  - line prompt reducer (ASCII/backspace/enter)
  - task editor modal reducer (left/right/tab/edit/submit)
- Updated `scripts/codex-live-mux-runtime.ts` modal handlers to call reducers.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5637 -> 5572 LOC

### Checkpoint 7 (2026-02-17): modal pointer dismissal extraction

- Added `src/mux/live-mux/modal-pointer.ts`:
  - outside-click modal dismissal helper
  - preserves mux input remainder behavior
- Updated `scripts/codex-live-mux-runtime.ts` to delegate modal outside-click handling through the helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5572 -> 5558 LOC

### Checkpoint 8 (2026-02-17): left-nav helper extraction

- Added `src/mux/live-mux/left-nav.ts`:
  - left-nav selection type
  - row-to-target mapping
  - target key generation
  - visible target list derivation
- Updated `scripts/codex-live-mux-runtime.ts` to use extracted left-nav helpers.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5558 -> 5487 LOC

### Checkpoint 9 (2026-02-17): repository folding helper extraction

- Added `src/mux/live-mux/repository-folding.ts`:
  - selected repository group resolution from left-nav selection
  - repository tree arrow action reducer
  - repository fold chord reducer
- Updated `scripts/codex-live-mux-runtime.ts` to delegate repository fold/arrow decision logic.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5487 -> 5471 LOC

### Checkpoint 10 (2026-02-17): modal prompt handler extraction (add/repository)

- Added `src/mux/live-mux/modal-prompt-handlers.ts`:
  - `add-directory` modal prompt input handler
  - `repository` modal prompt input handler
- Updated `scripts/codex-live-mux-runtime.ts` to delegate both handlers via injected callbacks.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5471 -> 5388 LOC

### Checkpoint 11 (2026-02-17): modal conversation handler extraction (new-thread/title-edit)

- Added `src/mux/live-mux/modal-conversation-handlers.ts`:
  - `new-thread` modal prompt input handler
  - `conversation title edit` modal prompt input handler
- Updated `scripts/codex-live-mux-runtime.ts` to delegate both handlers via injected callbacks.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5388 -> 5296 LOC

### Checkpoint 12 (2026-02-17): modal task-editor handler extraction

- Added `src/mux/live-mux/modal-task-editor-handler.ts`:
  - task editor modal input handler with structured submit payload
  - validation for required title/repository before submit
- Updated `scripts/codex-live-mux-runtime.ts` to delegate task editor modal input decisions and keep runtime focused on command execution.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5296 -> 5239 LOC

### Checkpoint 13 (2026-02-17): home/task-pane shortcut handler extraction

- Added `src/mux/live-mux/task-pane-shortcuts.ts`:
  - home-pane keyboard shortcut handler
  - editor cursor/editing action routing
  - repository dropdown and task status/reorder shortcut handling
- Updated `scripts/codex-live-mux-runtime.ts` to delegate home/task-pane shortcut handling through the helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5239 -> 5111 LOC

### Checkpoint 14 (2026-02-17): left-nav activation/cycle extraction

- Added `src/mux/live-mux/left-nav-activation.ts`:
  - left-nav target activation helper
  - left-nav selection cycle helper
- Updated `scripts/codex-live-mux-runtime.ts` to delegate activation and cycle behavior through the helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5111 -> 5076 LOC

### Checkpoint 15 (2026-02-17): global shortcut dispatcher extraction

- Added `src/mux/live-mux/global-shortcut-handlers.ts`:
  - global shortcut dispatcher for app/conversation/directory shortcuts
  - callback-driven action routing for stop/archive/takeover/new-thread/close-directory/nav-cycle
- Updated `scripts/codex-live-mux-runtime.ts` to delegate global shortcut branching through the helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5076 -> 5038 LOC

### Checkpoint 16 (2026-02-17): git state helper extraction

- Added `src/mux/live-mux/git-state.ts`:
  - git summary/repository snapshot equality helpers
  - directory git state map ensure/delete/sync helpers
  - observed `directory-git-updated` reducer with structured changed flags
- Updated `scripts/codex-live-mux-runtime.ts` to delegate git state mutation and observed git event handling through the helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 5038 -> 4992 LOC

### Checkpoint 17 (2026-02-17): process usage snapshot helper extraction

- Added `src/mux/live-mux/process-usage.ts`:
  - conversation process usage snapshot refresh helper
  - stale session cleanup and change detection
- Updated `scripts/codex-live-mux-runtime.ts` to delegate process usage map refresh through the helper while keeping existing perf span semantics.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4992 -> 4977 LOC

### Checkpoint 18 (2026-02-17): repository group state helper extraction

- Updated `src/mux/live-mux/repository-folding.ts`:
  - repository group id lookup helper
  - repository group collapsed/expanded/toggle reducers
  - collapse-all/expand-all reducers
  - first-directory-for-repository-group lookup helper
- Updated `scripts/codex-live-mux-runtime.ts` to delegate repository group state transitions and lookups through extracted helpers.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4977 -> 4960 LOC

### Checkpoint 19 (2026-02-17): directory resolution helper extraction

- Added `src/mux/live-mux/directory-resolution.ts`:
  - first-directory lookup helper
  - active-directory resolution helper
  - context-aware directory-for-action resolver
- Updated `scripts/codex-live-mux-runtime.ts` to delegate directory targeting logic through the helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4960 -> 4943 LOC

### Checkpoint 20 (2026-02-17): shutdown request helper extraction

- Added `src/mux/live-mux/runtime-shutdown.ts`:
  - request-stop reducer handling title/task autosave flushes
  - optional live-session shutdown queue behavior
- Updated `scripts/codex-live-mux-runtime.ts` to delegate stop-request branching through the helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4943 -> 4936 LOC

### Checkpoint 21 (2026-02-17): conversation selection mouse reducer extraction

- Updated `src/mux/live-mux/selection.ts`:
  - exported selection point/drag interfaces
  - added conversation selection mouse reducer (`start`, `drag`, `release`, `clear`) with explicit side-effect flags
- Updated `scripts/codex-live-mux-runtime.ts` to delegate conversation mouse selection transitions through the reducer.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4936 -> 4891 LOC

### Checkpoint 22 (2026-02-17): routed token forwarding helper extraction

- Added `src/mux/live-mux/input-forwarding.ts`:
  - routed token forwarding reducer for passthrough input and conversation-pane wheel scroll accumulation
- Updated `scripts/codex-live-mux-runtime.ts` to delegate routed token forwarding/scroll computation through the helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4891 -> 4875 LOC

### Checkpoint 23 (2026-02-17): project-pane click action helper extraction

- Added `src/mux/live-mux/project-pane-pointer.ts`:
  - project-pane click action handler for `conversation.new` and `project.close`
- Updated `scripts/codex-live-mux-runtime.ts` to delegate project-pane click action branching through the helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4875 -> 4873 LOC

### Checkpoint 24 (2026-02-17): left-rail action dispatch helper extraction

- Added `src/mux/live-mux/left-rail-actions.ts`:
  - left-rail action click handler for conversation/project/repository/shortcuts actions
  - callback-driven side effects preserving existing mark-dirty behavior per action
- Updated `scripts/codex-live-mux-runtime.ts` to delegate selected left-rail action branching through the helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4873 -> 4829 LOC

### Checkpoint 25 (2026-02-17): left-rail conversation click helper extraction

- Added `src/mux/live-mux/left-rail-conversation-click.ts`:
  - left-rail conversation click/double-click handler for activation, title-edit, and project fallback routing
  - click-state transition handling via callback setters
- Updated `scripts/codex-live-mux-runtime.ts` to delegate remaining left-rail conversation click branching through the helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4829 -> 4810 LOC

### Checkpoint 26 (2026-02-17): home-pane action click helper extraction

- Added `src/mux/live-mux/home-pane-actions.ts`:
  - home-pane explicit action click handler (repository select/dropdown, task focus/status actions)
- Updated `scripts/codex-live-mux-runtime.ts` to delegate home-pane action click branching through the helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4810 -> 4800 LOC

### Checkpoint 27 (2026-02-17): home-pane entity click helper extraction

- Added `src/mux/live-mux/home-pane-entity-click.ts`:
  - home-pane task/repository entity click handling with double-click edit behavior and drag-start state setup
  - preserves empty-row click behavior (state reset without forced dirty mark)
- Updated `scripts/codex-live-mux-runtime.ts` to delegate home-pane entity click branching through the helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4800 -> 4773 LOC

### Checkpoint 28 (2026-02-17): left-rail pointer orchestration extraction

- Added `src/mux/live-mux/left-rail-pointer.ts`:
  - left-rail row/column target resolution
  - title-edit keep/stop decision
  - selection clear orchestration
  - action-vs-conversation dispatch hook points
- Updated `scripts/codex-live-mux-runtime.ts` to delegate left-rail pointer orchestration through the helper while preserving existing action and conversation handlers.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4773 -> 4766 LOC

### Checkpoint 29 (2026-02-17): pointer routing + home-pane pointer orchestration extraction

- Added `src/mux/live-mux/pointer-routing.ts`:
  - pane-divider drag reducer
  - separator pointer-press reducer
  - main-pane wheel routing reducer
  - home-pane drag-move reducer
- Added `src/mux/live-mux/home-pane-drop.ts`:
  - home-pane drag-release/drop reducer for task/repository reorder
- Added `src/mux/live-mux/home-pane-pointer.ts`:
  - home-pane pointer click orchestration combining action-click and entity-click handlers
- Updated `scripts/codex-live-mux-runtime.ts` to delegate the above pointer pre-routing and home-pane pointer orchestration logic through helpers.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4766 -> 4746 LOC

### Checkpoint 30 (2026-02-17): task action domain extraction

- Added `src/mux/live-mux/actions-task.ts`:
  - task-pane action dispatcher for task/repository create/edit/archive/status/reorder branches
  - callback-driven side effects preserving existing queue labels and notice/focus behavior
- Updated `scripts/codex-live-mux-runtime.ts` to delegate `runTaskPaneAction` branching through the task action helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4746 -> 4695 LOC

### Checkpoint 31 (2026-02-17): repository action domain extraction

- Added `src/mux/live-mux/actions-repository.ts`:
  - repository prompt open handlers (`create`/`edit`)
  - repository home-priority ordering queue helper
  - repository drag-drop reorder helper
- Updated `scripts/codex-live-mux-runtime.ts` to delegate repository prompt and repository reorder/priority branches through the repository action helper.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4695 -> 4683 LOC

### Checkpoint 32 (2026-02-17): conversation/directory action domain extraction

- Added `src/mux/live-mux/actions-conversation.ts`:
  - new-thread prompt open handler
  - create+activate conversation action
  - archive conversation action
  - takeover conversation action
  - add-directory action
  - close-directory action
- Updated `src/mux/live-mux/actions-repository.ts`:
  - repository upsert/archive command helpers
- Updated `scripts/codex-live-mux-runtime.ts` to delegate the above conversation/directory/repository action flows through domain action modules.
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4683 -> 4678 LOC

### Checkpoint 33 (2026-02-17): helper alias naming cleanup

- Updated `scripts/codex-live-mux-runtime.ts`:
  - removed `...Helper` alias naming pattern from extracted-module imports/usages
  - normalized to non-helper alias suffixes for readability during ongoing refactor
- Verification after checkpoint:
  - `bun run typecheck`: pass
  - `bun run lint`: pass
  - `bun test test/codex-live-mux-startup.integration.test.ts`: 9 pass / 0 fail
  - `bun test test/mux-runtime-wiring.integration.test.ts`: 2 pass / 0 fail
  - `bun run loc:verify`: advisory pass
- LOC delta:
  - `scripts/codex-live-mux-runtime.ts`: 4678 -> 4678 LOC
