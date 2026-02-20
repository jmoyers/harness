import type { DiffUiFinderResult, DiffUiModel } from './types.ts';

function filePathFromModel(model: DiffUiModel, fileIndex: number): string {
  const file = model.diff.files[fileIndex]!;
  return file.newPath ?? file.oldPath ?? file.fileId;
}

export function scoreFinderPath(query: string, path: string): number {
  const trimmedQuery = query.trim().toLowerCase();
  if (trimmedQuery.length === 0) {
    return 0;
  }

  const candidate = path.toLowerCase();
  let queryIndex = 0;
  let score = 0;
  let streak = 0;
  let firstMatchIndex = -1;

  for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex += 1) {
    if (queryIndex >= trimmedQuery.length) {
      break;
    }

    const current = candidate[candidateIndex]!;
    if (current !== trimmedQuery[queryIndex]) {
      streak = 0;
      continue;
    }

    if (firstMatchIndex < 0) {
      firstMatchIndex = candidateIndex;
    }
    streak += 1;
    score += 10 + streak * 4;

    const prev = candidateIndex > 0 ? candidate[candidateIndex - 1] : '/';
    if (prev === '/' || prev === '-' || prev === '_' || prev === '.') {
      score += 6;
    }

    queryIndex += 1;
  }

  if (queryIndex !== trimmedQuery.length) {
    return Number.NEGATIVE_INFINITY;
  }

  if (firstMatchIndex === 0) {
    score += 12;
  } else if (firstMatchIndex > 0) {
    score += Math.max(0, 8 - firstMatchIndex);
  }

  score -= Math.floor(candidate.length / 8);
  return score;
}

export function buildFinderResults(
  model: DiffUiModel,
  query: string,
  maxResults = 200,
): readonly DiffUiFinderResult[] {
  const trimmedQuery = query.trim();
  const results: DiffUiFinderResult[] = [];

  for (let fileIndex = 0; fileIndex < model.diff.files.length; fileIndex += 1) {
    const file = model.diff.files[fileIndex]!;
    const path = filePathFromModel(model, fileIndex);
    const score = trimmedQuery.length === 0 ? 0 : scoreFinderPath(trimmedQuery, path);
    if (score === Number.NEGATIVE_INFINITY) {
      continue;
    }
    results.push({
      fileIndex,
      fileId: file.fileId,
      path,
      score,
    });
  }

  results.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    const pathCompare = left.path.localeCompare(right.path);
    if (pathCompare !== 0) {
      return pathCompare;
    }
    return left.fileIndex - right.fileIndex;
  });

  return results.slice(0, Math.max(1, Math.floor(maxResults)));
}
