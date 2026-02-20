export type DiffMode = 'unstaged' | 'staged' | 'range';

export type FileChangeType =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'binary'
  | 'submodule'
  | 'type-change'
  | 'unknown';

export type DiffCoverageReason =
  | 'none'
  | 'max-files'
  | 'max-lines'
  | 'max-hunks'
  | 'max-bytes'
  | 'max-runtime-ms';

export interface DiffSpec {
  readonly diffId: string;
  readonly mode: DiffMode;
  readonly baseRef: string | null;
  readonly headRef: string | null;
  readonly generatedAt: string;
}

export interface DiffLine {
  readonly kind: 'context' | 'add' | 'del';
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly text: string;
}

export interface DiffHunk {
  readonly hunkId: string;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly header: string;
  readonly lines: readonly DiffLine[];
  readonly lineCount: number;
  readonly addCount: number;
  readonly delCount: number;
}

export interface DiffFile {
  readonly fileId: string;
  readonly changeType: FileChangeType;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly language: string | null;
  readonly isBinary: boolean;
  readonly isGenerated: boolean;
  readonly isTooLarge: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly hunks: readonly DiffHunk[];
}

export interface DiffTotals {
  readonly filesChanged: number;
  readonly additions: number;
  readonly deletions: number;
  readonly binaryFiles: number;
  readonly generatedFiles: number;
  readonly hunks: number;
  readonly lines: number;
}

export interface DiffCoverage {
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly skippedFiles: number;
  readonly truncatedFiles: number;
  readonly reason: DiffCoverageReason;
}

export interface NormalizedDiff {
  readonly spec: DiffSpec;
  readonly files: readonly DiffFile[];
  readonly totals: DiffTotals;
  readonly coverage: DiffCoverage;
}

export interface DiffChunk {
  readonly chunkId: string;
  readonly fileId: string;
  readonly path: string;
  readonly sequence: number;
  readonly totalForFile: number;
  readonly hunkIds: readonly string[];
  readonly approxTokens: number;
  readonly approxBytes: number;
  readonly payload: {
    readonly fileHeader: string;
    readonly hunks: readonly DiffHunk[];
  };
}

export interface DiffBudget {
  readonly maxFiles: number;
  readonly maxHunks: number;
  readonly maxLines: number;
  readonly maxBytes: number;
  readonly maxRuntimeMs: number;
}

export interface DiffBuildOptions {
  readonly cwd: string;
  readonly mode: DiffMode;
  readonly baseRef?: string;
  readonly headRef?: string;
  readonly includeGenerated?: boolean;
  readonly includeBinary?: boolean;
  readonly budget: DiffBudget;
  readonly git?: {
    readonly noRenames?: boolean;
    readonly renameLimit?: number;
  };
}

export interface DiffBuildDiagnostics {
  readonly elapsedMs: number;
  readonly peakBufferBytes: number;
  readonly parseWarnings: readonly string[];
}

export interface DiffBuildResult {
  readonly diff: NormalizedDiff;
  readonly diagnostics: DiffBuildDiagnostics;
}

export type DiffStreamEvent =
  | { readonly type: 'start'; readonly mode: DiffMode }
  | { readonly type: 'file'; readonly file: DiffFile }
  | { readonly type: 'hunk'; readonly fileId: string; readonly hunk: DiffHunk }
  | {
      readonly type: 'progress';
      readonly files: number;
      readonly hunks: number;
      readonly lines: number;
    }
  | { readonly type: 'coverage'; readonly coverage: DiffCoverage }
  | { readonly type: 'complete'; readonly diff: NormalizedDiff };

export interface ChunkPolicy {
  readonly maxHunksPerChunk: number;
  readonly maxLinesPerChunk: number;
  readonly maxApproxTokensPerChunk: number;
}

export interface DiffBuilder {
  build(options: DiffBuildOptions): Promise<DiffBuildResult>;
  stream(options: DiffBuildOptions): AsyncIterable<DiffStreamEvent>;
}

export interface DiffChunker {
  chunk(diff: NormalizedDiff, policy: ChunkPolicy): readonly DiffChunk[];
  streamChunks(diff: NormalizedDiff, policy: ChunkPolicy): AsyncIterable<DiffChunk>;
}

export const DEFAULT_DIFF_BUDGET: DiffBudget = {
  maxFiles: 3000,
  maxHunks: 20000,
  maxLines: 300000,
  maxBytes: 64 * 1024 * 1024,
  maxRuntimeMs: 60_000,
};

export const DEFAULT_CHUNK_POLICY: ChunkPolicy = {
  maxHunksPerChunk: 8,
  maxLinesPerChunk: 800,
  maxApproxTokensPerChunk: 4000,
};
