# Agent Rules

This project has three core docs:

- `design.md`: enduring architecture and principles.
- `behavior.md`: feature behavior reference and interaction semantics.
- `agents.md`: execution workflow, quality gates, and contribution rules.

## Documentation Rules

- Keep `design.md`, `behavior.md`, and `agents.md` aligned with current behavior.
- Keep `README.md` aligned with user-visible value and verified outcomes.
- Keep `README.md` short and customer-facing; no internal CI/release/coverage mechanics.
- Keep architecture decisions in `design.md`, not in feature behavior docs.
- Keep implementation-detail behavior in `behavior.md`, not in architecture docs.
- Remove stale transitional statements as soon as a milestone is complete.
- Do not create competing architecture/rules sources outside these docs.

## Testing and Coverage Rules

- Bun-only repository: use `bun` for scripts, tests, lint, coverage, and CI tasks.
- Do not use `npm`, `npx`, `pnpm`, or `yarn`.
- 100% coverage is the project standard and required before merge to `main`.
- Unit, integration, and end-to-end coverage are all required.
- Every bug fix must include a negative test that fails before and passes after.
- Lint must pass with zero warnings and zero errors.
- Dead code is prohibited and must be verified by tooling.
- No skipped/quarantined/only tests.

## Commit Discipline

- Commit only at verified checkpoints (tests/benchmarks/acceptance checks).
- Keep commits scoped to one coherent change.
- Push after commit unless explicitly instructed otherwise.

## Permanent Architecture Laws

- TypeScript is strict and fully typed; avoid `any`.
- Files over 2000 LOC are design smells and must be factored.
- All client actions go through the Control Plane Stream API (no privileged client path).
- Human and agent clients maintain parity for supported operations.
- Stream transport is primary; request/response wrappers are optional overlays.
- Latency-critical paths stay first-party and dependency-restricted.
- Git is authoritative for diffs; adapter diffs are hints.
- Core task records are provider-agnostic; integration mappings stay in integration layers.
- Persistence uses shared tenanted SQLite with append-only `events` table.
- State/event writes are transactional.
- SQLite migrations are explicit, transactional, versioned (`PRAGMA user_version`), and fail closed on newer schema versions.
- All state access and stream operations enforce tenant/user boundaries.
- One logger abstraction (`log-core`) and one canonical structured log file (+ one sibling pretty log).
- One instrumentation abstraction (`perf-core`), permanent and globally toggleable.
- One config abstraction (`config-core`) and canonical config file (`harness.config.jsonc`).
- Config and runtime path resolution follow user-global, workspace-scoped rules from `design.md`.
- First-run legacy migration behavior follows `design.md` migration constraints.
- Config reload is atomic with last-known-good fallback.
- Hot-path multipliers require explicit justification and measured benefit.

## Temporary Refactor Policies (Active)

These are temporary hygiene constraints for the ongoing mux/runtime decomposition and are removed when replacement milestones are complete.

- Do not introduce callback/property mega-bags for runtime collaboration.
- Do not add class-shaped forwarding wrappers that only relay to free functions.
- Keep `scripts/*` as thin bootstrap wrappers; composition and behavior belong in `src/*`.
- `packages/harness-ui` must not import `src/*` runtime/mux/domain internals.
- Do not use `dependencies.foo ?? fooFrame` when `fooFrame` is app-layer behavior.
- Do not use `ConstructorParameters<typeof X>[0]` for cross-module contracts; use named interfaces.

## Quality Bar

- Untested behavior is incomplete.
- Docs that do not match behavior are incomplete.
- Code should satisfy all of the following:
  - single clear responsibility per module,
  - explicit names over implicit wiring,
  - minimal branching and indirection,
  - no ornamental abstractions.
- Remove replaced concepts once the replacement is verified; do not keep parallel legacy paths.
