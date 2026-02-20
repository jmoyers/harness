import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { parseDiffUiArgs } from '../src/diff-ui/args.ts';
import { buildFinderResults } from '../src/diff-ui/finder.ts';
import { buildDiffUiModel } from '../src/diff-ui/model.ts';
import { DEFAULT_DIFF_UI_THEME, renderDiffUiViewport } from '../src/diff-ui/render.ts';
import { runDiffUiCli } from '../src/diff-ui/runtime.ts';
import { diffUiUsage } from '../src/diff-ui/index.ts';
import { createSampleDiff } from './support/diff-ui-fixture.ts';

void test('diff-ui public api exports are reachable', async () => {
  const parsed = parseDiffUiArgs([], {
    cwd: '/repo',
    env: {},
    isStdoutTty: false,
  });
  assert.equal(parsed.mode, 'unstaged');
  assert.equal(diffUiUsage().includes('usage: harness diff'), true);

  const model = buildDiffUiModel(createSampleDiff());
  const finder = buildFinderResults(model, 'src');
  assert.equal(finder.length >= 1, true);

  const rendered = renderDiffUiViewport({
    model,
    state: {
      viewMode: 'auto',
      effectiveViewMode: 'unified',
      topRow: 0,
      activeFileIndex: 0,
      activeHunkIndex: 0,
      finderOpen: false,
      finderQuery: '',
      finderSelectedIndex: 0,
      finderResults: finder,
      searchQuery: '',
    },
    width: 80,
    height: 8,
    viewMode: 'auto',
    syntaxMode: 'off',
    wordDiffMode: 'off',
    color: false,
    theme: DEFAULT_DIFF_UI_THEME,
  });
  assert.equal(rendered.lines.length, 8);

  const result = await runDiffUiCli({
    argv: ['--json-events'],
    cwd: '/repo',
    env: {},
    createBuilder: () => ({
      build: async () => ({
        diff: createSampleDiff(),
        diagnostics: {
          elapsedMs: 1,
          peakBufferBytes: 1,
          parseWarnings: [],
        },
      }),
      stream: async function* () {
        // no-op
      },
    }),
    isStdoutTty: false,
    writeStdout: () => {},
    writeStderr: () => {},
  });
  assert.equal(result.exitCode, 0);
});

void test('diff-ui types module is runtime importable for coverage parity', async () => {
  const moduleValue = await import('../src/diff-ui/types.ts');
  assert.equal(typeof moduleValue, 'object');
});
