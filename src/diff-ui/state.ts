import { buildFinderResults } from './finder.ts';
import { maxTopRowForModel } from './model.ts';
import type { DiffUiModel, DiffUiState, DiffUiStateAction, DiffUiViewMode } from './types.ts';

const AUTO_SPLIT_MIN_WIDTH = 120;

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function clampIndex(value: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return clamp(value, 0, length - 1);
}

function firstHunkIndexForFile(model: DiffUiModel, fileIndex: number): number {
  const row = model.rows.find(
    (candidate) => candidate.kind === 'hunk-header' && candidate.fileIndex === fileIndex,
  );
  return row?.hunkIndex ?? 0;
}

function resolveTopForFile(model: DiffUiModel, fileIndex: number): number {
  if (model.fileStartRows.length === 0) {
    return 0;
  }
  return model.fileStartRows[clampIndex(fileIndex, model.fileStartRows.length)] ?? 0;
}

function resolveTopForHunk(model: DiffUiModel, hunkIndex: number): number {
  if (model.hunkStartRows.length === 0) {
    return 0;
  }
  return model.hunkStartRows[clampIndex(hunkIndex, model.hunkStartRows.length)] ?? 0;
}

export function resolveEffectiveViewMode(
  viewMode: DiffUiViewMode,
  viewportWidth: number,
): 'split' | 'unified' {
  if (viewMode === 'split') {
    return 'split';
  }
  if (viewMode === 'unified') {
    return 'unified';
  }
  return viewportWidth >= AUTO_SPLIT_MIN_WIDTH ? 'split' : 'unified';
}

export function createInitialDiffUiState(
  model: DiffUiModel,
  viewMode: DiffUiViewMode,
  viewportWidth: number,
): DiffUiState {
  return {
    viewMode,
    effectiveViewMode: resolveEffectiveViewMode(viewMode, viewportWidth),
    topRow: 0,
    activeFileIndex: model.diff.files.length === 0 ? 0 : 0,
    activeHunkIndex: model.hunkStartRows.length === 0 ? 0 : 0,
    finderOpen: false,
    finderQuery: '',
    finderSelectedIndex: 0,
    finderResults: buildFinderResults(model, ''),
    searchQuery: '',
  };
}

function withClampedTop(
  state: DiffUiState,
  model: DiffUiModel,
  viewportHeight: number,
): DiffUiState {
  const maxTop = maxTopRowForModel(model, viewportHeight);
  return {
    ...state,
    topRow: clamp(state.topRow, 0, maxTop),
  };
}

export function reduceDiffUiState(input: {
  readonly model: DiffUiModel;
  readonly state: DiffUiState;
  readonly action: DiffUiStateAction;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}): DiffUiState {
  const { model, action, viewportHeight, viewportWidth } = input;
  let next: DiffUiState = input.state;

  if (action.type === 'viewport.changed') {
    next = {
      ...next,
      effectiveViewMode: resolveEffectiveViewMode(next.viewMode, action.width),
    };
    return withClampedTop(next, model, viewportHeight);
  }

  if (action.type === 'view.setMode') {
    next = {
      ...next,
      viewMode: action.mode,
      effectiveViewMode: resolveEffectiveViewMode(action.mode, viewportWidth),
    };
    return withClampedTop(next, model, viewportHeight);
  }

  if (action.type === 'nav.scroll') {
    next = {
      ...next,
      topRow: next.topRow + action.delta,
    };
    return withClampedTop(next, model, viewportHeight);
  }

  if (action.type === 'nav.page') {
    next = {
      ...next,
      topRow: next.topRow + action.delta * Math.max(1, action.pageSize),
    };
    return withClampedTop(next, model, viewportHeight);
  }

  if (action.type === 'nav.gotoFile') {
    const fileIndex = clampIndex(action.fileIndex, model.diff.files.length);
    next = {
      ...next,
      activeFileIndex: fileIndex,
      activeHunkIndex: firstHunkIndexForFile(model, fileIndex),
      topRow: resolveTopForFile(model, fileIndex),
      finderOpen: false,
    };
    return withClampedTop(next, model, viewportHeight);
  }

  if (action.type === 'nav.gotoHunk') {
    const hunkIndex = clampIndex(action.hunkIndex, model.hunkStartRows.length);
    const hunkRow = model.rows.find(
      (row) => row.kind === 'hunk-header' && row.hunkIndex === hunkIndex,
    );
    next = {
      ...next,
      activeHunkIndex: hunkIndex,
      activeFileIndex: hunkRow?.fileIndex ?? next.activeFileIndex,
      topRow: resolveTopForHunk(model, hunkIndex),
      finderOpen: false,
    };
    return withClampedTop(next, model, viewportHeight);
  }

  if (action.type === 'finder.open') {
    next = {
      ...next,
      finderOpen: true,
      finderResults: buildFinderResults(model, next.finderQuery),
      finderSelectedIndex: 0,
    };
    return withClampedTop(next, model, viewportHeight);
  }

  if (action.type === 'finder.close') {
    next = {
      ...next,
      finderOpen: false,
    };
    return withClampedTop(next, model, viewportHeight);
  }

  if (action.type === 'finder.query') {
    const results = buildFinderResults(model, action.query);
    next = {
      ...next,
      finderOpen: true,
      finderQuery: action.query,
      finderResults: results,
      finderSelectedIndex: 0,
    };
    return withClampedTop(next, model, viewportHeight);
  }

  if (action.type === 'finder.move') {
    const selected = clampIndex(next.finderSelectedIndex + action.delta, next.finderResults.length);
    next = {
      ...next,
      finderSelectedIndex: selected,
    };
    return withClampedTop(next, model, viewportHeight);
  }

  if (action.type === 'finder.accept') {
    if (next.finderResults.length === 0) {
      return withClampedTop(next, model, viewportHeight);
    }
    const selection =
      next.finderResults[clampIndex(next.finderSelectedIndex, next.finderResults.length)] ??
      next.finderResults[0]!;
    next = {
      ...next,
      activeFileIndex: selection.fileIndex,
      activeHunkIndex: firstHunkIndexForFile(model, selection.fileIndex),
      topRow: resolveTopForFile(model, selection.fileIndex),
      finderOpen: false,
    };
    return withClampedTop(next, model, viewportHeight);
  }

  if (action.type === 'search.set') {
    next = {
      ...next,
      searchQuery: action.query,
    };
    return withClampedTop(next, model, viewportHeight);
  }

  return withClampedTop(next, model, viewportHeight);
}
