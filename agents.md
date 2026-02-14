# Agent Rules

This project has two core documents:
- `design.md`: living system design and principles.
- `agents.md`: living execution and quality rules.

## Documentation Rules
- Keep `design.md` and `agents.md` continuously aligned with reality.
- Keep `README.md` continuously aligned with reality.
- `README.md` must stay conceptually compelling and progress-oriented: clearly communicate why the project matters and what has been verifiably achieved.
- Update `design.md` whenever architecture, principles, or major behavior changes.
- Prefer principles and system design over implementation trivia.
- Do not create competing “source of truth” docs for core architecture/rules.

## Testing and Coverage Rules
- 100% code coverage is required across the project.
- Coverage compliance must be continuously verified (local + CI), not assumed.
- Unit tests, integration tests, and end-to-end tests are all required.
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
- All client actions must go through the Control Plane Stream API (TCP/WS). No privileged client path.
- Human and agent clients must have parity for all supported operations.
- Stream transport is primary; request/response wrappers are optional layers over the stream protocol.
- Latency-critical hot paths must remain first-party and dependency-restricted.
- Git is the authoritative source for diffs; adapter diffs are hints only.
- Persistence is one shared tenanted SQLite store with an append-only `events` table.
- State and event writes must be transactional in SQLite.
- All state access and streams must enforce tenant/user boundaries.
- One logger abstraction (`log-core`) is used everywhere.
- One canonical structured log file is the source of truth, with one sibling pretty log file.
- One instrumentation abstraction (`perf-core`) is used everywhere.
- Instrumentation is permanent, controlled by one global boolean, and must support near-no-op disabled mode.
- One config abstraction (`config-core`) and one canonical config file (`harness.config.jsonc`) govern runtime behavior.
- Config reload must be atomic with last-known-good fallback on invalid config.

## Quality Bar
- If behavior is not tested, it is not done.
- If docs do not match behavior, the change is not done.
- Code style must be minimal, functional, and beautiful: simple structure, clear names, and no ornamental complexity.
- Remove dead concepts immediately once a replacement is verified; do not keep parallel legacy paths.
