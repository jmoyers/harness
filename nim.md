# nim Experiential Parity Design + Roadmap (Temporary)

Date: 2026-02-21  
Branch: `jm/nim-next`  
Status: planning document for execution; does not override `design.md`, `behavior.md`, or `agents.md`.

## 1. Intent

Ship a pinned nim experience inside the main Harness mux UI that feels like Codex in use, while remaining first-party and architecture-compliant:

- use Codex behavior and structure as reference only,
- do not import or reuse Codex libraries,
- build and extend our own `packages/harness-ui` primitives,
- route nim actions through Control Plane APIs/tools (no privileged side channel).

## 2. Experiential Target (v1)

The v1 experience is done when all are true:

- Left rail has a persistent `nim` sibling entry next to the existing top-level entries (`home`, `tasks`, etc).
- Selecting `nim` opens a dedicated right-pane nim session view instead of the standard conversation pane.
- nim view has a pinned bottom composer and streaming transcript above it.
- nim session continues running when the user leaves and re-enters the pane.
- nim exposes gateway/control-plane capabilities as tools so it can inspect and operate within Harness.
- nim supports two output modes:
- `user`: minimal, user-facing.
- `debug`: explicit lifecycle timeline (thinking/tool calls/state changes).
- Keyboard semantics are consistent:
- `Enter`: submit when idle, steer when active.
- `Tab`: queue follow-up.
- `Esc`: abort active run.

## 3. Constraints and Non-Goals

- All mutating operations remain behind Control Plane Stream command contracts.
- `packages/harness-ui` must not import `src/*` runtime internals.
- No callback mega-bags or forwarding wrapper classes.
- No nim-specific fork of the core mux runtime architecture.
- Non-goal for v1: full replacement of existing conversation rail/session model.
- Non-goal for v1: introducing external UI/rendering dependencies for the hot path.

## 4. Architecture Shape

```mermaid
flowchart LR
  A[Left Rail: nim item] --> B[WorkspaceModel leftNavSelection kind=nim]
  B --> C[nim Pane Runtime Service src/services]
  C --> D[nim-core runtime + provider router]
  D --> E[nim provider driver]
  E --> F[harness-ai streamText]
  C --> G[nim Tool Bridge]
  G --> H[Control Plane Service/Stream Commands]
  D --> I[nim canonical events]
  I --> J[nim UI projection]
  J --> K[harness-ui nim pane primitives]
```

### 4.1 Ownership Boundaries

- `packages/nim-core`: session/run orchestration, provider routing, canonical nim event stream.
- `src/services/runtime-nim-*`: mux app-layer lifecycle, subscriptions, action dispatch, tool bridge wiring.
- `src/mux/live-mux/*`: selection, navigation, and pane composition.
- `packages/harness-ui/src/*`: reusable rendering/input primitives used by mux and nim view.

### 4.2 Persistence Model

- Continue sqlite-backed nim stores (`events.sqlite`, `sessions.sqlite`) under harness runtime paths.
- Persist selected nim session ID in mux UI/app state so nim resumes after restart.
- Maintain tenant/user boundaries for every nim stream/read/write.

## 5. Module Plan

### 5.1 Navigation + Pane Routing

- Extend `LeftNavSelection` with `kind: 'nim'` in `src/mux/live-mux/left-nav.ts`.
- Add nim rail action/row projection in `src/mux/workspace-rail-model.ts`.
- Add nim entry dispatch in `src/services/left-rail-pointer-handler.ts`.
- Add `WorkspaceModel.enterNimPane()` and state fields in `src/domain/workspace.ts`.
- Extend right-pane branching in `src/services/runtime-right-pane-render.ts` to render nim pane when selected.

### 5.2 nim Pane UI Composition

- Add a dedicated nim pane composer/state reducer in `src/mux/live-mux/nim-pane.ts`.
- Add reusable primitives in `packages/harness-ui/src` for:
- transcript viewport with incremental append/scroll behavior,
- pinned multi-line composer,
- compact status/tool timeline rows.
- Reuse existing theme pipeline and add nim token surfaces in `src/ui/mux-theme*.ts` where needed.

### 5.3 Runtime Services for nim in Mux

- Add `src/services/runtime-nim-session.ts` for start/resume/switch-model lifecycle.
- Add `src/services/runtime-nim-stream-subscriptions.ts` for event/UI stream attachment and teardown.
- Add `src/services/runtime-nim-actions.ts` for send/steer/queue/abort.
- Add `src/services/runtime-nim-state.ts` for in-memory projection consumed by the nim pane.

### 5.4 Control Plane Tool Bridge

- Add `src/services/runtime-nim-tool-bridge.ts` mapping nim tool calls to typed Control Plane operations.
- v1 tool categories:
- workspace introspection (`directory.list`, `repository.list`, `task.list`, `session.list`),
- conversation/session control (`session.status`, `session.respond`, `session.interrupt`),
- project/review visibility (`github.project-review`, `project.status`).
- Mutating tools ship in guarded steps with explicit allowlist and evented audit in nim timeline.

### 5.5 CLI and Entry Points

