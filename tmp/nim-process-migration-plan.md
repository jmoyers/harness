# Nim Process Migration Plan (tmp)

Date: 2026-02-24
Owner: Codex
Status: checkpoint complete

## Confirmed Decisions

- New standalone app package path: `packages/nim`.
- `nim` is not part of `packages/harness-ui`; it consumes `harness-ui`.
- Harness left-rail `nim` behaves like thread processes: spawn + stream via PTY/control-plane path.
- Exactly one workspace-scoped `nim` process for now.
- Harness must monitor `nim` runtime state similarly to existing agent sessions.

## Objectives

1. Establish `packages/nim` as the only `nim` app implementation.
2. Route `harness nim` CLI command to `packages/nim`.
3. Replace mux `nim` pane special-case rendering with streamed process rendering.
4. Preserve/extend runtime status observability for `nim`.
5. Remove deprecated legacy nim pane path and old smoke-oriented protocol coupling.

## Constraints

- Bun-only scripts/tests.
- Keep files under 1000 LOC.
- Split along domain boundaries (bootstrap/runtime/state/ui/contracts).
- Preserve existing architecture laws from `design.md`/`agents.md`.

## Execution Plan

## Phase 1 — Package Extraction (`packages/nim`)

- [x] Create `packages/nim/src/contracts/*` for app interfaces and domain types.
- [x] Create `packages/nim/src/state/*` for nim app state and reducers/selectors.
- [x] Create `packages/nim/src/runtime/*` for `nim-core` runtime/session adapter.
- [x] Create `packages/nim/src/ui/*` for widget composition built from `harness-ui`.
- [x] Create `packages/nim/src/bootstrap/*` for CLI/env/config/session wiring.
- [x] Add `packages/nim/src/index.ts` public entry and executable wrapper.
- [x] Remove `packages/harness-ui/nim-standalone.ts` after replacement parity.

## Phase 2 — CLI Cutover (`harness nim`)

- [x] Replace `runNimTuiSmoke` path in `scripts/harness-runtime.ts` with `packages/nim` entry.
- [x] Keep compatibility for core flags (`--session`, `--model`, mock/live controls).
- [x] Update package `files` + scripts to include `packages/nim/src`.
- [x] Add/update unit tests for CLI dispatch and arg behavior.

## Phase 3 — Mux Integration as Process Stream

- [x] Introduce workspace-scoped nim process controller (single instance).
- [x] On left-rail `nim` open: spawn/connect nim process through same stream substrate as threads.
- [x] Render nim view through terminal frame path (thread-style), not `NimPane` row painter.
- [x] Forward input/escape/resize via standard session input path.
- [x] Emit status projection for nim process through existing status/attention model.

## Phase 4 — Deprecation Removal

- [x] Remove `src/services/runtime-nim-cli-session.ts` and old parsing behavior.
- [x] Remove `src/ui/panes/nim.ts` and its old tests.
- [x] Remove legacy smoke harness script and references.
- [x] Remove legacy ui integration naming and rename tests to generic naming.

## Phase 5 — Docs + Gates

- [x] Update `behavior.md` nim section to process-stream architecture.
- [x] Update `design.md` module references for standalone `packages/nim` app.
- [x] Update `README.md` user-visible `nim` behavior summary.
- [x] Run lint/type/test/coverage gates and close any regressions.

## Risks and Mitigations

- Risk: mux integration touches critical render/input path.
- Mitigation: convert nim path in small slices with compatibility flag and targeted integration tests.

- Risk: status parity drift between nim and other agents.
- Mitigation: add explicit state-transition integration tests using existing status projection harness.

## Immediate Next Slice

1. Keep validating nim process status parity with other agent sessions as additional status-hint edge cases are added.
2. Add explicit workspace-level guard tests for the single-nim-process invariant during repeated open/close cycles.
