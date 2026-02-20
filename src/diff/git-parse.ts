import { computeDiffFileId, computeDiffHunkId, serializeHunkLinesForHash } from './hash.ts';
import {
  inferLanguageFromPath,
  isGeneratedPath,
  normalizeDiffPath,
  resolveFileChangeType,
} from './normalize.ts';
import type { DiffBudgetTracker } from './budget.ts';
import type {
  DiffCoverageReason,
  DiffFile,
  DiffHunk,
  DiffLine,
  DiffTotals,
  FileChangeType,
} from './types.ts';

interface MutableHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  lines: DiffLine[];
  addCount: number;
  delCount: number;
  oldCursor: number;
  newCursor: number;
}

interface MutableFile {
  changeTypeHint: FileChangeType | null;
  oldPath: string | null;
  newPath: string | null;
  isBinary: boolean;
  isGenerated: boolean;
  isTooLarge: boolean;
  hunks: MutableHunk[];
}

function parseHunkHeader(line: string): {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
} | null {
  const matched = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/u.exec(line);
  if (matched === null) {
    return null;
  }
  const oldStart = Number.parseInt(matched[1]!, 10);
  const oldCount = Number.parseInt(matched[2] ?? '1', 10);
  const newStart = Number.parseInt(matched[3]!, 10);
  const newCount = Number.parseInt(matched[4] ?? '1', 10);
  const suffix = matched[5] ?? '';
  return {
    oldStart,
    oldCount,
    newStart,
    newCount,
    header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${suffix}`,
  };
}

function parseTokenList(raw: string): readonly string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < raw.length) {
    while (index < raw.length && raw[index] === ' ') {
      index += 1;
    }
    if (index >= raw.length) {
      break;
    }
    if (raw[index] === '"') {
      index += 1;
      let token = '';
      while (index < raw.length) {
        const char = raw[index]!;
        if (char === '\\') {
          const next = raw[index + 1] ?? '';
          if (next.length > 0) {
            token += next;
            index += 2;
            continue;
          }
        }
        if (char === '"') {
          index += 1;
          break;
        }
        token += char;
        index += 1;
      }
      tokens.push(token);
      continue;
    }
    let token = '';
    while (index < raw.length && raw[index] !== ' ') {
      token += raw[index]!;
      index += 1;
    }
    tokens.push(token);
  }
  return tokens;
}

function stripGitPrefix(value: string, prefix: 'a/' | 'b/'): string {
  if (value.startsWith(prefix)) {
    return value.slice(prefix.length);
  }
  return value;
}

function parseDiffGitPaths(
  line: string,
): { oldPath: string | null; newPath: string | null } | null {
  const prefix = 'diff --git ';
  if (!line.startsWith(prefix)) {
    return null;
  }
  const tokens = parseTokenList(line.slice(prefix.length));
  if (tokens.length < 2) {
    return null;
  }
  const oldToken = tokens[0]!;
  const newToken = tokens[1]!;
  return {
    oldPath: normalizeDiffPath(stripGitPrefix(oldToken, 'a/')),
    newPath: normalizeDiffPath(stripGitPrefix(newToken, 'b/')),
  };
}

function parsePatchPathLine(line: string, marker: '--- ' | '+++ '): string | null | undefined {
  if (!line.startsWith(marker)) {
    return undefined;
  }
  const raw = line.slice(marker.length).split('\t')[0] ?? '';
  if (raw === '/dev/null') {
    return null;
  }
  if (raw.startsWith('a/')) {
    return raw.slice(2);
  }
  if (raw.startsWith('b/')) {
    return raw.slice(2);
  }
  return raw;
}

interface GitDiffPatchParserOptions {
  readonly includeGenerated: boolean;
  readonly includeBinary: boolean;
  readonly budget: DiffBudgetTracker;
  readonly onFile?: (file: DiffFile) => void;
  readonly onHunk?: (fileId: string, hunk: DiffHunk) => void;
}

interface GitDiffPatchParserResult {
  readonly files: readonly DiffFile[];
  readonly totals: DiffTotals;
  readonly warnings: readonly string[];
  readonly skippedFiles: number;
  readonly truncatedFiles: number;
  readonly limitReason: DiffCoverageReason;
}

export class GitDiffPatchParser {
  private currentFile: MutableFile | null = null;
  private currentHunk: MutableHunk | null = null;
  private readonly files: DiffFile[] = [];
  private readonly warnings: string[] = [];
  private skippedFiles = 0;
  private truncatedFiles = 0;
  private halted = false;

  constructor(private readonly options: GitDiffPatchParserOptions) {}

  pushLine(line: string): boolean {
    if (this.halted) {
      return false;
    }
    const runtimeCheck = this.options.budget.checkRuntime();
    if (!runtimeCheck.allowed) {
      this.halted = true;
      this.markTruncatedCurrentFile();
      return false;
    }

    const parsedPaths = parseDiffGitPaths(line);
    if (parsedPaths !== null) {
      this.finalizeCurrentFile();
      const generated = isGeneratedPath(parsedPaths.newPath ?? parsedPaths.oldPath);
      this.currentFile = {
        changeTypeHint: null,
        oldPath: parsedPaths.oldPath,
        newPath: parsedPaths.newPath,
        isBinary: false,
        isGenerated: generated,
        isTooLarge: false,
        hunks: [],
      };
      this.currentHunk = null;
      if (generated && !this.options.includeGenerated) {
        this.skippedFiles += 1;
      } else {
        const tookFile = this.options.budget.takeFile();
        if (!tookFile.allowed) {
          this.markTruncatedCurrentFile();
          this.halted = true;
          return false;
        }
      }
      return true;
    }

    if (this.currentFile === null) {
      return true;
    }
    if (this.shouldSkipCurrentFile()) {
      return true;
    }

    const oldPathPatch = parsePatchPathLine(line, '--- ');
    if (oldPathPatch !== undefined) {
      this.currentFile.oldPath = normalizeDiffPath(oldPathPatch);
      return true;
    }
    const newPathPatch = parsePatchPathLine(line, '+++ ');
    if (newPathPatch !== undefined) {
      this.currentFile.newPath = normalizeDiffPath(newPathPatch);
      return true;
    }

    if (line.startsWith('new file mode ')) {
      this.currentFile.changeTypeHint = 'added';
      return true;
    }
    if (line.startsWith('deleted file mode ')) {
      this.currentFile.changeTypeHint = 'deleted';
      return true;
    }
    if (line.startsWith('rename from ')) {
      this.currentFile.changeTypeHint = 'renamed';
      this.currentFile.oldPath = normalizeDiffPath(line.slice('rename from '.length));
      return true;
    }
    if (line.startsWith('rename to ')) {
      this.currentFile.changeTypeHint = 'renamed';
      this.currentFile.newPath = normalizeDiffPath(line.slice('rename to '.length));
      return true;
    }
    if (line.startsWith('copy from ')) {
      this.currentFile.changeTypeHint = 'copied';
      this.currentFile.oldPath = normalizeDiffPath(line.slice('copy from '.length));
      return true;
    }
    if (line.startsWith('copy to ')) {
      this.currentFile.changeTypeHint = 'copied';
      this.currentFile.newPath = normalizeDiffPath(line.slice('copy to '.length));
      return true;
    }
    if (line.startsWith('similarity index ')) {
      return true;
    }
    if (line.startsWith('dissimilarity index ')) {
      return true;
    }
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      this.currentFile.isBinary = true;
      this.currentFile.changeTypeHint = 'binary';
      if (!this.options.includeBinary) {
        this.skippedFiles += 1;
      }
      return true;
    }
    if (line.startsWith('old mode ') || line.startsWith('new mode ')) {
      if (
        this.currentFile.changeTypeHint === null ||
        this.currentFile.changeTypeHint === 'unknown' ||
        this.currentFile.changeTypeHint === 'modified'
      ) {
        this.currentFile.changeTypeHint = 'type-change';
      }
      return true;
    }

    const parsedHunk = parseHunkHeader(line);
    if (parsedHunk !== null) {
      const tookHunk = this.options.budget.takeHunk();
      if (!tookHunk.allowed) {
        this.markTruncatedCurrentFile();
        this.halted = true;
        return false;
      }
      this.finalizeCurrentHunk();
      this.currentHunk = {
        oldStart: parsedHunk.oldStart,
        oldCount: parsedHunk.oldCount,
        newStart: parsedHunk.newStart,
        newCount: parsedHunk.newCount,
        header: parsedHunk.header,
        lines: [],
        addCount: 0,
        delCount: 0,
        oldCursor: parsedHunk.oldStart,
        newCursor: parsedHunk.newStart,
      };
      return true;
    }

    if (this.currentHunk !== null) {
      if (line.startsWith('\\ No newline at end of file')) {
        return true;
      }
      const first = line[0] ?? '';
      if (first !== ' ' && first !== '+' && first !== '-') {
        return true;
      }
      const tookLine = this.options.budget.takeLine();
      if (!tookLine.allowed) {
        this.markTruncatedCurrentFile();
        this.halted = true;
        return false;
      }
      const normalizedText = line.slice(1);
      let normalizedLine: DiffLine;
      if (first === '+') {
        normalizedLine = {
          kind: 'add',
          oldLine: null,
          newLine: this.currentHunk.newCursor,
          text: normalizedText,
        };
        this.currentHunk.addCount += 1;
        this.currentHunk.newCursor += 1;
      } else if (first === '-') {
        normalizedLine = {
          kind: 'del',
          oldLine: this.currentHunk.oldCursor,
          newLine: null,
          text: normalizedText,
        };
        this.currentHunk.delCount += 1;
        this.currentHunk.oldCursor += 1;
      } else {
        normalizedLine = {
          kind: 'context',
          oldLine: this.currentHunk.oldCursor,
          newLine: this.currentHunk.newCursor,
          text: normalizedText,
        };
        this.currentHunk.oldCursor += 1;
        this.currentHunk.newCursor += 1;
      }
      this.currentHunk.lines.push(normalizedLine);
    }
    return true;
  }

  finish(): GitDiffPatchParserResult {
    this.finalizeCurrentFile();
    const totals: DiffTotals = {
      filesChanged: this.files.length,
      additions: this.files.reduce((sum, file) => sum + file.additions, 0),
      deletions: this.files.reduce((sum, file) => sum + file.deletions, 0),
      binaryFiles: this.files.reduce((sum, file) => sum + (file.isBinary ? 1 : 0), 0),
      generatedFiles: this.files.reduce((sum, file) => sum + (file.isGenerated ? 1 : 0), 0),
      hunks: this.files.reduce((sum, file) => sum + file.hunks.length, 0),
      lines: this.files.reduce(
        (sum, file) => sum + file.hunks.reduce((hunkSum, hunk) => hunkSum + hunk.lineCount, 0),
        0,
      ),
    };
    return {
      files: this.files,
      totals,
      warnings: this.warnings,
      skippedFiles: this.skippedFiles,
      truncatedFiles: this.truncatedFiles,
      limitReason: this.options.budget.limitReason(),
    };
  }

  private shouldSkipCurrentFile(): boolean {
    if (this.currentFile === null) {
      return false;
    }
    if (this.currentFile.isGenerated && !this.options.includeGenerated) {
      return true;
    }
    if (this.currentFile.isBinary && !this.options.includeBinary) {
      return true;
    }
    return false;
  }

  private markTruncatedCurrentFile(): void {
    if (this.currentFile === null) {
      return;
    }
    this.currentFile.isTooLarge = true;
    this.truncatedFiles += 1;
  }

  private finalizeCurrentHunk(): void {
    if (this.currentFile === null || this.currentHunk === null) {
      return;
    }
    this.currentFile.hunks.push(this.currentHunk);
    this.currentHunk = null;
  }

  private finalizeCurrentFile(): void {
    if (this.currentFile === null) {
      return;
    }
    this.finalizeCurrentHunk();
    if (this.shouldSkipCurrentFile()) {
      this.currentFile = null;
      return;
    }
    const resolvedOldPath = normalizeDiffPath(this.currentFile.oldPath);
    const resolvedNewPath = normalizeDiffPath(this.currentFile.newPath);
    const changeType = resolveFileChangeType({
      fromHeader: this.currentFile.changeTypeHint,
      oldPath: resolvedOldPath,
      newPath: resolvedNewPath,
      isBinary: this.currentFile.isBinary,
    });
    const fileId = computeDiffFileId(changeType, resolvedOldPath, resolvedNewPath);
    const finalHunks: DiffHunk[] = [];
    for (const hunk of this.currentFile.hunks) {
      const diffHunk: DiffHunk = {
        hunkId: computeDiffHunkId(fileId, hunk.header, serializeHunkLinesForHash(hunk.lines)),
        oldStart: hunk.oldStart,
        oldCount: hunk.oldCount,
        newStart: hunk.newStart,
        newCount: hunk.newCount,
        header: hunk.header,
        lines: hunk.lines,
        lineCount: hunk.lines.length,
        addCount: hunk.addCount,
        delCount: hunk.delCount,
      };
      finalHunks.push(diffHunk);
      this.options.onHunk?.(fileId, diffHunk);
    }
    if (resolvedOldPath === null && resolvedNewPath === null) {
      this.warnings.push('skipped file record with null oldPath/newPath');
      this.currentFile = null;
      return;
    }
    const diffFile: DiffFile = {
      fileId,
      changeType,
      oldPath: resolvedOldPath,
      newPath: resolvedNewPath,
      language: inferLanguageFromPath(resolvedNewPath ?? resolvedOldPath),
      isBinary: this.currentFile.isBinary,
      isGenerated: this.currentFile.isGenerated,
      isTooLarge: this.currentFile.isTooLarge,
      additions: finalHunks.reduce((sum, hunk) => sum + hunk.addCount, 0),
      deletions: finalHunks.reduce((sum, hunk) => sum + hunk.delCount, 0),
      hunks: finalHunks,
    };
    this.files.push(diffFile);
    this.options.onFile?.(diffFile);
    this.currentFile = null;
  }
}
