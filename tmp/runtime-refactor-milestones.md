# Runtime Refactor Milestones (Macro-Strangler)

## North-Star Goals

- `scripts/*` remain thin wrappers and process adapters, not logic hosts.
- Runtime and domain logic live in `src/*` modules with typed contracts.
- UI primitives become reusable through a first-party `packages/harness-ui` package.
- Callback/property bags and long wiring signatures are actively removed, not moved.
- Runtime orchestration moves to class-based modules with explicit ownership boundaries.

## Branch Policy (Current)

- Day-to-day gate: `bun run verify` (format + lint + typecheck + deadcode + tests; coverage temporarily relaxed during Milestone 5 extraction).
- Checkpoint gate: `bun run verify:coverage-gate` at every meaningful vertical extraction.
- Temporary checkpoint policy (active for Milestone 5 implementation slices):
  - Temporary coverage thresholds in `harness.coverage.jsonc`: global 95/95/95, per-file 0/0/0.
  - Restore strict 100/100/100 global and per-file at Milestone 5 completion checkpoint before merge.
- Mainline sync policy:
  - At each milestone midpoint and immediately before each coverage checkpoint, merge latest `main` into the branch.
  - Resolve conflicts by preserving extracted module boundaries (no re-inlining into `scripts/*`).
  - Run `bun run verify` after merge; run `bun run verify:coverage-gate` at the milestone checkpoint.

## Anti-Glue Enforcement (Applies To Every Milestone)

- Slice acceptance fails when any of these are introduced:
  - new callback/property bags for runtime composition
  - new `Record<string, unknown>` orchestration contracts
  - script-level business routing/orchestration logic
  - mirror facades that proxy most methods of a concrete class
  - nested catch-all runtime context bags
- Every milestone must remove at least one whole glue pattern class, not only move code.
- Every milestone must include one "deleted complexity" note listing what wiring shape was removed.

## Pathology Inventory (Live)

| Pattern category                                      | Why it is pathological                                                       | Current hotspots                                                                                              | Required cleanup milestone                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `harness-ui` back-imports into `src/*`                | Breaks package boundary and prevents reuse by other subprocesses             | Resolved in active package interaction modules; no remaining `packages/harness-ui/src/** -> src/**` imports   | Milestone 5A-5C remove all package `src/*` imports via ports                   |
| Class-shaped frame-function relays                    | Class adds no behavior; only forwards to free functions and reassembles bags | Resolved for extracted interaction classes by required strategy ports (no default `?? frameFn` paths)         | Milestone 5A first; then 5B/5C for remaining interaction routers               |
| Mega callback/options bags                            | High coupling, constructor bloat, hidden ownership                           | `LeftRailPointerInputOptions`, `InputRouterOptions`, `InputTokenRouterOptions`, `MainPanePointerInputOptions` | Milestone 5A-5D split into state ports + action ports + concrete collaborators |
| Runtime bag reassembly glue                           | Services rebuild large callback sets to satisfy lower-level bag APIs         | `scripts/codex-live-mux-runtime.ts` composition root remains the primary wiring hotspot                       | Milestone 5A-5D move to direct class collaborators/ports                       |
| Test-only dependency override defaults (`?? frameFn`) | Keeps concrete coupling in production path and masks boundary problems       | Resolved in migrated interaction classes; enforce no reintroduction in new modules                            | Milestone 5A-5C replace with owned logic or explicit strategy ports            |

## Class/File Inventory Tracker (Milestone 5)

Legend:

- Pattern flags:
  - `BI`: package back-import to `src/*`
  - `FR`: class-shaped frame-function relay (`dependencies.* ?? *Frame`)
  - `MB`: mega callback/options bag surface
  - `RG`: runtime reassembly glue in `src/services/*`

### Package interaction/overlay classes

