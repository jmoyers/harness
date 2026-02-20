import { createHash } from 'node:crypto';
import type { DiffFile, DiffHunk, DiffMode } from './types.ts';

function hashStrings(prefix: string, parts: readonly string[]): string {
  const hash = createHash('sha256');
  hash.update(prefix);
  hash.update('\n');
  for (const part of parts) {
    hash.update(part);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function normalized(value: string | null): string {
  return value ?? '';
}

export function computeDiffFileId(
  changeType: string,
  oldPath: string | null,
  newPath: string | null,
): string {
  return hashStrings('diff-file', [changeType, normalized(oldPath), normalized(newPath)]);
}

export function computeDiffHunkId(
  fileId: string,
  header: string,
  serializedLines: readonly string[],
): string {
  return hashStrings('diff-hunk', [fileId, header, ...serializedLines]);
}

export function serializeHunkLinesForHash(lines: DiffHunk['lines']): readonly string[] {
  const serialized: string[] = [];
  for (const line of lines) {
    serialized.push(
      `${line.kind}:${String(line.oldLine ?? '')}:${String(line.newLine ?? '')}:${line.text}`,
    );
  }
  return serialized;
}

export function computeDiffId(
  mode: DiffMode,
  baseRef: string | null,
  headRef: string | null,
  files: readonly DiffFile[],
): string {
  const parts: string[] = [mode, normalized(baseRef), normalized(headRef)];
  for (const file of files) {
    parts.push(
      `${file.fileId}:${file.changeType}:${normalized(file.oldPath)}:${normalized(file.newPath)}`,
    );
    for (const hunk of file.hunks) {
      parts.push(hunk.hunkId);
    }
  }
  return hashStrings('diff', parts);
}

export function computeDiffChunkId(
  fileId: string,
  sequence: number,
  hunkIds: readonly string[],
  policySignature: string,
): string {
  return hashStrings('diff-chunk', [fileId, String(sequence), policySignature, ...hunkIds]);
}
