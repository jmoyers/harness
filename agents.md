# Agent Rules

This project has two core documents:

- `design.md`: living system design and principles.
- `agents.md`: living execution and quality rules.

## Documentation Rules

- Keep `design.md` and `agents.md` continuously aligned with reality.
- Keep `README.md` continuously aligned with reality.
- `README.md` must stay conceptually compelling and progress-oriented: clearly communicate why the project matters and what has been verifiably achieved.
- `README.md` is market/customer/user-facing: keep it short, relevant, and focused on user value, workflows, and outcomes.
- Do not add maintainer/internal content to `README.md` (release mechanics, CI wiring, coverage gates, deep implementation details); keep that in `design.md`/`agents.md` or other internal docs.
- Update `design.md` whenever architecture, principles, or major behavior changes.
- Prefer principles and system design over implementation trivia.
- Do not create competing “source of truth” docs for core architecture/rules.

## Testing and Coverage Rules

- This project is Bun-only: use `bun` for test, lint, coverage, scripts, dependency management, and CI task execution.
- Do not use `npm`, `npx`, `pnpm`, or `yarn` commands in local workflows or CI for this repository.
- 100% code coverage is required across the project.
- Coverage compliance must be continuously verified (local + CI), not assumed.
- Unit tests, integration tests, and end-to-end tests are all required.
- Every bug fix must add a negative test that fails before the fix and passes after it.
- Prefer a unit-level negative test when possible; if not sufficient, add an integration/E2E reproduction; for performance bugs, add or update a performance-harness regression check.
- Linting must pass at 100% (zero warnings, zero errors) before completion.
- Dead code is prohibited and must be verified by tooling in local + CI gates.
- No artificial test skipping: no `skip`, `only`, quarantined suites, or silent exclusions.
- Failures or coverage regressions block completion until fixed.

## Commit Discipline

- Commit often, but only after verified output.
- Every commit must correspond to a concrete, demonstrated checkpoint (tests, benchmark gate, or acceptance check).
- Do not batch unrelated changes into a single commit.
- Push whenever you commit unless explicitly told not to push.

## Architecture Laws

- Code is strict, actually typed TypeScript. Avoid `any`; type safety is required.
- Files should not exceed 2000 LOC; crossing that threshold is a design smell and requires factoring into modules.
- All client actions must go through the Control Plane Stream API (TCP/WS). No privileged client path.
- Human and agent clients must have parity for all supported operations.
- Stream transport is primary; request/response wrappers are optional layers over the stream protocol.
- Latency-critical hot paths must remain first-party and dependency-restricted.
- Git is the authoritative source for diffs; adapter diffs are hints only.
- Persistence is one shared tenanted SQLite store with an append-only `events` table.
- State and event writes must be transactional in SQLite.
- SQLite schema migrations must be explicit, transactional, and versioned (`PRAGMA user_version`); unknown newer schema versions must fail closed.
- All state access and streams must enforce tenant/user boundaries.
- One logger abstraction (`log-core`) is used everywhere.
- One canonical structured log file is the source of truth, with one sibling pretty log file.
- One instrumentation abstraction (`perf-core`) is used everywhere.
- Instrumentation is permanent, controlled by one global boolean, and must support near-no-op disabled mode.
- One config abstraction (`config-core`) and one canonical config file (`harness.config.jsonc`) govern runtime behavior.
- Config path resolution is user-global: prefer `$XDG_CONFIG_HOME/harness/harness.config.jsonc`, otherwise `~/.harness/harness.config.jsonc`.
- Runtime artifact path resolution is user-global and workspace-scoped: prefer `$XDG_CONFIG_HOME/harness/workspaces/<workspace-slug>/...`, otherwise `~/.harness/workspaces/<workspace-slug>/...`.
- Gateway lifecycle control is per-session and lock-serialized (`gateway.lock`) under the workspace runtime path.
- Gateway record loss (`gateway.json`) must be recoverable via deterministic daemon adoption; ambiguous matches must fail closed.
- First run must migrate legacy local workspace artifacts from `<workspace>/.harness` into the user-global workspace-scoped runtime path, and migrate legacy local `harness.config.jsonc` when the global config is uninitialized (missing, empty, or bootstrapped default) without overwriting user-customized global config.
- After successful/safe migration, the legacy local `<workspace>/.harness` root should be pruned to avoid stale local runtime/config directories.
- First-run config bootstrapping must copy the checked-in template (`src/config/harness.config.template.jsonc`).
- `harness.config.jsonc` must include a top-level `configVersion`; config changes require explicit migration handling for older versions.
- Runtime feature/perf toggles are config-first (`harness.config.jsonc`); environment variables are only for process bootstrap plumbing, not the primary behavior surface.
- Config reload must be atomic with last-known-good fallback on invalid config.
- Performance changes must be validated with the isolated mux hot-path harness matrix before and after edits (`parse-passes`, protocol roundtrip, snapshot-hash, recording pass).
- Hot-path cost multipliers (extra VTE parse passes, per-frame full-frame hashing, recording re-parse) require explicit justification and measurable benefit.

## Quality Bar

- If behavior is not tested, it is not done.
- If docs do not match behavior, the change is not done.
- Code style must be minimal, functional, and beautiful: simple structure, clear names, and no ornamental complexity.
- Remove dead concepts immediately once a replacement is verified; do not keep parallel legacy paths.
