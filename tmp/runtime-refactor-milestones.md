# Runtime Refactor Milestones (Macro-Strangler)

## North-Star Goals
- `scripts/*` remain thin wrappers and process adapters, not logic hosts.
- Runtime and domain logic live in `src/*` modules with typed contracts.
- UI primitives become reusable through a first-party `packages/harness-ui` package.
- Callback/property bags and long wiring signatures are actively removed, not moved.
- Runtime orchestration moves to class-based modules with explicit ownership boundaries.

## Branch Policy (Current)
- Day-to-day gate: `bun run verify` (strict coverage gate enabled by default).
- Checkpoint gate: `bun run verify:coverage-gate` at every meaningful vertical extraction.
- Temporary checkpoint policy: completed.
  - Temporary per-file/global relaxations in `harness.coverage.jsonc` were removed.
  - Global + per-file default thresholds are restored to strict 100%.
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
- Scope:
  - Extract reusable input-token routing, pointer routing, and overlay manager contracts to `packages/harness-ui`.
  - Keep application-specific action handlers in `src/services/*` as adapters implementing package interfaces.
  - Remove callback-bag constructors in runtime by introducing cohesive adapter objects (`UiActions`, `UiStateReader`, `UiEffects`).
- Done criteria:
  - `src/ui/*` becomes mostly adapters/composition over `packages/harness-ui`.
  - Runtime composition (`scripts/codex-live-mux-runtime.ts`) stops wiring dozens of per-callback function fields.
  - Interaction/runtime wiring is expressed through cohesive typed collaborators (`UiActions`, `UiStateReader`, `UiEffects`) rather than function-property bags.
- Coverage checkpoint:
  - Run `bun run verify:coverage-gate`.
  - Add interaction tests for pointer hit-testing, token routing, modal dismiss behavior, shortcut routing.

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

## Wiring/Boilerplate Guardrails (All Milestones)
- No new callback/property bags when typed command/context objects are possible.
- No long positional signatures across orchestration boundaries.
- Each slice deletes equivalent legacy wiring in the same change.
- No long-lived parallel legacy/new paths after a slice is verified.
- New script code must stay adapter-thin and side-effect bounded.
- Each merge from `main` must preserve thin-script goals and avoid reintroducing callback/property bag wiring.
- New orchestration boundaries should be class-based with explicit contracts, not loose function collections.
