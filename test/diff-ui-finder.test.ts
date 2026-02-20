import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { buildDiffUiModel } from '../src/diff-ui/model.ts';
import { buildFinderResults, scoreFinderPath } from '../src/diff-ui/finder.ts';
import { createSampleDiff } from './support/diff-ui-fixture.ts';

void test('scoreFinderPath ranks matches and rejects missing query paths', () => {
  const goodScore = scoreFinderPath('srca', 'src/a.ts');
  const betterScore = scoreFinderPath('read', 'README.md');
  const missingScore = scoreFinderPath('zzz', 'README.md');
  const emptyScore = scoreFinderPath('   ', 'README.md');
  const laterMatchScore = scoreFinderPath('md', 'README.md');

  assert.equal(goodScore > 0, true);
  assert.equal(betterScore > 0, true);
  assert.equal(missingScore, Number.NEGATIVE_INFINITY);
  assert.equal(emptyScore, 0);
  assert.equal(laterMatchScore > 0, true);
});

void test('buildFinderResults returns sorted candidate list and honors maxResults', () => {
  const model = buildDiffUiModel(createSampleDiff());

  const all = buildFinderResults(model, '');
  assert.equal(all.length, 2);

  const filtered = buildFinderResults(model, 'read', 1);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.path, 'README.md');

  const none = buildFinderResults(model, 'definitely-no-match');
  assert.equal(none.length, 0);

  const clamped = buildFinderResults(model, '', 0);
  assert.equal(clamped.length, 1);
});

void test('buildFinderResults tie-breaks by path then file index', () => {
  const diff = createSampleDiff();
  const duplicated = {
    ...diff,
    files: [
      ...diff.files,
      {
        ...diff.files[0]!,
        fileId: 'file-c',
        oldPath: null,
        newPath: 'src/a.ts',
        hunks: [],
      },
    ],
    totals: {
      ...diff.totals,
      filesChanged: 3,
    },
  };
  const model = buildDiffUiModel(duplicated);
  const results = buildFinderResults(model, 'src');

  assert.equal(results.length >= 2, true);
  const firstPath = results[0]?.path ?? '';
  const secondPath = results[1]?.path ?? '';
  assert.equal(firstPath.localeCompare(secondPath) <= 0, true);
});

void test('buildFinderResults sorts higher scores first before path tie-breaks', () => {
  const model = buildDiffUiModel(createSampleDiff());
  const results = buildFinderResults(model, 'a');

  assert.equal(results.length >= 2, true);
  assert.equal((results[0]?.score ?? Number.NEGATIVE_INFINITY) >= (results[1]?.score ?? 0), true);
});
