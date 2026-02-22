import assert from 'node:assert/strict';
import test from 'node:test';
import {
  leftColsFromPaneWidthPercent,
  normalizePaneWidthPercent,
  paneWidthPercentFromLayout,
} from '../../../../src/mux/live-mux/layout.ts';

void test('normalizePaneWidthPercent clamps to supported range and defaults NaN', () => {
  assert.equal(normalizePaneWidthPercent(Number.NaN), 30);
  assert.equal(normalizePaneWidthPercent(0), 1);
  assert.equal(normalizePaneWidthPercent(100), 99);
  assert.equal(normalizePaneWidthPercent(42.5), 42.5);
});

void test('leftColsFromPaneWidthPercent computes bounded left pane width', () => {
  assert.equal(leftColsFromPaneWidthPercent(120, 30), 36);
  assert.equal(leftColsFromPaneWidthPercent(3, 99), 1);
  assert.equal(leftColsFromPaneWidthPercent(200, 1), 2);
});

void test('paneWidthPercentFromLayout rounds and normalizes computed percent', () => {
  assert.equal(paneWidthPercentFromLayout({ cols: 121, leftCols: 36 }), 30);
  assert.equal(paneWidthPercentFromLayout({ cols: 2, leftCols: 2 }), 99);
});
