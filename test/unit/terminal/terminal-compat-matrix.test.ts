import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  TERMINAL_COMPAT_CHECKPOINT_DATE,
  TERMINAL_COMPAT_LEVELS,
  TERMINAL_COMPAT_MATRIX,
  type TerminalCompatEntryStatus,
  type TerminalCompatEntry,
  type TerminalCompatLevel,
  type TerminalCompatLevelId,
  type TerminalCompatLevelStatus,
  type TerminalCompatPriority,
} from '../../../src/terminal/compat-matrix.ts';

void test('terminal compatibility checklist remains structurally valid', () => {
  const statusType: TerminalCompatLevelStatus = 'complete';
  const entryStatusType: TerminalCompatEntryStatus = 'implemented';
  const priorityType: TerminalCompatPriority = 'p0-codex-vim';
  const levelIdType: TerminalCompatLevelId = 'l0-grammar-core';
  assert.equal(statusType, 'complete');
  assert.equal(entryStatusType, 'implemented');
  assert.equal(priorityType, 'p0-codex-vim');
  assert.equal(levelIdType, 'l0-grammar-core');

  const levels: readonly TerminalCompatLevel[] = TERMINAL_COMPAT_LEVELS;
  const entries: readonly TerminalCompatEntry[] = TERMINAL_COMPAT_MATRIX;
  assert.equal(levels.length > 0, true);
  assert.equal(entries.length > 0, true);

  assert.match(TERMINAL_COMPAT_CHECKPOINT_DATE, /^\d{4}-\d{2}-\d{2}$/u);

  const levelIds = new Set<string>();
  for (const level of TERMINAL_COMPAT_LEVELS) {
    assert.equal(levelIds.has(level.id), false);
    levelIds.add(level.id);
    assert.notEqual(level.title.trim().length, 0);
    assert.notEqual(level.gate.trim().length, 0);
  }

  const entryIds = new Set<string>();
  for (const entry of TERMINAL_COMPAT_MATRIX) {
    assert.equal(entryIds.has(entry.id), false);
    entryIds.add(entry.id);
    assert.equal(levelIds.has(entry.levelId), true);

    if (entry.status === 'implemented') {
      assert.equal(entry.ownerTests.length > 0, true);
    }

    for (const ownerTest of entry.ownerTests) {
      assert.equal(ownerTest.startsWith('test/'), true);
      assert.equal(ownerTest.endsWith('.test.ts'), true);
    }
  }
});

void test('terminal compatibility matrix summary is explicit and stable', () => {
  const counts = {
    implemented: 0,
    passthrough: 0,
    unsupported: 0,
  } as const satisfies Record<(typeof TERMINAL_COMPAT_MATRIX)[number]['status'], number>;

  const mutableCounts: Record<(typeof TERMINAL_COMPAT_MATRIX)[number]['status'], number> = {
    implemented: counts.implemented,
    passthrough: counts.passthrough,
    unsupported: counts.unsupported,
  };

  for (const entry of TERMINAL_COMPAT_MATRIX) {
    mutableCounts[entry.status] += 1;
  }

  assert.deepEqual(mutableCounts, {
    implemented: 17,
    passthrough: 2,
    unsupported: 6,
  });

  const levelCounts = new Map<string, number>();
  for (const entry of TERMINAL_COMPAT_MATRIX) {
    const current = levelCounts.get(entry.levelId) ?? 0;
    levelCounts.set(entry.levelId, current + 1);
  }
  assert.deepEqual(
    [...levelCounts.entries()],
    [
      ['l0-grammar-core', 4],
      ['l1-screen-state', 4],
      ['l2-dec-modes', 5],
      ['l3-query-reply', 4],
      ['l4-unicode-fidelity', 2],
      ['l5-external-diff', 2],
      ['l6-modern-extensions', 4],
    ],
  );

  const blockingP0 = TERMINAL_COMPAT_MATRIX.filter(
    (entry) => entry.priority === 'p0-codex-vim' && entry.status !== 'implemented',
  ).map((entry) => entry.id);
  assert.deepEqual(blockingP0, ['differential-terminal-checkpoints']);
});

void test('terminal compatibility matrix locks key feature states', () => {
  const byId = new Map(TERMINAL_COMPAT_MATRIX.map((entry) => [entry.id, entry]));

  assert.equal(byId.get('dec-alt-screen-save-restore')?.status, 'implemented');
  assert.equal(byId.get('dec-mouse-focus-tracking')?.status, 'implemented');
  assert.equal(byId.get('csi-device-status-replies')?.status, 'implemented');
  assert.equal(byId.get('modifyotherkeys-negotiation')?.status, 'implemented');
  assert.equal(byId.get('differential-terminal-checkpoints')?.status, 'unsupported');
  assert.equal(byId.get('osc-title-cwd-hyperlink')?.status, 'unsupported');
  assert.equal(byId.get('keyboard-encoding-ingress')?.status, 'implemented');
});
