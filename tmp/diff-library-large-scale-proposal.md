# diff Library Design Proposal

## Status

- Branch: `jm/diff`
- Date: 2026-02-20
- Scope: phase 1 diff substrate (implemented in `src/diff/*`)

## Objective

Build a first-party `diff` library optimized for very large repositories and branch deltas with strict memory budgets and stream-first APIs.

## Non-Goals (Phase 1)

- No review/finding policy logic.
- No provider-specific AI logic.
- No UI rendering concerns.

## Design Principles

1. Git is authoritative for repository diffs.
2. Streaming first: never require full patch text in memory.
3. Deterministic identity: stable IDs for diff/file/hunk/chunk.
4. Budget-aware by default: explicit truncation and coverage semantics.
5. Provider-agnostic model suitable for UI, automation, and future AI review.

## Public Data Model

Defined in `src/diff/types.ts`:

- `DiffMode`: `unstaged | staged | range`
- `DiffSpec`: identity + refs + timestamp metadata
- `DiffLine`, `DiffHunk`, `DiffFile`: canonical normalized patch representation
- `DiffTotals`: file/hunk/line/add/del counters
- `DiffCoverage`: completeness/truncation contract with reason codes
- `NormalizedDiff`: top-level payload
- `DiffChunk`: deterministic chunk unit for downstream streaming

Coverage reason contract:

- `none`
- `max-files`
- `max-hunks`
- `max-lines`
- `max-bytes`
- `max-runtime-ms`

## Public API

Defined in `src/diff/types.ts`, exposed via `src/diff/index.ts`.

### Build API

- `createDiffBuilder(): DiffBuilder`
- `DiffBuilder.build(options): Promise<DiffBuildResult>`
- `DiffBuilder.stream(options): AsyncIterable<DiffStreamEvent>`

`DiffBuildOptions` includes:

- cwd and diff mode (`unstaged`, `staged`, `range`)
- optional `baseRef`/`headRef` for range mode
- include/exclude generated and binary files
- budget caps: files/hunks/lines/bytes/runtime
- git flags: rename behavior (`noRenames`, `renameLimit`)

`DiffStreamEvent` lifecycle:

- `start`
- `hunk`
- `file`
- `progress`
- `coverage`
- `complete`

### Chunk API

- `createDiffChunker(): DiffChunker`
- `DiffChunker.chunk(diff, policy): DiffChunk[]`
- `DiffChunker.streamChunks(diff, policy): AsyncIterable<DiffChunk>`

Chunk policy is deterministic and budgeted by hunks/lines/approx tokens.

## Module Boundaries

Implemented first-party layout:

- `src/diff/types.ts`
  - Canonical contracts and defaults.
- `src/diff/hash.ts`
  - Stable deterministic IDs (`diffId`, `fileId`, `hunkId`, `chunkId`).
- `src/diff/normalize.ts`
  - Path normalization, language inference, generated-file heuristics, change-type resolution.
- `src/diff/budget.ts`
  - Budget tracking for file/hunk/line/byte/runtime limits.
- `src/diff/git-invoke.ts`
  - Git arg construction, subprocess line streaming, preflight metadata reads.
- `src/diff/git-parse.ts`
  - Streaming patch parser for `git diff --patch` output.
- `src/diff/build.ts`
  - Builder orchestration and stream event lifecycle.
- `src/diff/chunker.ts`
  - Deterministic chunk planning/streaming.
- `src/diff/index.ts`
  - Public export surface.

Boundary rules:

- `git-invoke.ts` owns process execution only.
- `git-parse.ts` is domain parser only (no process control).
- `chunker.ts` consumes only normalized model.
- callers depend only on `types` + `build` + `chunker` API surfaces.

## Performance and Memory Strategy

### Git Strategy

- Preflight via metadata queries (`name-status`, `numstat`) for sizing.
- Parse patch stream line-by-line (`git diff --patch ...`).
- Use performance-safe defaults (`--no-ext-diff`, `--no-color`, `--no-renames` by default).

### Memory Strategy

- No full patch buffering.
- Keep parser state to current file/hunk + normalized outputs.
- Budget counters run during stream ingestion.
- Emit incremental events for low-latency consumers.

### Large-Diff Behavior

When limits trigger:

- stop ingesting additional units
- emit partial valid diff payload
- return explicit `coverage` truncation details
- retain deterministic IDs for consumed units

## Future AI Review Readiness

The phase 1 `diff` model is intentionally shaped for a later review engine:

- structured hunks/chunks with stable IDs
- deterministic chunk boundaries for retries/resume
- `DiffBuilder.stream()` for backpressure-safe ingestion
- `DiffChunker.streamChunks()` for provider streaming pipelines

This enables a future review layer without changing the diff substrate contract.

## Validation Status (Current Branch)

- Unit/integration tests added for all `src/diff/*` modules.
- Diff module coverage reaches 100% lines and functions for `src/diff/*` suite.

## Next Steps

1. Add hot-path perf harness scenarios for monorepo-scale branches.
2. Add optional stream-only mode to avoid full diff accumulation when callers only need chunk events.
3. Integrate `diff` builder/chunker into command surfaces for higher-level review workflows.
