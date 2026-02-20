export { createDiffBuilder } from './build.ts';
export { createDiffChunker } from './chunker.ts';
export { DEFAULT_CHUNK_POLICY, DEFAULT_DIFF_BUDGET } from './types.ts';
export type {
  ChunkPolicy,
  DiffBudget,
  DiffBuildDiagnostics,
  DiffBuildOptions,
  DiffBuildResult,
  DiffBuilder,
  DiffChunk,
  DiffChunker,
  DiffCoverage,
  DiffCoverageReason,
  DiffFile,
  DiffHunk,
  DiffLine,
  DiffMode,
  DiffSpec,
  DiffStreamEvent,
  DiffTotals,
  FileChangeType,
  NormalizedDiff,
} from './types.ts';
