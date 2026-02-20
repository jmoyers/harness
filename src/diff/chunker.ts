import { computeDiffChunkId } from './hash.ts';
import type { ChunkPolicy, DiffChunk, DiffChunker, DiffHunk, NormalizedDiff } from './types.ts';

function normalizeChunkPolicy(policy: ChunkPolicy): ChunkPolicy {
  return {
    maxHunksPerChunk: Math.max(1, Math.floor(policy.maxHunksPerChunk)),
    maxLinesPerChunk: Math.max(1, Math.floor(policy.maxLinesPerChunk)),
    maxApproxTokensPerChunk: Math.max(1, Math.floor(policy.maxApproxTokensPerChunk)),
  };
}

function hunkApproxBytes(hunk: DiffHunk): number {
  let bytes = Buffer.byteLength(hunk.header);
  for (const line of hunk.lines) {
    bytes += Buffer.byteLength(line.text) + 1;
  }
  return bytes;
}

function approxTokensFromBytes(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / 4));
}

function policySignature(policy: ChunkPolicy): string {
  return `${policy.maxHunksPerChunk}:${policy.maxLinesPerChunk}:${policy.maxApproxTokensPerChunk}`;
}

function finalizeChunk(
  fileId: string,
  path: string,
  sequence: number,
  totalForFile: number,
  hunks: readonly DiffHunk[],
  policySig: string,
): DiffChunk {
  const hunkIds: string[] = [];
  for (const hunk of hunks) {
    hunkIds.push(hunk.hunkId);
  }
  let approxBytes = Buffer.byteLength(path);
  for (const hunk of hunks) {
    approxBytes += hunkApproxBytes(hunk);
  }
  return {
    chunkId: computeDiffChunkId(fileId, sequence, hunkIds, policySig),
    fileId,
    path,
    sequence,
    totalForFile,
    hunkIds,
    approxTokens: approxTokensFromBytes(approxBytes),
    approxBytes,
    payload: {
      fileHeader: path,
      hunks,
    },
  };
}

function chunkSingleFile(
  fileId: string,
  path: string,
  hunks: readonly DiffHunk[],
  policy: ChunkPolicy,
): readonly DiffChunk[] {
  const policySig = policySignature(policy);
  const chunksHunks: DiffHunk[][] = [];
  let current: DiffHunk[] = [];
  let currentLines = 0;
  let currentApproxTokens = 0;

  for (const hunk of hunks) {
    const hunkLines = hunk.lineCount;
    const hunkTokens = approxTokensFromBytes(hunkApproxBytes(hunk));
    const wouldExceed =
      current.length >= policy.maxHunksPerChunk ||
      currentLines + hunkLines > policy.maxLinesPerChunk ||
      currentApproxTokens + hunkTokens > policy.maxApproxTokensPerChunk;
    if (wouldExceed && current.length > 0) {
      chunksHunks.push(current);
      current = [];
      currentLines = 0;
      currentApproxTokens = 0;
    }
    current.push(hunk);
    currentLines += hunkLines;
    currentApproxTokens += hunkTokens;
    const mustFlush =
      current.length >= policy.maxHunksPerChunk ||
      currentLines >= policy.maxLinesPerChunk ||
      currentApproxTokens >= policy.maxApproxTokensPerChunk;
    if (mustFlush) {
      chunksHunks.push(current);
      current = [];
      currentLines = 0;
      currentApproxTokens = 0;
    }
  }
  if (current.length > 0) {
    chunksHunks.push(current);
  }

  const totalForFile = chunksHunks.length;
  const chunks: DiffChunk[] = [];
  for (let index = 0; index < chunksHunks.length; index += 1) {
    const hunkChunk = chunksHunks[index]!;
    chunks.push(finalizeChunk(fileId, path, index + 1, totalForFile, hunkChunk, policySig));
  }
  return chunks;
}

function chunkDiff(diff: NormalizedDiff, policy: ChunkPolicy): readonly DiffChunk[] {
  const normalizedPolicy = normalizeChunkPolicy(policy);
  const chunks: DiffChunk[] = [];
  for (const file of diff.files) {
    if (file.isBinary || file.hunks.length === 0) {
      continue;
    }
    const path = file.newPath ?? file.oldPath ?? file.fileId;
    chunks.push(...chunkSingleFile(file.fileId, path, file.hunks, normalizedPolicy));
  }
  return chunks;
}

async function* streamDiffChunks(
  diff: NormalizedDiff,
  policy: ChunkPolicy,
): AsyncIterable<DiffChunk> {
  const normalizedPolicy = normalizeChunkPolicy(policy);
  for (const file of diff.files) {
    if (file.isBinary || file.hunks.length === 0) {
      continue;
    }
    const path = file.newPath ?? file.oldPath ?? file.fileId;
    for (const chunk of chunkSingleFile(file.fileId, path, file.hunks, normalizedPolicy)) {
      yield chunk;
    }
  }
}

export function createDiffChunker(): DiffChunker {
  return {
    chunk: chunkDiff,
    streamChunks: streamDiffChunks,
  };
}
