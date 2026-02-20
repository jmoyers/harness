# diff UI Toolkit Implementation Plan (Temporary)

## Status

- Branch: `jm/diff`
- Date: 2026-02-20
- Scope: execute phase-1 implementation on top of `src/diff/*`

## Objective

Ship a first-party standalone diff UI process that is:

- large-diff aware
- keyboard-first
- theme and syntax-capable
- programmable through structured commands/events

## Delivery Strategy

Implement in small, test-locked phases with each phase runnable independently.

## Phase 1 (Execute Now): Read-Only Viewer + Programmatic Core

## Deliverables

1. `src/diff-ui/types.ts`
   - canonical UI model/state/command/event contracts
2. `src/diff-ui/args.ts`
   - standalone CLI option parsing/validation
3. `src/diff-ui/model.ts`
   - virtual row index from `NormalizedDiff`
4. `src/diff-ui/finder.ts`
   - fuzzy file finder scoring/ranking
5. `src/diff-ui/state.ts`
   - reducer for view mode, scroll, file/hunk nav, finder lifecycle
6. `src/diff-ui/highlight.ts`
   - lightweight first-party syntax tokenization (bounded)
7. `src/diff-ui/render.ts`
   - unified/split viewport rendering + theme + optional syntax coloring
8. `src/diff-ui/runtime.ts`
   - orchestrate diff build, state transitions, render output, rpc-stdio command mode
9. `src/diff-ui/index.ts`
   - public exports
10. `scripts/harness-diff.ts`
   - standalone process entrypoint

## Acceptance Criteria

- one-shot render works for unstaged/staged/range modes
- `--view auto|split|unified`, `--syntax auto|on|off`, and `--no-color` are respected
- file/hunk navigation commands can be driven programmatically (rpc-stdio)
- finder query + select changes active file focus
- output is deterministic under fixed width/height and options
- all new code is fully covered by tests

## Phase 2: Interactive Input Loop + Finder/Search Overlays

## Deliverables

- live key input loop (non-blocking raw input)
- finder overlay UI composition and keyboard selection
- in-viewport search (`/`, `n`, `N`)
- explicit keymap module with config overrides

## Acceptance Criteria

- parity with phase-1 command bus actions through keyboard path
- no privileged keyboard-only operations (all map to commands)

## Phase 3: Performance and Scale Hardening

## Deliverables

- viewport virtualization with overscan windows
- bounded highlight cache and per-frame work budgets
- degrade-path orchestration (word diff off, syntax fallback, unified fallback)
- perf harness scenarios for huge diffs

## Acceptance Criteria

- bounded memory growth under large synthetic repos
- stable frame latency under configured thresholds

## Phase 4: Review-Ready Streaming Hooks

## Deliverables

- event stream hooks for chunk/anchor handoff
- optional non-UI `--json-events` and `--snapshot` integration workflows
- command/event contracts locked for downstream review engine

## Acceptance Criteria

- structured diff window/chunk data can be consumed externally without UI coupling

## Implementation Notes

- Reuse existing UI primitives (`src/ui/surface.ts`, `src/ui/screen.ts`, `padOrTrimDisplay`).
- Keep diff-ui renderer role-based (semantic roles -> style), not hardcoded ANSI at call sites.
- Keep runtime process standalone; avoid coupling to mux runtime lifecycle.
- Keep source of diff truth in `src/diff/*` only.

## Test Matrix (Phase 1)

- args parse/validation branches
- model row indexing and anchor integrity
- finder ranking and tie behavior
- state reducer navigation/finder transitions
- syntax tokenizer branches and fallback behavior
- render unified/split and theme/color toggles
- runtime one-shot and rpc command execution

## Execution Decision

Proceed with full Phase 1 implementation now.