| File                                                                  | Class                        | Flags  | Milestone | Status                       |
| --------------------------------------------------------------------- | ---------------------------- | ------ | --------- | ---------------------------- |
| `packages/harness-ui/src/interaction/rail-pointer-input.ts`           | `RailPointerInput`           | `MB`   | `5A`      | `implemented`                |
| `packages/harness-ui/src/interaction/input.ts`                        | `InputRouter`                | `MB`   | `5B`      | `implemented_strategy_ports` |
| `packages/harness-ui/src/interaction/input-token-router.ts`           | `InputTokenRouter`           | `MB`   | `5C`      | `implemented_strategy_ports` |
| `packages/harness-ui/src/interaction/pointer-routing-input.ts`        | `PointerRoutingInput`        | `MB`   | `5C`      | `implemented_strategy_ports` |
| `packages/harness-ui/src/interaction/main-pane-pointer-input.ts`      | `MainPanePointerInput`       | `MB`   | `5C`      | `implemented_strategy_ports` |
| `packages/harness-ui/src/interaction/left-nav-input.ts`               | `LeftNavInput`               | `MB`   | `5C`      | `implemented_strategy_ports` |
| `packages/harness-ui/src/interaction/global-shortcut-input.ts`        | `GlobalShortcutInput`        | `MB`   | `5C`      | `implemented_strategy_ports` |
| `packages/harness-ui/src/interaction/conversation-selection-input.ts` | `ConversationSelectionInput` | `MB`   | `5C`      | `implemented_strategy_ports` |
| `packages/harness-ui/src/interaction/conversation-input-forwarder.ts` | `ConversationInputForwarder` | `MB`   | `5C`      | `implemented`                |
| `packages/harness-ui/src/interaction/input-preflight.ts`              | `InputPreflight`             | `none` | `5C`      | `implemented_strategy_ports` |
| `packages/harness-ui/src/modal-manager.ts`                            | `ModalManager`               | `MB`   | `5B`      | `implemented_strategy_ports` |
| `packages/harness-ui/src/interaction/repository-fold-input.ts`        | `RepositoryFoldInput`        | `none` | `5C`      | `implemented_strategy_ports` |

### Runtime service glue classes (bag reassembly)

| File                                          | Class                      | Flags    | Milestone | Status                       |
| --------------------------------------------- | -------------------------- | -------- | --------- | ---------------------------- |
| `src/services/left-rail-pointer-handler.ts`   | `LeftRailPointerHandler`   | `MB`     | `5A`      | `implemented`                |
| `src/services/runtime-rail-input.ts`          | `RuntimeRailInput`         | `RG`     | `5A, 5D`  | `deleted`                    |
| `src/services/runtime-modal-input.ts`         | `RuntimeModalInput`        | `RG, MB` | `5B, 5D`  | `deleted`                    |
| `src/services/runtime-main-pane-input.ts`     | `RuntimeMainPaneInput`     | `RG, MB` | `5C, 5D`  | `deleted`                    |
| `src/services/runtime-navigation-input.ts`    | `RuntimeNavigationInput`   | `RG`     | `5C, 5D`  | `deleted`                    |
| `src/services/runtime-input-pipeline.ts`      | `RuntimeInputPipeline`     | `RG`     | `5C, 5D`  | `deleted`                    |
| `src/services/runtime-input-router.ts`        | `RuntimeInputRouter`       | `RG, MB` | `5D`      | `deleted`                    |
| `src/services/runtime-workspace-actions.ts`   | `RuntimeWorkspaceActions`  | `RG, MB` | `5D`      | `deleted`                    |
| `src/services/runtime-task-pane-actions.ts`   | `RuntimeTaskPaneActions`   | `FR, MB` | `5D`      | `owned_logic_no_frame_relay` |
| `src/services/runtime-task-pane-shortcuts.ts` | `RuntimeTaskPaneShortcuts` | `FR, MB` | `5D`      | `owned_logic_no_frame_relay` |

### Source modules to delete after replacement

