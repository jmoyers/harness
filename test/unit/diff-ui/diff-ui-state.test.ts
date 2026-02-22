import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { buildDiffUiModel } from '../../../src/diff-ui/model.ts';
import {
  createInitialDiffUiState,
  reduceDiffUiState,
  resolveEffectiveViewMode,
} from '../../../src/diff-ui/state.ts';
import { createSampleDiff } from '../../support/diff-ui-fixture.ts';

void test('resolveEffectiveViewMode handles explicit and auto modes', () => {
  assert.equal(resolveEffectiveViewMode('split', 80), 'split');
  assert.equal(resolveEffectiveViewMode('unified', 200), 'unified');
  assert.equal(resolveEffectiveViewMode('auto', 130), 'split');
  assert.equal(resolveEffectiveViewMode('auto', 119), 'unified');
});

void test('state reducer scroll and navigation paths are clamped and deterministic', () => {
  const model = buildDiffUiModel(createSampleDiff());
  let state = createInitialDiffUiState(model, 'auto', 120);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'nav.scroll', delta: 3 },
    viewportWidth: 120,
    viewportHeight: 8,
  });
  assert.equal(state.topRow, 2);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'nav.page', delta: 10, pageSize: 5 },
    viewportWidth: 120,
    viewportHeight: 8,
  });
  assert.equal(state.topRow >= 0, true);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'nav.gotoFile', fileIndex: 1 },
    viewportWidth: 120,
    viewportHeight: 8,
  });
  assert.equal(state.activeFileIndex, 1);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'nav.gotoHunk', hunkIndex: 0 },
    viewportWidth: 120,
    viewportHeight: 8,
  });
  assert.equal(state.activeHunkIndex, 0);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'view.setMode', mode: 'unified' },
    viewportWidth: 120,
    viewportHeight: 8,
  });
  assert.equal(state.effectiveViewMode, 'unified');

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'viewport.changed', width: 50 },
    viewportWidth: 120,
    viewportHeight: 8,
  });
  assert.equal(state.effectiveViewMode, 'unified');

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'search.set', query: 'const' },
    viewportWidth: 120,
    viewportHeight: 8,
  });
  assert.equal(state.searchQuery, 'const');
});

void test('state reducer finder lifecycle can focus files via query and accept', () => {
  const model = buildDiffUiModel(createSampleDiff());
  let state = createInitialDiffUiState(model, 'auto', 120);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'finder.open' },
    viewportWidth: 120,
    viewportHeight: 8,
  });
  assert.equal(state.finderOpen, true);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'finder.query', query: 'read' },
    viewportWidth: 120,
    viewportHeight: 8,
  });
  assert.equal(state.finderResults.length, 1);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'finder.move', delta: 1 },
    viewportWidth: 120,
    viewportHeight: 8,
  });
  assert.equal(state.finderSelectedIndex, 0);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'finder.accept' },
    viewportWidth: 120,
    viewportHeight: 8,
  });
  assert.equal(state.finderOpen, false);
  assert.equal(state.activeFileIndex, 1);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'finder.close' },
    viewportWidth: 120,
    viewportHeight: 8,
  });
  assert.equal(state.finderOpen, false);
});

void test('state reducer handles empty model edge cases', () => {
  const emptyDiff = {
    ...createSampleDiff(),
    files: [],
    totals: {
      ...createSampleDiff().totals,
      filesChanged: 0,
      hunks: 0,
      lines: 0,
    },
  };
  const model = buildDiffUiModel(emptyDiff);
  let state = createInitialDiffUiState(model, 'auto', 20);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'nav.scroll', delta: -100 },
    viewportWidth: 20,
    viewportHeight: 8,
  });
  assert.equal(state.topRow, 0);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'nav.gotoFile', fileIndex: 10 },
    viewportWidth: 20,
    viewportHeight: 8,
  });
  assert.equal(state.activeFileIndex, 0);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'nav.gotoHunk', hunkIndex: 10 },
    viewportWidth: 20,
    viewportHeight: 8,
  });
  assert.equal(state.activeHunkIndex, 0);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'finder.accept' },
    viewportWidth: 20,
    viewportHeight: 8,
  });
  assert.equal(state.finderOpen, false);

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'search.set', query: 'noop' },
    viewportWidth: 20,
    viewportHeight: 8,
  });
  assert.equal(state.searchQuery, 'noop');

  state = reduceDiffUiState({
    model,
    state,
    action: { type: 'unknown.action' } as unknown as Parameters<
      typeof reduceDiffUiState
    >[0]['action'],
    viewportWidth: 20,
    viewportHeight: 8,
  });
  assert.equal(state.topRow, 0);
});
