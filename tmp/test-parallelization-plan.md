# Test Parallelization Plan (Working)

Date: 2026-02-21

## Goal
1. Fix currently failing tests under `bun test --concurrent`.
2. Split test suite into domain-aligned directories and reduce wall-clock bottlenecks.

## Phase 1: Stabilize Parallel Execution
- [x] Reproduce failures in parallel mode for known files:
  - `test/harness-cli.test.ts`
  - `test/pty_host.test.ts`
  - `test/diff-git-invoke.test.ts`
  - `test/workflow-inspector.test.ts`
- [x] Identify shared-state/resource collisions (env vars, sockets/ports, files, global singletons, timers).
- [x] Patch tests/helpers to isolate resources per test and avoid cross-test interference.
- [x] Verify each file with `bun test --concurrent <file>`.
- [x] Verify combined with `bun test --concurrent` for full suite.

## Phase 2: Clean Split / Organization
- [x] Create directory structure aligned to `src/*` plus test type (`unit`, `integration`).
- [x] Move files into domain directories without behavior change.
- [x] Split hotspot mega-files (`harness-cli`, `codex-live-mux-startup.integration`) by feature areas.
- [ ] Keep shared fixtures in `test/helpers` and remove duplication.
- [x] Run `bun test` and `bun test --concurrent` to verify.

## Notes
- Bun-only execution; no npm/pnpm/yarn.
- Keep edits incremental with checkpoints.

## Progress Update
- Completed: parallel-flaky fixes and full `bun test --concurrent` green.
- Completed: migrated flat `test/*` into domain-aligned `test/unit/*` and `test/integration/*`.
- Completed: split large hotspots into focused files:
  - `harness-cli` -> 4 files
  - `codex-live-mux-startup.integration` -> 3 files
- Completed: set `bun run test` and `bun run test:coverage` to use stable `--concurrent` mode.
- Remaining: reduce helper duplication across split files by extracting shared fixtures from `harness-cli*` and `codex-live-mux-startup*`.