| Legacy file                                        | Replaced by                                                                                                                                                                                                                | Milestone | Status    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------- |
| `src/mux/live-mux/left-rail-pointer.ts`            | `packages/harness-ui/src/interaction/rail-pointer-input.ts` + `src/services/left-rail-pointer-handler.ts`                                                                                                                  | `5A`      | `deleted` |
| `src/mux/live-mux/left-rail-actions.ts`            | `src/services/left-rail-pointer-handler.ts`                                                                                                                                                                                | `5A`      | `deleted` |
| `src/mux/live-mux/left-rail-conversation-click.ts` | `src/services/left-rail-pointer-handler.ts`                                                                                                                                                                                | `5A`      | `deleted` |
| `src/services/runtime-input-router.ts`             | direct runtime composition in `scripts/codex-live-mux-runtime.ts` (`InputRouter` + rail/nav/pointer collaborators + `InputTokenRouter`)                                                                                    | `5D`      | `deleted` |
| `src/services/runtime-rail-input.ts`               | direct runtime composition in `scripts/codex-live-mux-runtime.ts` (`LeftRailPointerHandler` + `RailPointerInput` + nav/shortcut primitives)                                                                                | `5D`      | `deleted` |
| `src/services/runtime-modal-input.ts`              | direct runtime composition in `scripts/codex-live-mux-runtime.ts` (`InputRouter` + modal handler strategies)                                                                                                               | `5D`      | `deleted` |
| `src/services/runtime-main-pane-input.ts`          | direct runtime composition in `scripts/codex-live-mux-runtime.ts` (`MainPanePointerInput` + `PointerRoutingInput` + `ConversationSelectionInput` + `InputTokenRouter`)                                                     | `5D`      | `deleted` |
| `src/services/runtime-navigation-input.ts`         | direct runtime composition in `scripts/codex-live-mux-runtime.ts` (`LeftNavInput` + `RepositoryFoldInput` + `GlobalShortcutInput`)                                                                                         | `5D`      | `deleted` |
| `src/services/runtime-input-pipeline.ts`           | direct runtime composition in `scripts/codex-live-mux-runtime.ts` (`InputPreflight` + `ConversationInputForwarder`)                                                                                                        | `5D`      | `deleted` |
| `src/services/runtime-workspace-actions.ts`        | direct runtime composition in `scripts/codex-live-mux-runtime.ts` via concrete collaborators (`ConversationLifecycle`, `RuntimeDirectoryActions`, `RuntimeRepositoryActions`, `RuntimeControlActions`, task-pane services) | `5D`      | `deleted` |
| `src/mux/live-mux/actions-task.ts`                 | class-owned action dispatch in `src/services/runtime-task-pane-actions.ts`                                                                                                                                                 | `5D`      | `deleted` |
| `src/mux/live-mux/task-pane-shortcuts.ts`          | class-owned shortcut dispatch in `src/services/runtime-task-pane-shortcuts.ts`                                                                                                                                             | `5D`      | `deleted` |

## Milestone 1: Gateway + Runtime Infra Vertical Slice

- Status: `checkpoint_passed` (module extraction complete; checkpoint gate passing under temporary migration floors).
- Scope:
  - Extract gateway parsing/lifecycle (`start/stop/status/restart/run/call/gc`) to `src/cli/gateway/*`.
  - Extract lock/state/process/orphan mechanics to `src/cli/runtime-infra/*`.
  - Replace inline fs/env/process logic in runtime handlers with module APIs.
- Done criteria:
  - Gateway handlers in `scripts/harness-runtime.ts` become adapter-only.
  - Lock/process/state logic no longer interleaved with command handlers.
  - No long positional gateway signatures in entrypoint code.
- Coverage checkpoint:
  - Run `bun run verify:coverage-gate`.
  - Add/expand negative tests for stale records, lock contention, unreachable daemons, orphan cleanup.
  - Progress: added direct in-process tests for extracted classes so LCOV now includes `src/cli/gateway/runtime.ts`, `src/cli/runtime-infra/gateway-control.ts`, and `src/cli/parsing/flags.ts`.
  - Current state: checkpoint gate now runs against explicit temporary floors for extracted modules; next checkpoints ratchet floors up until strict 100 restoration.

## Milestone 2: Auth + Workflow Vertical Slice

- Status: `checkpoint_passed` (class-based extraction complete; checkpoint gate passing under temporary migration floors).
- Scope:
  - Extract auth parser + OAuth device/PKCE + refresh/logout into `src/cli/auth/*`.
  - Extract profile/timeline/render-trace/default-client workflows into `src/cli/workflows/*`.
  - Standardize workflow entry signatures on one typed `RuntimeContext`.
