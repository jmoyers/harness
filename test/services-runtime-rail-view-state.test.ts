import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeRailViewState } from '../src/services/runtime-rail-view-state.ts';

void test('runtime rail view state tracks latest rows', () => {
  const state = new RuntimeRailViewState<readonly string[]>([]);
  assert.deepEqual(state.readLatestRows(), []);

  const rows = ['row-a', 'row-b'] as const;
  state.setLatestRows(rows);

  assert.deepEqual(state.readLatestRows(), rows);
});
