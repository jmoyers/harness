import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { NimPane } from '../src/ui/panes/nim.ts';

void test('nim pane renders shell rows with transcript and composer sections', () => {
  const pane = new NimPane();
  const result = pane.render({
    layout: {
      rightCols: 40,
      paneRows: 8,
    },
  });

  assert.equal(result.rows.length, 8);
  assert.equal(result.rows[0]?.includes('NIM'), true);
  assert.equal(result.rows[1]?.includes('Pinned agent pane'), true);
  assert.equal(result.rows[3]?.includes('transcript'), true);
  assert.equal(result.rows[6]?.includes('composer'), true);
  assert.equal(result.rows[7]?.trimStart().startsWith('nim> '), true);
});

void test('nim pane supports zero-row layouts', () => {
  const pane = new NimPane();
  const result = pane.render({
    layout: {
      rightCols: 20,
      paneRows: 0,
    },
  });

  assert.deepEqual(result.rows, []);
});