- Done criteria:
  - Auth and workflow control flow removed from runtime monolith.
  - Command handlers route typed commands to typed services only.
  - Output mapping isolated from domain transitions.
- Coverage checkpoint:
  - Run `bun run verify:coverage-gate`.
  - Add negative tests for token precedence, expired tokens, active-state conflicts, invalid permutations.
  - Progress:
    - Flattened runtime context from nested `sessionPaths` bag to direct typed fields.
    - Removed `GatewayRuntimeService` infra reach-through (`public infra`) to prevent nested abstraction calls.
    - Replaced workflow facade `Record<string, unknown>` option bags with concrete gateway types.
    - Verified with `bun run verify` and `bun run verify:coverage-gate` (both passing).

## Milestone 3: CLI Parsing + Dispatch Consolidation

- Status: `checkpoint_passed` (class-based cutover complete; coverage checkpoint passing under temporary migration floors).
- Scope:
  - Move parse helpers/models into `src/cli/parsing/*`.
  - Consolidate session/global parse logic to single command-family parsers.
  - Remove duplicated parse loops and callback-driven argument handling.
  - Introduce `src/cli/runtime-app/*` as the owning harness runtime composition root.
- Done criteria:
  - Runtime dispatch consumes typed command models only.
  - `scripts/harness-runtime.ts` is bootstrap + handoff only (no command-family orchestration).
  - No runtime `Record<string, unknown>` contracts in `src/cli/*`.
  - Repeated per-command wiring blocks are removed from script entrypoint.
- Coverage checkpoint:
  - Run `bun run verify:coverage-gate`.
  - Add parser regression/property tests for malformed and edge argument sequences.
  - Progress:
    - Added class-level tests for runtime app orchestration collaborators (`HarnessRuntimeScopeFactory`, `HarnessUpdateInstaller`, `CursorHooksCliRunner`, `DiffCliRunner`).
    - Added parser negative coverage for invalid/missing `--session` values.
    - Executed `bun run verify:coverage-gate` successfully with temporary per-file ratchet floors for extracted Milestone 3 modules.
- Deleted complexity note:
  - Removed command-family orchestration and parse-loop routing from `scripts/harness-runtime.ts`; script now acts as thin bootstrap/handoff only.
  - Removed direct side-effect hard-wiring from runtime app classes by moving to constructor-injected class collaborators for update/cursor-hooks/diff execution.

## Milestone 4: `harness-ui` Foundation Package Extraction

- Status: `checkpoint_passed` (class-based package cutover complete; coverage checkpoint passing under temporary migration floors).
- Scope:
  - Create `packages/harness-ui` class-owned foundation modules:
    - `SurfaceBuffer`: surface/cell/style model + ANSI row rendering
    - `TextLayoutEngine`: width/truncation/wrap primitives
    - `UiKit`: box/modal/text row composition primitives
    - `Screen` + explicit IO collaborators: frame diff/flush + cursor/ANSI validation pipeline
  - Move generic code from `src/ui/*` and shared mux render helpers into package modules.
  - Cut consumers to package-owned classes in the same milestone (no long-lived compatibility facades).
- Done criteria:
  - Foundation modules import no mux/workspace/domain logic.
  - Shared APIs usable by at least two consumers (`codex-live-mux` + one subprocess/test TUI path).
  - Package boundaries are class-oriented or explicit typed collaborator interfaces, not callback/property bags.
  - No new runtime constructor options bags for orchestration wiring.
- Coverage checkpoint:
  - Run `bun run verify:coverage-gate`.
  - Add package-focused unit tests for ANSI output, truncation, overlay, theme resolution, frame diffing.
  - Progress:
    - Added `packages/harness-ui/src/*` foundation modules (`SurfaceBuffer`, `TextLayoutEngine`, `UiKit`, `Screen`, frame primitives).
    - Cut runtime consumers directly to package-owned classes (`src/mux/*`, `src/diff-ui/*`, `scripts/codex-live-mux-runtime.ts`) with no callback/options bag bridge layer.
    - Removed temporary compatibility wrappers entirely by deleting `src/ui/{surface,kit,wrapping-input,screen}.ts` once consumers/tests were cut over.
    - Removed `Screen` constructor options bag in runtime composition paths by switching to explicit writer/validator collaborators.
    - Executed `bun run verify` and milestone checkpoint `bun run verify:coverage-gate` successfully.