- Keep `scripts/nim-tui-smoke.ts` as a smoke harness.
- Route production UX through `harness` mux runtime, not a parallel standalone nim app.

## 6. Roadmap

### Phase 0: Baseline and Contracts

- [ ] Define `nim` left-nav selection and pane-mode contract.
- [ ] Define nim pane state model and reducer inputs.
- [ ] Define nim tool bridge interface with typed command/result envelopes.
- Exit criteria:
- compile-time contracts in place with unit tests for parser/reducer behavior.

### Phase 1: Pinned nim Shell in Mux

- [x] Add nim left-rail item and selection behavior.
- [x] Add empty/skeleton nim right pane with pinned composer/footer.
- [x] Persist/restore nim pane selection state.
- Exit criteria:
- nim is reachable via pointer + keyboard cycle and survives app restart.

### Phase 2: Runtime Wiring (Mock and Deterministic)

- [x] Instantiate/reuse nim runtime handle from mux services.
- [x] Wire send/steer/queue/abort to nim actions.
- [x] Render streamed deltas + state transitions in the nim pane.
- Exit criteria:
- deterministic mock mode fully functional in mux with replayable event trace.

### Phase 3: Control Plane Tool Surface

- [x] Implement read-first tool bridge to control-plane commands.
- [x] Surface tool lifecycle (start/args/result/error) in debug mode.
- [x] Add policy allow/deny control for nim tool exposure.
- Exit criteria:
- nim can inspect Harness state via tools and show observable lifecycle.

### Phase 4: Live Provider and Parity Polish

- [x] Enable Anthropic driver path via existing `nim-core` driver registration.
- [x] Improve composer ergonomics, timeline compaction, and status/footer clarity.
- [x] Add keybinding parity (`Enter`/`Tab`/`Esc`) in mux runtime.
- Exit criteria:
- live run in mux replicates expected Codex-like flow with our UI stack.

### Phase 5: Hardening and Readiness

- [x] Unit/integration/e2e coverage at project standards.
- [x] Performance pass on render path and event fanout.
- [x] Update `behavior.md` for new surfaces once behavior is implemented.
- Exit criteria:
- feature is reliable under restart, queue, abort, and tool-heavy runs.

Performance baseline notes (2026-02-22):

- Command:
  - `bun run scripts/perf-mux-hotpath-harness.ts --duration-ms 3000 --output-hz 120 --input-hz 60 --sessions 2 --active-share 1 --profile mixed --seed 7`
- Result highlights:
  - `render-total p95=0.395ms`
  - `event-loop delay p95=1.142ms`

- Command:
  - `bun run scripts/perf-mux-hotpath-harness.ts --duration-ms 3000 --output-hz 240 --chunks-per-tick 2 --bytes-per-chunk 320 --input-hz 120 --sessions 4 --active-share 0.75 --profile ansi --seed 7`
- Result highlights:
  - `render-total p95=0.351ms`
  - `event-loop delay p95=1.023ms`

- Interpretation:
  - render/ingest timings remain sub-millisecond at p95 in both baseline and stress configurations,
  - event-loop delay remained low single-digit milliseconds with no starvation indicators in this harness pass.

## 7. Test Plan (By Surface)

- Left rail selection and routing:
- `test/mux-workspace-rail-model.test.ts`
- `test/services-left-rail-pointer-handler.test.ts` (new)
- `test/mux-live-mux-global-shortcut-handlers.test.ts`

- Workspace/pane state:
- `test/domain-workspace.test.ts`
- `test/services-runtime-right-pane-render.test.ts`
- `test/services-mux-ui-state-persistence.test.ts`

- nim runtime wiring:
- `test/nim-core-runtime.test.ts`
- `test/nim-runtime-provider-driver.test.ts`
- `test/nim-functional-use-cases.test.ts`
- `test/services-runtime-nim-*.test.ts` (new)

- Tool bridge and control-plane parity:
- `test/control-plane-api-parity.test.ts`
- `test/services-runtime-control-plane-ops.test.ts`
- `test/services-runtime-nim-tool-bridge.test.ts` (new)

- End-to-end behavior:
- `test/codex-live-mux-startup.integration.test.ts` (extend with nim pane path)
- `test/nim-tui-smoke.test.ts`
- `scripts/integration-nim-haiku.ts` in CI gate for live validation.

## 8. Delivery Slices (Proposed PR Order)

1. PR-1: left rail `nim` entry + pane shell + persisted selection.
2. PR-2: nim runtime service wiring with mock mode and event rendering.
3. PR-3: control-plane read tools and debug lifecycle projection.
4. PR-4: live provider path + keybinding and UX parity polish.
5. PR-5: coverage closure, perf validation, and docs alignment updates.

## 9. Open Decisions

Resolved:
- Single nim session is workspace-scoped for v1.
- Mutating control-plane tools are deferred to v1.1.
- Debug timeline remains visible in `debug` mode; user-facing mode is named `user`.

## 10. Immediate Next Step

- Phase 5 is complete for v1 scope.
- Next: plan v1.1 mutating control-plane tool rollout with explicit policy and audit surfaces.
