# Cmd+P Shortcuts Migration Plan

## Scope Decisions (Locked)

- Add a dedicated `Shortcuts` action inside command menu.
- Remove left-rail shortcuts UI completely.
- Make all keybinds configurable by moving them into one registry.

## 1) Build One Canonical Keybinding Registry

- Create a new registry module (for example `src/mux/keybinding-registry.ts`) as source of truth.
- Each entry includes:
  - `actionId`
  - `screen` and `section` metadata (for shortcuts modal grouping)
  - human label and description
  - default bindings
- Move defaults out of:
  - `src/mux/input-shortcuts.ts`
  - `src/mux/task-screen-keybindings.ts`
  - repository fold chord constants in runtime

## 2) Make All Command Keys Configurable

- Global mux actions (`mux.*`) become registry-backed.
- Home/task actions (`mux.home.*`) become registry-backed.
- Repository fold/tree actions become registry actions:
  - expand/collapse selected group
  - expand-all/collapse-all
- Modal command keys become registry-backed where applicable:
  - command menu dismiss/submit/navigation
  - release notes modal controls
  - new-thread modal controls
  - task editor modal controls
- Selection copy shortcut becomes a registry action.
- Keep raw text-entry typing paths non-bindable (normal text input remains text-driven).

## 3) Add Shortcuts Action + 3-Column Modal

- Register a new command menu action (for example `shortcuts.open`) in `scripts/codex-live-mux-runtime.ts`.
- Add a dedicated command menu scope/state for shortcuts browsing.
- Render a large 3-column modal:
  - column 1: screen headers
  - column 2: actions for selected screen (or filtered result set)
  - column 3: effective bindings and default/override context
- Reuse existing command menu matcher behavior so search feels like current autocomplete.

## 4) Remove Left-Rail Shortcuts UI

- Remove shortcuts rows/header/toggle behavior from:
  - `src/mux/workspace-rail-model.ts`
  - `src/mux/workspace-rail.ts`
  - `src/mux/live-mux/rail-layout.ts`
  - related left-rail action handlers
- Remove `shortcutsCollapsed` from:
  - workspace state model
  - UI-state persistence
  - config/template paths that only exist for rail shortcuts

## 5) Config + Migration

- Continue using `mux.keybindings` in `harness.config.jsonc` as override surface.
- Validate override IDs against the registry.
- Unknown key IDs should warn and no-op.
- Add explicit config migration handling (config version bump) for removing `mux.ui.shortcutsCollapsed`.

## 6) Test, Perf, and Docs Gates

- Add/adjust unit tests for:
  - registry resolution
  - binding precedence/conflict behavior
  - per-scope detection
  - shortcuts modal rendering and navigation
- Update integration tests for `cmd+p` flow and `Shortcuts` action.
- Remove/update left-rail shortcuts tests.
- Run full verification:
  - `bun run verify`
- Run hot-path performance matrix before/after:
  - `bun run perf:mux:hotpath -- --matrix`
- Update docs to match behavior:
  - `design.md`
  - `README.md`