- Deleted complexity note:
  - Removed the entire `src/ui` foundation shim layer and its function wrappers (`createUiSurface`, `paintUiRow`, `renderWrappingInputLines`, etc.) to prevent long-lived glue paths.
  - Removed type-coupling through wrapper function return signatures in modal paths by switching to package-owned `UiModalOverlay`/`UiModalTheme` contracts.

## Milestone 5: `harness-ui` Interaction + Overlay Package Slice

- Status: `in_progress` (major extraction landed; boundary inversion + runtime composition slimming in progress under temporary relaxed coverage gate).
- Active execution mode: `30_minute_reductive_glue_removal` (no net-new relay layers; only deletion/consolidation of wiring surfaces).
- Scope:
  - Extract reusable input-token routing, pointer routing, and overlay manager contracts to `packages/harness-ui`.
  - Keep application-specific action handlers in `src/services/*` as adapters implementing package interfaces.
  - Remove callback-bag constructors in runtime by introducing consumer-owned ports and concrete collaborator instances.
- Done criteria:
  - `src/ui/*` becomes mostly adapters/composition over `packages/harness-ui`.
  - Runtime composition (`scripts/codex-live-mux-runtime.ts`) stops wiring dozens of per-callback function fields.
  - Interaction/runtime wiring is expressed through consumer-owned feature ports and concrete class collaborators rather than function-property bags.
- Coverage checkpoint:
  - Run `bun run verify:coverage-gate`.
  - Add interaction tests for pointer hit-testing, token routing, modal dismiss behavior, shortcut routing.
- Ordered cleanup slices (large vertical chunks, no intermediate glue state):
  - **Milestone 5A: Rail Pointer Boundary Inversion (implemented; strict coverage checkpoint currently failing)**
    - Add package-owned generic rail pointer primitive (`RailPointerInput`) with typed hit resolver/dispatcher ports.
    - Add harness-owned `LeftRailPointerHandler` class in `src/services/*` for conversation/repository/directory action policy.
    - Rewire `RuntimeRailInput` to compose `RailPointerInput + LeftRailPointerHandler` directly.
    - Delete `src/mux/live-mux/left-rail-actions.ts`, `src/mux/live-mux/left-rail-conversation-click.ts`, `src/mux/live-mux/left-rail-pointer.ts` after parity tests pass.
    - Remove `packages/harness-ui/src/interaction/left-rail-pointer-input.ts` frame-function dependency pattern (no `?? frameFn` path retained).
    - Checkpoint gate: run `bun run verify:coverage-gate` after this slice.
  - **Milestone 5B: Modal Router Boundary Inversion (implemented)**
    - Replace `InputRouter` frame delegates with package-owned modal input flow and typed action ports.
    - Move harness-specific command/repository/conversation action policy to `src/services/*` collaborator classes.
    - Remove `packages/harness-ui/src/interaction/input.ts` imports of `src/mux/live-mux/modal-*`.
  - **Milestone 5C: Pointer/Token Router Boundary Inversion (implemented)**
    - Replace `InputTokenRouter`, `PointerRoutingInput`, `MainPanePointerInput`, `ConversationSelectionInput` frame delegates with package-owned primitives.
    - Move workspace-specific selection/text/project/home behaviors into `src/services/*` policy collaborators.
  - **Milestone 5D: Runtime Composition De-Bagging (in progress)**
    - Remove remaining runtime constructor mega option shapes by splitting into explicit state/action port objects and concrete class collaborators.
    - Ban new constructor option interfaces >20 fields on orchestration classes.
  - **Milestone 5D.1 (completed): Reductive Wiring Deletion Pass**
    - Deleted `RuntimeModalInput`; compose `InputRouter` directly in the composition root.
    - Deleted `RuntimeMainPaneInput`; compose pointer/token/selection collaborators directly in the composition root.
    - Deleted `RuntimeRailInput`; compose rail-pointer and navigation collaborators directly in the composition root.
    - Removed corresponding wrapper tests and wrappers in the same slice (no compatibility shims retained).
  - **Milestone 5D.2 (completed): Task-Pane Relay Deletion Pass**
    - Removed frame-function relay from `RuntimeTaskPaneActions`; class now owns task-pane action routing directly.
    - Removed frame-function relay from `RuntimeTaskPaneShortcuts`; class now owns keybinding + composer dispatch directly.
    - Deleted `src/mux/live-mux/actions-task.ts` and `src/mux/live-mux/task-pane-shortcuts.ts`.
    - Deleted legacy `test/mux-live-mux-task-pane-shortcuts.test.ts`; moved coverage to service-level task-pane tests.
