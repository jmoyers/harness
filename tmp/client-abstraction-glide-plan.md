# Client-Abstraction Glide Plan (jm/client-abstraction)

## Current State
- Branch: `jm/client-abstraction`
- Latest checkpoints:
  - `3b58734` Flatten runtime stream subscriptions wrapper
  - `5baa136` Remove runtime directory action bridge layer
  - `0d5f2d2` Flatten runtime conversation and git state action wrappers
  - `202ed15` Flatten runtime control/repository/editor/envelope action classes

## Scope Guardrails
- No web client implementation in this branch.
- No transport/protocol changes required for this glide-down phase.
- Focus strictly on removing transitional glue/wrapper layers and clarifying domain boundaries.

## Done Criteria
- No class-shaped forwarding wrappers that only relay to free functions.
- Runtime composition uses direct domain references or stateful engines only where mutable state/timers are required.
- Removed bridge modules are deleted (not left as compatibility shims).
- Runtime wiring + startup integration tests pass after each large cut.

## Execution Slices

### Slice 1 (completed)
- Replace `RuntimeStreamSubscriptions` class with stateful factory API.
- Rewire `ConversationLifecycle` to consume the factory output.
- Update `test/services-runtime-stream-subscriptions.test.ts`.

### Slice 2 (completed)
- Flatten `RuntimeConversationActivation` into factory/function service if no external state is required.
- Rewire `ConversationLifecycle` + activation tests.

### Slice 3 (completed)
- Flatten `RuntimeConversationTitleEditService` and `RuntimeConversationStarter` if wrappers remain purely orchestration.
- Preserve explicit option contracts and timer behavior.

### Slice 4 (in progress)
- Keep only true state engines and avoid new compatibility bridges:
  - `runtime-layout-resize`
  - `runtime-project-pane-github-review-cache`
  - `runtime-command-menu-agent-tools`
  - `runtime-task-composer-persistence`
- Rename survivors to reflect state ownership (engine/controller semantics) where useful.
- Remove duplicated parser paths where one canonical contracts parser can be used.

## Validation Gates Per Slice
- `bun run lint`
- `bun run typecheck`
- Targeted service tests for touched modules
- Runtime wiring + startup integration suites

## Final Branch Glide-Down
- Full test + coverage gates restored before merge to `main`.
- Remove stale transitional language in docs (`design.md`, `behavior.md`, `agents.md`).
- Keep final commit sequence as large coherent slices plus one stabilization/docs checkpoint.
