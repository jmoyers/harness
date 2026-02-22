import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { buildDiffUiModel } from '../../../src/diff-ui/model.ts';
import { renderDiffUiViewport, resolveDiffUiTheme } from '../../../src/diff-ui/render.ts';
import { createInitialDiffUiState, reduceDiffUiState } from '../../../src/diff-ui/state.ts';
import { createSampleDiff } from '../../support/diff-ui-fixture.ts';

void test('resolveDiffUiTheme supports default and plain themes', () => {
  const defaultTheme = resolveDiffUiTheme(null);
  assert.equal(defaultTheme.headerAnsi.length > 0, true);

  const plainTheme = resolveDiffUiTheme('plain');
  assert.equal(plainTheme.headerAnsi.length, 0);

  assert.throws(() => resolveDiffUiTheme('unknown-theme'), /unknown theme/u);
});

void test('renderDiffUiViewport renders unified and split layouts', () => {
  const model = buildDiffUiModel(createSampleDiff());
  const state = createInitialDiffUiState(model, 'auto', 160);

  const split = renderDiffUiViewport({
    model,
    state,
    width: 160,
    height: 12,
    viewMode: 'auto',
    syntaxMode: 'on',
    wordDiffMode: 'on',
    color: false,
    theme: resolveDiffUiTheme('default'),
  });
  assert.equal(split.lines.length, 12);
  assert.equal(split.lines[0]?.includes('view=split'), true);

  const unifiedState = {
    ...state,
    effectiveViewMode: 'unified' as const,
  };
  const unified = renderDiffUiViewport({
    model,
    state: unifiedState,
    width: 90,
    height: 10,
    viewMode: 'unified',
    syntaxMode: 'off',
    wordDiffMode: 'off',
    color: false,
    theme: resolveDiffUiTheme('default'),
  });
  assert.equal(unified.lines.length, 10);
  assert.equal(unified.lines[0]?.includes('view=unified'), true);
});

void test('renderDiffUiViewport overlays finder rows and color mode adds ansi', () => {
  const model = buildDiffUiModel(createSampleDiff());
  let state = createInitialDiffUiState(model, 'auto', 120);
  state = reduceDiffUiState({
    model,
    state,
    action: {
      type: 'finder.query',
      query: 'src',
    },
    viewportWidth: 120,
    viewportHeight: 10,
  });

  const colored = renderDiffUiViewport({
    model,
    state,
    width: 120,
    height: 10,
    viewMode: 'auto',
    syntaxMode: 'on',
    wordDiffMode: 'on',
    color: true,
    theme: resolveDiffUiTheme('default'),
  });

  assert.equal(
    colored.lines.some((line) => line.includes('find: src')),
    true,
  );
  assert.equal(
    colored.lines.some((line) => line.includes('\u001b[')),
    true,
  );
});

void test('renderDiffUiViewport covers syntax and word-diff mode toggles', () => {
  const diff = createSampleDiff();
  const firstFile = diff.files[0]!;
  const firstHunk = firstFile.hunks[0]!;
  const patched = {
    ...diff,
    files: [
      {
        ...firstFile,
        hunks: [
          {
            ...firstHunk,
            lines: firstHunk.lines.map((line, index) =>
              index === 0
                ? {
                    ...line,
                    text: 'const\tvalue = 1',
                  }
                : line,
            ),
          },
        ],
      },
      ...diff.files.slice(1),
    ],
  };
  const model = buildDiffUiModel(patched);
  const state = createInitialDiffUiState(model, 'auto', 120);

  const syntaxAutoWordAuto = renderDiffUiViewport({
    model,
    state,
    width: 120,
    height: 10,
    viewMode: 'auto',
    syntaxMode: 'auto',
    wordDiffMode: 'auto',
    color: true,
    theme: resolveDiffUiTheme('default'),
  });
  assert.equal(
    syntaxAutoWordAuto.lines.some((line) => line.includes('\u001b[')),
    true,
  );

  const syntaxOffWordOff = renderDiffUiViewport({
    model,
    state,
    width: 120,
    height: 10,
    viewMode: 'auto',
    syntaxMode: 'off',
    wordDiffMode: 'off',
    color: true,
    theme: resolveDiffUiTheme('default'),
  });
  const syntaxOffWordOn = renderDiffUiViewport({
    model,
    state,
    width: 120,
    height: 10,
    viewMode: 'auto',
    syntaxMode: 'off',
    wordDiffMode: 'on',
    color: true,
    theme: resolveDiffUiTheme('default'),
  });
  assert.equal(syntaxOffWordOff.lines.length, 10);
  assert.notEqual(syntaxOffWordOff.lines.join('\n'), syntaxOffWordOn.lines.join('\n'));
});

void test('renderDiffUiViewport styles notice rows when coverage is truncated', () => {
  const diff = createSampleDiff();
  const truncated = {
    ...diff,
    coverage: {
      ...diff.coverage,
      truncated: true,
      reason: 'max-lines' as const,
      skippedFiles: 2,
      truncatedFiles: 1,
    },
  };
  const model = buildDiffUiModel(truncated);
  const state = createInitialDiffUiState(model, 'unified', 100);

  const rendered = renderDiffUiViewport({
    model,
    state,
    width: 100,
    height: 12,
    viewMode: 'unified',
    syntaxMode: 'off',
    wordDiffMode: 'off',
    color: true,
    theme: resolveDiffUiTheme('default'),
  });

  assert.equal(
    rendered.lines.some((line) => line.includes('coverage truncated: reason=max-lines')),
    true,
  );
  assert.equal(
    rendered.lines.some((line) => line.includes('\u001b[')),
    true,
  );
});
