# Agent Harness Design

## Document Authority

This repository uses three architecture-adjacent documents with different authority levels:

- `design.md`: enduring principles, boundaries, and architecture constraints.
- `behavior.md`: implementation-level behavior reference (command menu, modal/input semantics, rendering rules).
- `agents.md`: execution quality, testing, and workflow rules for contributors/agents.

When documents conflict:

1. `agents.md` governs execution quality and delivery gates.
2. `design.md` governs architecture and boundary decisions.
3. `behavior.md` is feature reference and must not override architecture laws.

## Purpose

Build a high-performance, terminal-first harness for running and supervising many concurrent AI coding conversations across workspaces/directories, with:

- reliable attention/status signaling,
- fast context switching,
- API parity between human and automation clients,
- first-party control of latency-critical paths,
- auditable normalized events.

## Product Outcomes

- 5+ active conversations/workspaces with low interaction overhead.
- Constant-time navigation between workspace contexts.
- Durable session continuity (pause/resume/fork/archive).
- One control surface for both human and agent clients.
- Deterministic, replayable event/state history.

## Non-Goals

- Full IDE replacement.
- Deep file editing inside harness UI.
- Agent-specific product forks that violate shared control-plane semantics.

## Architecture (Current Runtime)

```txt
[Human TUI] [Automation Client] [Optional Remote Client]
            \      |      /
             +-- Control Plane Stream API --+
                            |
                            v
                     Harness Runtime/Daemon
                    - command handlers
                    - session lifecycle
                    - normalized event pipeline
                    - shared config/log/perf cores
                    - SQLite state+event persistence
                    - adapter integrations (codex/claude/cursor/...)
```

## Control Plane and Parity

All client actions (human and agent) flow through the Control Plane Stream API.

- No privileged TUI-only mutation path.
- Commands are validated, executed, and emitted as auditable events.
- API parity is tested, not assumed.

This keeps human and automated workflows behaviorally equivalent and observable.

## Runtime Module Boundaries

The runtime is organized by responsibility:

- `src/domain/*`: mutable business state and deterministic state transitions.
- `src/services/*`: orchestration and IO-facing workflows.
- `packages/harness-ui/*`: reusable terminal UI primitives and interaction building blocks.
- `src/mux/runtime-app/*`: mux runtime composition root and application assembly.
- `scripts/*`: bootstrap wrappers only; no business logic.

Boundary constraints:

- `packages/harness-ui` must not import `src/*` app/domain internals.
- app-specific policies live in `src/services/*` and are injected via explicit interfaces.
- composition roots assemble collaborators; business rules remain in owning modules.

## Anti-Glue Architecture Laws

These are permanent design constraints:

- Do not use callback/property mega-bags as primary collaboration surfaces.
- Do not add class-shaped forwarding wrappers that just relay option bags.
- Do not hide app-policy coupling behind package defaults (`foo ?? frameFoo`).
- Prefer explicit named interfaces over inferred constructor plumbing across modules.
- Keep composition logic in composition roots, not middle-layer wiring adapters.

A class is warranted when it owns decisions, lifecycle, or invariants; not when it only forwards calls.

## Data Model

Canonical hierarchy:

```txt
Tenant -> User -> Workspace -> Directory/Worktree -> Conversation -> Turn -> Event
```

Related entities (repositories, tasks, project settings, runtime/session metadata) are tenant/user scoped and linked by stable IDs.

## Event Model

- Runtime emits normalized events independent of provider-specific formats.
- Provider payloads are adapter concerns; normalized events are product concerns.
- Event streams are replayable and support attention/status projection.
- Status/attention signals must remain explicit, deterministic, and test-covered.

## Persistence Model

- One shared tenanted SQLite store.
- `events` table is append-only source of truth for event history.
- State+event writes are transactional.
- Migrations are explicit, transactional, versioned (`PRAGMA user_version`).
- Unknown newer schema versions fail closed.

## Configuration Model

- One config abstraction: `config-core`.
- Canonical user-global config path:
  - `$XDG_CONFIG_HOME/harness/harness.config.jsonc`, else
  - `~/.harness/harness.config.jsonc`
- Config includes explicit `configVersion` and migration path.
- Runtime paths are user-global and workspace-scoped under:
  - `$XDG_CONFIG_HOME/harness/workspaces/<workspace-slug>/...`, else
  - `~/.harness/workspaces/<workspace-slug>/...`
- Config reload is atomic with last-known-good fallback.

## Observability Model

- One logger abstraction (`log-core`) everywhere.
- One canonical structured log + one sibling pretty log.
- One instrumentation abstraction (`perf-core`) everywhere.
- Instrumentation is permanent and globally toggleable with near-no-op disabled mode.

## Performance and Dependency Policy

- Latency-critical hot paths are first-party and dependency-restricted.
- Git is authoritative for diff/state comparisons; adapter diffs are hints.
- Performance-sensitive changes require measurable before/after validation.

## Client Surfaces

Primary surfaces:

- TUI client (first-party).
- Automation agent client (first-party).
- Optional remote/web client over the same control-plane protocol.

All surfaces follow the same command/event contracts.

## GitHub Branch Review Surface

Project-scoped GitHub review state is exposed as a control-plane-backed left-rail node (revealed on demand from command palette) with a dedicated main-panel details view.

- Source command: `github.project-review` (directory-scoped).
- Left rail interaction: command-palette GitHub thread open reveals a navigable GitHub rail node for that project and can expand compact PR summary details in-rail.
- Branch context: tracked branch name plus source (`pinned` or `current`).
- PR lifecycle projection: `draft`, `open`, `merged`, `closed`.
- Review thread projection: open and resolved thread groups with per-comment author/body metadata.

This keeps final-review state visible in primary navigation while preserving one control-plane command/event boundary for both human and automation clients.

## Evolution Rules

- Transitional notes belong in milestone planning docs, not enduring architecture sections.
- Completed transitional states must be removed immediately from architecture docs.
- Architecture docs state what is true now and what is permanently constrained.

## References

- Behavior and feature-level interaction semantics: `behavior.md`
- Contributor/agent workflow and quality gates: `agents.md`
- User-facing project narrative and value: `README.md`
