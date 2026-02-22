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
- [x] Keep shared fixtures in `test/helpers` and remove duplication.
- [x] Run `bun test` and `bun test --concurrent` to verify.

## Notes
- Bun-only execution; no npm/pnpm/yarn.
- Keep edits incremental with checkpoints.

## Progress Update
- Completed: parallel-flaky fixes and full `bun test --concurrent` green.
- Completed: migrated flat `test/*` into domain-aligned `test/unit/*` and `test/integration/*`.
- Completed: split large hotspots into focused files:
  - initial `harness-cli` split -> 4 files
  - `codex-live-mux-startup.integration` -> 3 files
- Completed: split `harness-cli-gateway-client-profile` into:
  - `test/unit/cli/gateway/harness-cli-gateway-client-lifecycle-health.test.ts`
  - `test/unit/cli/gateway/harness-cli-gateway-client-default-autostart.test.ts`
  - `test/unit/cli/gateway/harness-cli-gateway-client-named-session-autostart.test.ts`
- Completed: split `harness-cli-gc-orphan-cleanup` into:
  - `test/unit/cli/gateway/harness-cli-gateway-gc-policy.test.ts`
  - `test/unit/cli/gateway/harness-cli-gateway-stop-orphan-cleanup.test.ts`
- Completed: split `harness-cli-bootstrap-auth-help` into focused files:
  - `test/unit/cli/gateway/harness-cli-gateway-bootstrap-migration.test.ts`
  - `test/unit/cli/auth/harness-cli-auth-oauth.test.ts`
  - `test/unit/cli/runtime/harness-cli-update-upgrade.test.ts`
  - `test/unit/cli/runtime/harness-cli-cursor-hooks-help-animate.test.ts`
- Completed: aligned `test/unit/cli/*` with `src/cli/*` subdomains:
  - `test/unit/cli/auth`
  - `test/unit/cli/gateway`
  - `test/unit/cli/parsing`
  - `test/unit/cli/runtime`
  - `test/unit/cli/workflows`
- Completed: set `bun run test` and `bun run test:coverage` to use stable `--concurrent` mode.
- Completed: extracted shared helpers for split `harness-cli*` tests into `test/helpers/harness-cli-test-helpers.ts`.
- Completed: extracted shared helpers for split `codex-live-mux-startup*` tests into `test/helpers/codex-live-mux-startup-test-helpers.ts`.
- Completed: added non-locking `createConcurrentCliTest()` and migrated `harness-cli-bootstrap-auth-help` + `harness-cli-status-render-throughput` to run safely without per-file serialization lock.
- Verified-unsafe for intra-file parallelism (kept serial wrapper):
  - `harness-cli-gateway-client-lifecycle-health` + related gateway auto-start tests (gateway lifecycle/profile collisions)
  - `harness-cli-gateway-stop-orphan-cleanup` (stop/orphan cleanup collisions)
- Latest verification:
  - `bun run lint` -> pass
  - `bun run typecheck` -> pass
  - `bun test --concurrent test/unit/cli` -> pass (`75 pass`, ~18.05s wall clock)
  - `bun run test` -> pass (`1690 pass`, ~37.97s wall clock)
