# Nim Execution Checklist (Branch-Local / Temporary)

Branch: `jm/nim`
Owner: `nim` build stream
Status Date: 2026-02-20

## Execution Notes
- 2026-02-20: Phase A scaffolding created for `nim-core`, `nim-ui-core`, and `nim-test-tui`.
- 2026-02-20: New unit tests pass for schema/projection/independence.
- 2026-02-20: `bun run test:integration:nim:haiku` currently fails in this environment due Anthropic Haiku model availability (`404 not_found_error` for tested Haiku IDs).

## 0. Operating Rules
- [ ] Keep this checklist branch-local and temporary only.
- [ ] Keep proposal/spec (`tmp/nim-research-proposal.md`) aligned with implementation checkpoints.
- [ ] Keep `design.md` aligned when architecture decisions become implemented reality.

## 1. Phase A: Contracts + Event Schemas
- [x] Scaffold `packages/nim-core`.
- [x] Define runtime contracts (`NimRuntime`, session/turn handles, provider/tool source registration).
- [x] Define steering + follow-up queue contracts.
- [x] Define streaming contracts (`streamEvents` fidelity + `streamUi` modes).
- [x] Define canonical event envelope + lifecycle event taxonomy.
- [x] Add strict schema validation tests and negative tests.

## 2. Phase A.1: UI Library Extraction for Shared Consumption
- [x] Identify minimum UI projection logic that must be shared (`debug` + `seamless` projections).
- [x] Extract into first-party shared package (candidate: `packages/nim-ui-core`).
- [x] Ensure no privileged imports from harness runtime wiring.
- [x] Add architecture guard tests for dependency boundaries.

## 3. Phase A.2: Independent Test TUI
- [x] Scaffold independent TUI package/app built only on shared libraries (candidate: `packages/nim-test-tui`).
- [x] Confirm it can consume `nim-core` + `nim-ui-core` without importing harness mux runtime internals.
- [x] Add minimal command/event loop to exercise stream, tool call, thinking, and steering paths.
- [x] Add verification that human-facing harness UI is not a required runtime dependency.

## 4. Provider Baseline Throughout (Anthropic Haiku)
- [x] Add deterministic mock-provider tests for all contracts.
- [x] Add env-gated live Anthropic Haiku integration smoke.
- [x] Assert tool-call lifecycle visibility with Haiku path.
- [ ] Assert thinking/tool/assistant state transitions are observable in Haiku path.
- [ ] Run Haiku smoke in every integration sweep on this branch.

## 5. Functional Execution (per spec)
- [ ] Execute UC-01 through UC-12 progressively.
- [ ] Verify replay determinism from canonical event stream.
- [ ] Verify debug and seamless projections derive from same canonical events.

## 6. Quality Gates
- [ ] `bun run format:check`
- [ ] `bun run lint`
- [ ] `bun run typecheck`
- [ ] `bun run deadcode`
- [ ] `bun run test:coverage`
- [ ] `bun run test:integration:nim:haiku` (when env configured)

## 7. Finalization
- [ ] Summarize completed checkpoints and evidence.
- [ ] Delete this temporary checklist file (`tmp/nim-execution-checklist.md`) as the final step.
