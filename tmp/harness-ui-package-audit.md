# Harness UI Package Audit

## Short Answer
- No, not every current UI component is structured for reusable package extraction yet.
- Several modules are reusable now; several are UI-shaped adapters over mux-specific logic.

## Current Component Classification

### Reusable Foundation (extract first)
- `src/ui/surface.ts`: terminal cell/style surface primitives; mostly pure (`src/ui/surface.ts:1`).
- `src/ui/kit.ts`: generic box/modal/text helpers; mostly pure (`src/ui/kit.ts:1`).
- `src/ui/wrapping-input.ts`: generic wrapped-input rendering (`src/ui/wrapping-input.ts:1`).

### Reusable with Light Decoupling
- `src/ui/screen.ts`: reusable frame flush shell, but currently imports mux diff/cursor helpers (`src/ui/screen.ts:1`).
- `src/ui/mux-theme.ts`: useful theme mapping, but coupled to harness config shape (`src/ui/mux-theme.ts:3`).

### App-Coupled (keep in `src` as adapters/features)
- `src/ui/panes/left-rail.ts`: direct wrapper over live mux rail layout (`src/ui/panes/left-rail.ts:1`).
- `src/ui/panes/project.ts`: direct wrapper over mux project pane model (`src/ui/panes/project.ts:1`).
- `src/ui/panes/home.ts`: task/domain-aware pane with package.json/version coupling (`src/ui/panes/home.ts:1`).
- `src/ui/modals/manager.ts`: overlay manager coupled to live mux modal builders and workspace state (`src/ui/modals/manager.ts:1`).
- `src/ui/input.ts`, `src/ui/*input*.ts`: many hooks into live-mux handlers and runtime action graph (`src/ui/input.ts:1`).

## Where `harness-ui` Fits

### Target Layering
1. `packages/harness-ui` (reusable UI toolkit)
- ANSI surface/cell/style model.
- Layout primitives and text metrics abstraction.
- Frame diff/flush + cursor model primitives.
- Modal/overlay primitives and generic hit-testing.
- Token/pointer routing engine with framework-neutral action contracts.

2. `src/ui-adapters/*` (harness app bindings)
- Convert workspace/domain/runtime state into package contracts.
- Bind package callbacks to `RuntimeWorkspaceActions` and control-plane ops.
- Keep harness-specific command/menu/task/repository behavior out of package.

3. `src/mux/live-mux/*` and `src/services/*` (feature/domain logic)
- Own business rules and state transitions.
- Consume package primitives through adapters, not vice versa.

### Composition Path
- `scripts/codex-live-mux-runtime.ts` -> `src/cli/runtime-app/mux-app.ts` -> `src/ui-adapters/mux/*` -> `packages/harness-ui/*`.

## Pathological Patterns Blocking Reuse
- Callback/property bag constructors with very high arity (`src/services/runtime-input-router.ts:24`).
- Composition root wiring hundreds of lines of lambdas (`scripts/codex-live-mux-runtime.ts:4068`).
- UI modules importing mux/domain directly (layer inversion) (`src/ui/modals/manager.ts:1`).
- “Pane class” wrappers that only pass through to mux functions; package boundary has no independent model (`src/ui/panes/left-rail.ts:1`).
- Repeated anonymous closures for identical effects (`markDirty`, `queueControlPlaneOp`, selector getters) across runtime/service setup (`scripts/codex-live-mux-runtime.ts:3816`).

## Extraction Order (Big Chunks)
1. Package foundation chunk:
- Move `surface`, `kit`, `wrapping-input`, theme primitives, and frame primitives into `packages/harness-ui`.
- Add adapter imports back into current mux runtime.
- Coverage checkpoint: strict gate on.

2. Package interaction chunk:
- Extract token/pointer routing core with neutral action interfaces.
- Replace runtime callback bag with 2-3 cohesive interfaces (`UiState`, `UiActions`, `UiEffects`).
- Coverage checkpoint: strict gate on.

3. Package overlay chunk:
- Extract generic modal stack manager and overlay hit-testing contracts.
- Keep harness-specific modal builders in `src/mux/live-mux/*`.
- Coverage checkpoint: strict gate on.

4. Composition-root cleanup chunk:
- Move mux app assembly from script into `src/cli/runtime-app/*`.
- Leave script as bootstrap wrapper only.
- Coverage checkpoint: strict gate on; restore strict as default.