- Milestone 5A execution checklist:
  - [x] Inventory class/file pattern hotspots and map to milestones.
  - [x] Add package primitive `RailPointerInput` with typed hit resolver/dispatcher ports.
  - [x] Add harness policy class `LeftRailPointerHandler` in `src/services/*`.
  - [x] Rewire `RuntimeRailInput` to compose primitive + handler (no callback/property bags).
  - [x] Delete `src/mux/live-mux/left-rail-pointer.ts`, `src/mux/live-mux/left-rail-actions.ts`, `src/mux/live-mux/left-rail-conversation-click.ts`.
  - [x] Update/expand unit+integration tests to verify parity and negative cases.
  - [x] Run `bun run verify` and `bun run verify:coverage-gate` checkpoint.
  - [x] Update tracker statuses from `in_progress/queued` to checkpoint result.
  - Checkpoint result:
    - `bun run verify` passed.
    - `bun run verify:coverage-gate` failed on strict global/per-file thresholds:
      - global lines: `99.59 < 100.00`
      - global functions: `97.12 < 100.00`
      - primary failing files include:
        - `packages/harness-ui/src/interaction/conversation-input-forwarder.ts`
        - `src/services/runtime-main-pane-input.ts`
        - `src/services/runtime-modal-input.ts`
        - `src/services/runtime-navigation-input.ts`
        - `src/services/runtime-rail-input.ts`
