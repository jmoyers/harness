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
