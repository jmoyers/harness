import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { buildDiffUiModel, maxTopRowForModel } from '../src/diff-ui/model.ts';
import { createSampleDiff } from './support/diff-ui-fixture.ts';

void test('buildDiffUiModel creates headers code rows and row indexes', () => {
  const model = buildDiffUiModel(createSampleDiff());

  assert.equal(model.fileStartRows.length, 2);
  assert.equal(model.fileStartRows[0], 0);
  assert.equal(model.hunkStartRows.length, 2);

  const fileHeader = model.rows[0]!;
  assert.equal(fileHeader.kind, 'file-header');
  assert.equal(fileHeader.fileId, 'file-a');
  assert.equal(fileHeader.fileIndex, 0);

  const hunkHeader = model.rows[1]!;
  assert.equal(hunkHeader.kind, 'hunk-header');
  assert.equal(hunkHeader.hunkId, 'hunk-a');

  const codeRows = model.rows.filter(
    (row) => row.kind === 'code-add' || row.kind === 'code-del' || row.kind === 'code-context',
  );
  assert.equal(codeRows.length >= 4, true);
  assert.equal(
    codeRows.some((row) => row.left.length === 0),
    true,
  );
  assert.equal(
    codeRows.some((row) => row.right.length === 0),
    true,
  );
});

void test('buildDiffUiModel appends coverage notice when truncated', () => {
  const model = buildDiffUiModel(createSampleDiff({ truncated: true }));
  assert.equal(model.rows.at(-1)?.kind, 'notice');
  assert.equal(model.rows.at(-1)?.unified.includes('coverage truncated'), true);
});

void test('maxTopRowForModel clamps by viewport body height', () => {
  const model = buildDiffUiModel(createSampleDiff());
  const highViewport = maxTopRowForModel(model, 1000);
  assert.equal(highViewport, 0);

  const lowViewport = maxTopRowForModel(model, 3);
  assert.equal(lowViewport >= 1, true);
});