- Progress:
  - Moved interaction stack and modal manager from `src/ui/*` to `packages/harness-ui/src/{interaction,modal-manager}.ts`.
  - Deleted legacy `src/ui` interaction wrappers in the same slice (no parallel path retained).
  - Rewired runtime services and script composition to consume package-owned interaction classes directly.
  - Completed Milestone 5A rail-pointer inversion:
    - Added package-owned `RailPointerInput` primitive.
    - Added `LeftRailPointerHandler` class to own left-rail policy behavior.
    - Rewired `RuntimeRailInput` to compose primitive + handler.
    - Deleted `src/mux/live-mux/left-rail-*` free-function chain.
    - Updated rail-pointer tests and uncovered dispatcher/small suites for parity.
  - Removed constructor factory-callback bags from runtime input orchestration by deleting wrapper services and composing concrete collaborators directly.
  - Replaced `RuntimeInputRouter` mega constructor/options bag with direct composition (`InputRouter`, rail/nav/pointer collaborators, and `InputTokenRouter`).
  - Rebased and updated interaction/service test suites to validate package-owned call paths.
  - Removed frame-function fallback pattern from `ConversationInputForwarder`:
    - Deleted package-level imports of concrete `src/mux/*` implementations.
    - Replaced `dependencies.* ?? *Frame` with explicit strategy ports on constructor options.
    - Wired concrete parser/routing/classifier strategies from `scripts/codex-live-mux-runtime.ts`.
    - Preserved typed conversation/snapshot generics end-to-end in `ConversationInputForwarder`.
  - Removed frame-function fallback patterns from `InputPreflight`, `GlobalShortcutInput`, `LeftNavInput`, and `RepositoryFoldInput`:
    - Deleted package-level back-import defaults from `src/mux/*` for those classes.
    - Required explicit strategy ports at composition sites, with runtime-owned concrete strategy wiring.
  - Completed Milestone 5B/5C boundary inversion for remaining interaction classes:
    - `InputRouter`, `ModalManager`, `InputTokenRouter`, `PointerRoutingInput`, `MainPanePointerInput`, and `ConversationSelectionInput` now require explicit strategy ports with no package back-import defaults.
  - Deleted `RuntimeInputRouter` as redundant runtime glue:
    - Rewired preflight/forwarder paths directly to `InputRouter`, rail/nav/pointer collaborators, and `InputTokenRouter`.
    - Deleted `src/services/runtime-input-router.ts` and `test/services-runtime-input-router.test.ts`.
  - Completed the latest 5D de-bagging slice for runtime orchestration:
    - Deleted `RuntimeRailInput` and moved composition to the root.
    - Deleted `RuntimeModalInput` and moved modal input routing composition to the root.
    - Deleted `RuntimeMainPaneInput` and moved main-pane pointer/token routing composition to the root.
    - Deleted `RuntimeNavigationInput` and moved nav/repository/global-shortcut wiring composition to the root.
    - Deleted `RuntimeInputPipeline` and moved preflight/input-forwarder wiring composition to the root.
    - Rewired `scripts/codex-live-mux-runtime.ts` to compose `LeftRailPointerHandler`, `RailPointerInput`, `LeftNavInput`, `RepositoryFoldInput`, `GlobalShortcutInput`, `InputPreflight`, and `ConversationInputForwarder` directly.
  - Completed task-pane free-function relay cleanup:
    - `RuntimeTaskPaneActions` now owns task action routing logic (no `runTaskPaneAction` options bag relay).
    - `RuntimeTaskPaneShortcuts` now owns shortcut and insert-text parsing logic (no `handleTaskPaneShortcutInput` options bag relay).
    - Deleted `src/mux/live-mux/actions-task.ts` and `src/mux/live-mux/task-pane-shortcuts.ts`.
  - Deleted `RuntimeWorkspaceActions` pass-through aggregator:
    - Rewired `scripts/codex-live-mux-runtime.ts` to call concrete collaborators directly (`ConversationLifecycle`, `RuntimeDirectoryActions`, `RuntimeRepositoryActions`, `RuntimeControlActions`, task-pane services).
    - Deleted `src/services/runtime-workspace-actions.ts` and `test/services-runtime-workspace-actions.test.ts`.
  - Completed thin-script handoff for mux runtime:
    - Moved mux runtime composition root from `scripts/codex-live-mux-runtime.ts` into `src/mux/runtime-app/codex-live-mux-runtime.ts`.
    - Converted `scripts/codex-live-mux-runtime.ts` to bootstrap wrapper (`runCodexLiveMuxRuntimeProcess` delegation only).
    - Moved terminal recording GIF implementation from `scripts/terminal-recording-gif-lib.ts` to `src/recording/terminal-recording-gif-lib.ts` and rewired script/test imports.
  - Verification checkpoint after this 5D slice:
    - `bun run typecheck` passed.
    - `bun run lint` passed.
    - Runtime integration + input/service matrix passed (`84` tests).
    - Full workspace test suite passed (`1646` tests).
- Deleted complexity note:
  - Removed `create*` dependency-factory callback bags from runtime input service constructors and replaced them with explicit collaborator instances.
  - Removed the entire `src/ui` interaction module set (`input*`, pointer routers, modal manager, nav/shortcut routers), preventing dual-source drift.
  - Removed the runtime input-router façade that only re-delegated modal/rail/main-pane methods, eliminating one full glue class from runtime composition.

## Emerging Smells (Pause/Fix Rules)

- `InputRouter`, `InputTokenRouter`, and `MainPanePointerInput` still expose broad callback-heavy option surfaces.
  - Rule: split remaining broad options into state/action/policy sub-ports so no single constructor contract becomes a callback catch-all.
- Runtime composition root still assembles many workspace field closures inline.
  - Rule: continue splitting `src/mux/runtime-app/codex-live-mux-runtime.ts` by vertical capabilities so the composition root does orchestration, not local helper logic.
