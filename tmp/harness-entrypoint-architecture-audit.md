# Harness Entrypoint Architecture Audit

## Architectural Issue Spotted
- De-facto monolith: `scripts/harness-runtime.ts` (4,387 LOC) concentrates command parsing, runtime bootstrapping, gateway lifecycle, locking, process discovery, auth/OAuth, profile workflows, artifact state I/O, and CLI presentation in one unit (`scripts/harness-runtime.ts:1`).

## Call Path (Current)
1. `scripts/harness-bin.js` validates Bun, adds migration hinting, and `spawn`s Bun for `scripts/harness.ts` (`scripts/harness-bin.js:55`, `scripts/harness-bin.js:74`).
2. `scripts/harness.ts` normalizes args and dispatches through Oclif `execute` (`scripts/harness.ts:24`, `scripts/harness.ts:42`).
3. `scripts/harness-commands.ts` command classes strip `--session` and delegate to runtime exports (`scripts/harness-commands.ts:30`, `scripts/harness-commands.ts:74`).
4. `scripts/harness-runtime.ts` initializes runtime and executes subcommand-specific flows (`scripts/harness-runtime.ts:4225`, `scripts/harness-runtime.ts:4256`).

## Proposed Module Architecture

### 1) Bootstrap Layer (`scripts/harness-bin.js`, `src/cli/bootstrap/*`)
- Bun runtime guard before CLI execution.
- Legacy lockfile migration warning path.
- Process-level env seeding (`HARNESS_INVOKE_CWD`).
- Exit-code normalization for child process signals.

### 2) CLI Surface Layer (`scripts/harness.ts`, `scripts/harness-commands.ts`, `src/cli/router/*`)
- Root arg normalization to implicit `client` command.
- Root help/version passthrough behavior.
- Top-level command registration via Oclif classes.
- Session flag extraction and passthrough argv shaping.

### 3) Runtime Context Layer (`src/cli/runtime-context/*`)
- Invocation directory resolution.
- Legacy runtime/config migration trigger.
- Secrets/config load on process start.
- Script path resolution from env overrides.
- Session-scoped path graph derivation.

### 4) Gateway Domain Layer (`src/cli/gateway/*`)
- Gateway command parsing (`start/stop/status/restart/run/call/gc`).
- Gateway settings resolution (host/port/auth/state DB).
- Gateway readiness probe over stream API.
- Detached gateway launch and record creation.
- Foreground gateway launch path.
- Gateway stop semantics with force/timeouts.
- Session GC lifecycle for stale named sessions.

### 5) Locking + State Store Layer (`src/cli/state/*`)
- Gateway lock acquisition/retry/release semantics.
- Atomic text file writes for runtime artifacts.
- Gateway record read/write/remove behavior.
- Active profile state read/write/remove.
- Active status-timeline state read/write/remove.
- Active render-trace state read/write/remove.

### 6) Process Introspection Layer (`src/cli/process/*`)
- Process table snapshot (`ps`) parsing.
- Daemon candidate inference from command strings.
- PID liveness checks and signal orchestration.
- Orphan process classification by runtime scope.
- Orphan cleanup execution and reporting.

### 7) Auth Integration Layer (`src/cli/auth/*`)
- Auth command parsing (`status/login/refresh/logout`).
- OAuth device flow for GitHub.
- OAuth PKCE callback flow for Linear.
- Token refresh and expiry heuristics.
- Secrets upsert/delete and env synchronization.
- Browser-launch abstraction for auth URLs.

### 8) Workflow Layer (`src/cli/workflows/*`)
- Default client workflow (ensure gateway then run mux).
- Profile run workflow (ephemeral profiled gateway + profiled client).
- Profile start/stop via inspector runtime.
- Status timeline start/stop artifact workflow.
- Render trace start/stop artifact workflow.
- Cursor hooks install/uninstall workflow.
- Diff/Nim/Animate delegation workflow.

### 9) Presentation Layer (`src/cli/output/*`)
- Human-readable status and lifecycle messages.
- Usage text rendering.
- Error-to-exit mapping for command boundaries.

## Functionality Inventory (Terse Fragments)

### Bootstrap + Entry
- Bun-only guard + early process exit on missing runtime.
- Workspace lockfile hygiene hinting.
- Child process invocation envelope for CLI runtime.

### CLI Routing
- Default-command coercion to `client`.
- Root token routing for known top-level commands.
- Per-command session extraction and passthrough argv forwarding.

### Runtime Initialization
- Invocation cwd normalization.
- One-time legacy runtime migration trigger.
- Secrets/config preload side effect.
- Session-aware artifact path resolution.

### Gateway Operations
- Gateway lifecycle state machine (`start|stop|status|restart|run`).
- Record-based daemon adoption and stale-record healing.
- Endpoint probing over control-plane stream client.
- Named-session port fallback reservation.
- Session garbage collection with liveness + age checks.

