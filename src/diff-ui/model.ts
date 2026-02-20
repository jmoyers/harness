import type { DiffFile, DiffHunk, DiffLine, NormalizedDiff } from '../diff/types.ts';
import type { DiffUiModel, DiffUiRowKind, DiffUiVirtualRow } from './types.ts';

function filePath(file: DiffFile): string {
  return file.newPath ?? file.oldPath ?? file.fileId;
}

function lineKindToRowKind(line: DiffLine): DiffUiRowKind {
  if (line.kind === 'add') {
    return 'code-add';
  }
  if (line.kind === 'del') {
    return 'code-del';
  }
  return 'code-context';
}

function unifiedPrefix(kind: DiffLine['kind']): string {
  if (kind === 'add') {
    return '+';
  }
  if (kind === 'del') {
    return '-';
  }
  return ' ';
}

function buildCodeRow(input: {
  readonly file: DiffFile;
  readonly fileIndex: number;
  readonly hunk: DiffHunk;
  readonly hunkIndex: number;
  readonly line: DiffLine;
}): DiffUiVirtualRow {
  const rowKind = lineKindToRowKind(input.line);
  const prefix = unifiedPrefix(input.line.kind);
  const unified = `${prefix} ${input.line.text}`;
  const left = input.line.kind === 'add' ? '' : input.line.text;
  const right = input.line.kind === 'del' ? '' : input.line.text;

  return {
    kind: rowKind,
    unified,
    left,
    right,
    fileId: input.file.fileId,
    hunkId: input.hunk.hunkId,
    fileIndex: input.fileIndex,
    hunkIndex: input.hunkIndex,
    language: input.file.language,
    oldLine: input.line.oldLine,
    newLine: input.line.newLine,
  };
}

export function buildDiffUiModel(diff: NormalizedDiff): DiffUiModel {
  const rows: DiffUiVirtualRow[] = [];
  const fileStartRows: number[] = [];
  const hunkStartRows: number[] = [];

  let globalHunkIndex = 0;

  for (let fileIndex = 0; fileIndex < diff.files.length; fileIndex += 1) {
    const file = diff.files[fileIndex]!;
    fileStartRows.push(rows.length);

    const path = filePath(file);
    rows.push({
      kind: 'file-header',
      unified: `File ${fileIndex + 1}/${diff.files.length}: ${path} (+${file.additions} -${file.deletions})`,
      left: path,
      right: `+${file.additions} -${file.deletions}`,
      fileId: file.fileId,
      hunkId: null,
      fileIndex,
      hunkIndex: null,
      language: file.language,
      oldLine: null,
      newLine: null,
    });

    for (const hunk of file.hunks) {
      hunkStartRows.push(rows.length);
      const hunkIndex = globalHunkIndex;
      globalHunkIndex += 1;
      rows.push({
        kind: 'hunk-header',
        unified: hunk.header,
        left: hunk.header,
        right: hunk.header,
        fileId: file.fileId,
        hunkId: hunk.hunkId,
        fileIndex,
        hunkIndex,
        language: file.language,
        oldLine: hunk.oldStart,
        newLine: hunk.newStart,
      });

      for (const line of hunk.lines) {
        rows.push(
          buildCodeRow({
            file,
            fileIndex,
            hunk,
            hunkIndex,
            line,
          }),
        );
      }
    }
  }

  if (diff.coverage.truncated) {
    rows.push({
      kind: 'notice',
      unified: `coverage truncated: reason=${diff.coverage.reason} skipped=${diff.coverage.skippedFiles} truncated=${diff.coverage.truncatedFiles}`,
      left: '',
      right: '',
      fileId: null,
      hunkId: null,
      fileIndex: null,
      hunkIndex: null,
      language: null,
      oldLine: null,
      newLine: null,
    });
  }

  return {
    diff,
    rows,
    fileStartRows,
    hunkStartRows,
  };
}

export function maxTopRowForModel(model: DiffUiModel, viewportHeight: number): number {
  const bodyRows = Math.max(1, viewportHeight - 2);
  return Math.max(0, model.rows.length - bodyRows);
}
