import { DiffBudgetTracker } from './budget.ts';
import { computeDiffId } from './hash.ts';
import {
  buildGitDiffArgs,
  readGitDiffPreflight,
  streamGitLines,
  type GitDiffInvocationOptions,
} from './git-invoke.ts';
import { GitDiffPatchParser } from './git-parse.ts';
import type {
  DiffBuildOptions,
  DiffBuildResult,
  DiffBuilder,
  DiffCoverage,
  DiffCoverageReason,
  DiffStreamEvent,
  NormalizedDiff,
} from './types.ts';

interface BuildHooks {
  emit(event: DiffStreamEvent): void;
}

interface NormalizedBuildOptions {
  readonly cwd: string;
  readonly mode: DiffBuildOptions['mode'];
  readonly baseRef: string | null;
  readonly headRef: string | null;
  readonly includeGenerated: boolean;
  readonly includeBinary: boolean;
  readonly noRenames: boolean;
  readonly renameLimit: number | null;
  readonly budget: DiffBuildOptions['budget'];
}

function normalizeOptions(options: DiffBuildOptions): NormalizedBuildOptions {
  return {
    cwd: options.cwd,
    mode: options.mode,
    baseRef: options.baseRef ?? null,
    headRef: options.headRef ?? null,
    includeGenerated: options.includeGenerated ?? false,
    includeBinary: options.includeBinary ?? false,
    noRenames: options.git?.noRenames ?? true,
    renameLimit:
      typeof options.git?.renameLimit === 'number' && Number.isFinite(options.git.renameLimit)
        ? Math.max(0, Math.floor(options.git.renameLimit))
        : null,
    budget: options.budget,
  };
}

function toInvocationOptions(options: NormalizedBuildOptions): GitDiffInvocationOptions {
  return {
    cwd: options.cwd,
    mode: options.mode,
    baseRef: options.baseRef,
    headRef: options.headRef,
    noRenames: options.noRenames,
    renameLimit: options.renameLimit,
  };
}

function resolveCoverage(input: {
  filesObservedInPreflight: number;
  filesIncluded: number;
  filesSkippedByFilter: number;
  filesTruncatedByBudget: number;
  limitReason: DiffCoverageReason;
}): DiffCoverage {
  const remainder = Math.max(
    0,
    input.filesObservedInPreflight - input.filesIncluded - input.filesSkippedByFilter,
  );
  const truncatedByLimit = input.limitReason !== 'none' ? remainder : 0;
  const truncatedFiles = Math.max(input.filesTruncatedByBudget, truncatedByLimit);
  const skippedFiles = Math.max(
    input.filesSkippedByFilter,
    input.filesObservedInPreflight - input.filesIncluded - truncatedFiles,
  );
  return {
    complete: input.limitReason === 'none' && truncatedFiles === 0,
    truncated: input.limitReason !== 'none' || truncatedFiles > 0,
    skippedFiles,
    truncatedFiles,
    reason: input.limitReason,
  };
}

async function runBuild(
  rawOptions: DiffBuildOptions,
  hooks?: BuildHooks,
): Promise<DiffBuildResult> {
  const options = normalizeOptions(rawOptions);
  const startedAtMs = Date.now();
  hooks?.emit({
    type: 'start',
    mode: options.mode,
  });
  const invocation = toInvocationOptions(options);
  const preflight = await readGitDiffPreflight(invocation, options.budget.maxRuntimeMs);

  const budget = new DiffBudgetTracker(options.budget, startedAtMs);
  const parser = new GitDiffPatchParser({
    includeGenerated: options.includeGenerated,
    includeBinary: options.includeBinary,
    budget,
    onHunk: (fileId, hunk) => {
      hooks?.emit({
        type: 'hunk',
        fileId,
        hunk,
      });
      const usage = budget.usage();
      hooks?.emit({
        type: 'progress',
        files: usage.files,
        hunks: usage.hunks,
        lines: usage.lines,
      });
    },
    onFile: (file) => {
      hooks?.emit({
        type: 'file',
        file,
      });
      const usage = budget.usage();
      hooks?.emit({
        type: 'progress',
        files: usage.files,
        hunks: usage.hunks,
        lines: usage.lines,
      });
    },
  });

  const patchResult = await streamGitLines({
    cwd: options.cwd,
    args: buildGitDiffArgs(invocation, 'patch'),
    timeoutMs: options.budget.maxRuntimeMs,
    onBytes: (bytes) => budget.addBytes(bytes).allowed,
    onLine: (line) => parser.pushLine(line),
  });
  if (patchResult.exitCode !== 0 && !patchResult.aborted)
    throw new Error(`git diff --patch failed: ${patchResult.stderr || 'unknown error'}`);

  const parsed = parser.finish();
  const limitReason: DiffCoverageReason =
    parsed.limitReason === 'none' && patchResult.timedOut ? 'max-runtime-ms' : parsed.limitReason;
  const coverage = resolveCoverage({
    filesObservedInPreflight: preflight.filesChanged,
    filesIncluded: parsed.files.length,
    filesSkippedByFilter: parsed.skippedFiles,
    filesTruncatedByBudget: parsed.truncatedFiles,
    limitReason,
  });
  const generatedAt = new Date().toISOString();
  const diff: NormalizedDiff = {
    spec: {
      diffId: computeDiffId(options.mode, options.baseRef, options.headRef, parsed.files),
      mode: options.mode,
      baseRef: options.baseRef,
      headRef: options.headRef,
      generatedAt,
    },
    files: parsed.files,
    totals: parsed.totals,
    coverage,
  };

  const parseWarnings = [...parsed.warnings];
  const expectedTotal = parsed.files.length + coverage.skippedFiles + coverage.truncatedFiles;
  if (expectedTotal !== preflight.filesChanged) {
    parseWarnings.push(
      `preflight mismatch: filesChanged=${preflight.filesChanged} accounted=${expectedTotal}`,
    );
  }

  hooks?.emit({
    type: 'coverage',
    coverage,
  });
  hooks?.emit({
    type: 'complete',
    diff,
  });

  return {
    diff,
    diagnostics: {
      elapsedMs: Math.max(0, Date.now() - startedAtMs),
      peakBufferBytes: patchResult.peakLineBufferBytes,
      parseWarnings,
    },
  };
}

async function* streamDiff(options: DiffBuildOptions): AsyncIterable<DiffStreamEvent> {
  const events: DiffStreamEvent[] = [];
  let notifyNext: (() => void) | null = null;
  let done = false;
  let failure: unknown = null;

  const notify = (): void => {
    const callback = notifyNext;
    notifyNext = null;
    callback?.();
  };

  void runBuild(options, {
    emit(event) {
      events.push(event);
      notify();
    },
  })
    .then(() => {
      done = true;
      notify();
    })
    .catch((error: unknown) => {
      failure = error;
      done = true;
      notify();
    });

  while (true) {
    while (events.length > 0) {
      const event = events.shift();
      if (event !== undefined) {
        yield event;
      }
    }

    if (failure !== null) {
      throw failure;
    }

    if (done) {
      return;
    }

    await new Promise<void>((resolve) => {
      notifyNext = resolve;
    });
  }
}

export function createDiffBuilder(): DiffBuilder {
  return {
    build: async (options: DiffBuildOptions): Promise<DiffBuildResult> => await runBuild(options),
    stream: streamDiff,
  };
}