### Process + Locking
- Lockfile-based serialization of gateway control operations.
- PID identity validation via start-time fingerprinting.
- Orphan process scanning by command signature.
- Terminate/kill escalation with timeout polling.

### Profile/Trace/Timeline
- CPU profile capture workflows (live inspector + run mode).
- Profile state persistence and compatibility checks.
- Status timeline artifact activation/deactivation.
- Render trace artifact activation/deactivation.

### Auth + Secrets
- GitHub device-flow login and token storage.
- Linear PKCE callback login and token storage.
- Linear refresh-token auto-refresh before gateway starts.
- Manual token vs OAuth token source precedence reporting.
- Secret-file line editing and env mutation.

### Misc Commands
- Cursor managed hook installation lifecycle.
- Diff UI passthrough execution.
- Animation and Nim smoke delegations.
- Self-update command through global Bun install.

## Pathological Patterns Driving Boilerplate/Bloat

1. Mixed abstraction layers in one file.
- Parsing, domain policy, infra side effects, and presentation share one module (`scripts/harness-runtime.ts:403`, `scripts/harness-runtime.ts:2694`, `scripts/harness-runtime.ts:3498`, `scripts/harness-runtime.ts:4210`).
- Result: hard-to-test flows, broad change blast radius, and “edit-anything-break-everything” coupling.

2. Duplicated CLI parsing surfaces.
- Session parsing/normalization exists in both `harness.ts` and command classes and runtime-level parse helpers (`scripts/harness.ts:24`, `scripts/harness-commands.ts:30`, `scripts/harness-runtime.ts:403`).
- Result: repeated edge-case logic and divergence risk.

3. Options/command callback-bag proliferation.
- Many near-identical per-command option interfaces and parse loops (`scripts/harness-runtime.ts:105`, `scripts/harness-runtime.ts:475`, `scripts/harness-runtime.ts:889`, `scripts/harness-runtime.ts:707`).
- Callback wrappers (`withLock`) repeatedly shape inline execution bags (`scripts/harness-runtime.ts:3509`).
- Result: high boilerplate-to-behavior ratio.

4. Long positional parameter lists (stringly context passing).
- Core orchestrators pass many path/runtime parameters positionally (`scripts/harness-runtime.ts:3498`, `scripts/harness-runtime.ts:3697`, `scripts/harness-runtime.ts:3739`).
- Result: fragile call sites and low readability.

5. Heavy global side-effect coupling.
- Direct `process.env`, `process.stdout`, `process.stderr`, `process.cwd`, `process.execPath` usage across most logic (`scripts/harness-runtime.ts:3017`, `scripts/harness-runtime.ts:3522`, `scripts/harness-runtime.ts:4233`).
- Result: poor determinism and expensive unit testing.

6. Repeated handwritten state serialization patterns.
- Parallel read/write/remove logic for multiple state files with similar control flow (`scripts/harness-runtime.ts:2238`, `scripts/harness-runtime.ts:2258`, `scripts/harness-runtime.ts:2288`).
- Result: repetition and drift opportunity.

7. OS/process-table parsing embedded in command runtime.
- `ps` parsing and daemon detection heuristics live beside command handlers (`scripts/harness-runtime.ts:2388`, `scripts/harness-runtime.ts:2438`, `scripts/harness-runtime.ts:2506`).
- Result: platform-coupled complexity leaking into CLI orchestration.

8. Command handlers mix domain decisions and output rendering.
- Branch-heavy handler prints user output inline with control logic (`scripts/harness-runtime.ts:3513`).
- Result: difficult reuse for machine-mode/API surfaces.

## Refactor Direction (Minimal First Slices)
1. Extract `RuntimeContext` object from `initializeHarnessRuntime`; replace long positional args in all `run*Cli` and `run*CommandEntry` calls.
2. Extract gateway lifecycle (`ensure/start/stop/probe/adopt`) into `src/cli/gateway/service.ts`; keep command handlers as thin adapters.
3. Extract auth OAuth/secrets flows into `src/cli/auth/service.ts`; leave only routing in runtime entrypoint.
4. Consolidate repeated state-file IO into generic typed state-store helpers.
5. Centralize arg parsing schema per command to remove duplicated flag loops and session parsing split.

## Execution Checkpoint (This Change)
- Applied step 1 in-place: command entry paths now consume a single `HarnessRuntimeContext` instead of long positional argument lists.
- Reduced wiring complexity across gateway/client/profile/status-timeline/render-trace/auth/cursor-hooks command entry functions.
- Kept behavior and CLI surface stable; full `bun run verify` passed after refactor.
- Migration caveat: moving the whole runtime monolith into `src/**` immediately trips strict per-file coverage gates; extraction to `src` must happen in tested slices, not one bulk move.