- `scripts/codex-live-mux-runtime.ts` is now bootstrap-thin; keep it wrapper-only.
  - Rule: do not reintroduce behavior/orchestration logic into the script entrypoint.
- Reductive pass constraint:
  - Every change in the active pass must remove at least one explicit wiring relay shape (inline closure set, passthrough method group, or broad callback bag) from runtime composition code.
- Runtime orchestration classes can regress into class-shaped glue by wrapping large callback bags behind pass-through methods.
  - Rule: orchestration classes must accept concrete collaborators or consumer-owned feature ports and must not be pass-through wrappers.
  - Rule: ban >20-field constructor option shapes on orchestration classes and ban wrappers where most methods are 1:1 delegates.
- Constructor-parameter type plumbing via `ConstructorParameters<typeof X>[0]` is still common across orchestration modules.
  - Rule: replace cross-module constructor type plumbing with named exported interfaces from owning modules.

## Milestone 6: Composition-Root + Thin-Scripts Final Cutover

- Scope:
  - Introduce/complete composition roots for mux runtime (`src/mux/runtime-app/*`) and finalize harness runtime cutover.
  - Reduce `scripts/codex-live-mux-runtime.ts` to bootstrap + handoff.
  - Delete temporary shims and duplicate bridge layers.
- Done criteria:
  - Almost no architecture logic remains in `scripts/*`.
  - Runtime orchestration lives in typed modules under `src/*`.
  - No callback/property bags in runtime composition paths.
  - Coverage gate restored as the default `verify` path.
- Coverage checkpoint (final):
  - Set `verify` back to strict coverage gating.
  - Run full `bun run verify` green on 100% coverage.

### Milestone 6A (Temporary): Runtime-App Monolith Decomposition Plan

- Status: `planned`
- Goal:
  - Break up `src/mux/runtime-app/codex-live-mux-runtime.ts` into cohesive modules with real ownership boundaries.
  - Keep `scripts/codex-live-mux-runtime.ts` as wrapper-only.

- Design constraints (explicit):
  - No `MuxRuntimeState` god object passed to every composer.
  - No single mega state bag replacing closure scope with a typed bag.
  - Composer constructors take only collaborators they actually need.
  - Constructor budget: target <= 8 parameters per composer; split module if exceeded.
  - No class-shaped glue wrappers; each class must own decisions, not method forwarding.

- Success checks:
  - `CodexLiveMuxRuntimeApplication.run()` is readable in <30 seconds.
  - Root runtime-app orchestrator remains sequencing-only, not local behavior host.
  - No new callback/options bags introduced during decomposition.

- Ordered extraction sequence:
  - Step 1: `mux-command-menu-composer.ts`
    - Extract command-menu provider/action registration first (~largest isolated block, lowest coupling risk).
    - Inputs: registry + explicit collaborators; output: registrations only.
  - Step 2: `mux-input-composer.ts` (and optional sub-composer split)
    - Extract input routing/preflight/pointer/token composition.
    - If constructor budget is exceeded, split by sub-surface rather than introducing state bags.
  - Step 3: `mux-render-compose.ts`
    - Extract render pipeline + envelope wiring composition boundaries.
  - Step 4: `mux-runtime-loop.ts`
    - Extract attach/hydrate/start/shutdown ordering and exit mapping.
    - Keep shutdown ordering behavior equivalent and explicitly tested.

- Verification cadence for this plan:
  - After each step: `bun run typecheck`, `bun run lint`, targeted integration matrix.
  - After Step 4: full `bun test`.

## Wiring/Boilerplate Guardrails (All Milestones)

- No new callback/property bags when typed command/context objects are possible.
- No long positional signatures across orchestration boundaries.
- Each slice deletes equivalent legacy wiring in the same change.
- No long-lived parallel legacy/new paths after a slice is verified.
- New script code must stay adapter-thin and side-effect bounded.
- Each merge from `main` must preserve thin-script goals and avoid reintroducing callback/property bag wiring.
- New orchestration boundaries should be class-based with explicit contracts, not loose function collections.
