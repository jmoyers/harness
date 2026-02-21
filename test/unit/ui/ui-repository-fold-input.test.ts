import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  reduceRepositoryFoldChordInput,
  repositoryTreeArrowAction,
} from '../../../src/mux/live-mux/repository-folding.ts';
import { RepositoryFoldInput } from '../../../packages/harness-ui/src/interaction/repository-fold-input.ts';
import type { LeftNavSelection } from '../../../packages/harness-ui/src/interaction/left-nav-input.ts';

interface Harness {
  readonly router: RepositoryFoldInput;
  readonly calls: string[];
  readonly getDirtyCount: () => number;
  readonly setLeftNavSelection: (selection: LeftNavSelection) => void;
  readonly setPrefixAtMs: (value: number | null) => void;
  readonly getPrefixAtMs: () => number | null;
  readonly setNowMs: (value: number) => void;
}

function createHarness(): Harness {
  let leftNavSelection: LeftNavSelection = {
    kind: 'repository',
    repositoryId: 'repo-a',
  };
  let prefixAtMs: number | null = null;
  let nowMs = 1000;
  let dirtyCount = 0;
  const calls: string[] = [];
  const router = new RepositoryFoldInput(
    {
      leftNavSelection: () => leftNavSelection,
      repositoryToggleChordPrefixAtMs: () => prefixAtMs,
      setRepositoryToggleChordPrefixAtMs: (value) => {
        prefixAtMs = value;
      },
      conversations: () =>
        new Map([
          ['session-a', { directoryId: 'dir-a' }],
          ['session-b', { directoryId: null }],
        ]),
      repositoryGroupIdForDirectory: (directoryId) => `repo:${directoryId}`,
      nowMs: () => nowMs,
    },
    {
      collapseRepositoryGroup: (repositoryGroupId) => {
        calls.push(`collapse:${repositoryGroupId}`);
      },
      expandRepositoryGroup: (repositoryGroupId) => {
        calls.push(`expand:${repositoryGroupId}`);
      },
      collapseAllRepositoryGroups: () => {
        calls.push('collapse-all');
      },
      expandAllRepositoryGroups: () => {
        calls.push('expand-all');
      },
      selectLeftNavRepository: (repositoryGroupId) => {
        calls.push(`select:${repositoryGroupId}`);
      },
      markDirty: () => {
        dirtyCount += 1;
      },
    },
    {
      chordTimeoutMs: 1250,
      collapseAllChordPrefix: Buffer.from([0x0b]),
    },
    {
      reduceRepositoryFoldChordInput,
      repositoryTreeArrowAction,
    },
  );
  return {
    router,
    calls,
    getDirtyCount: () => dirtyCount,
    setLeftNavSelection: (selection) => {
      leftNavSelection = selection;
    },
    setPrefixAtMs: (value) => {
      prefixAtMs = value;
    },
    getPrefixAtMs: () => prefixAtMs,
    setNowMs: (value) => {
      nowMs = value;
    },
  };
}

void test('repository fold input handles tree expand/collapse and selection mapping', () => {
  const harness = createHarness();

  const expandHandled = harness.router.handleRepositoryTreeArrow(Buffer.from('\u001b[C', 'utf8'));
  assert.equal(expandHandled, true);
  assert.deepEqual(harness.calls, ['expand:repo-a', 'select:repo-a']);
  assert.equal(harness.getDirtyCount(), 1);

  harness.calls.length = 0;
  const collapseHandled = harness.router.handleRepositoryTreeArrow(Buffer.from('\u001b[D', 'utf8'));
  assert.equal(collapseHandled, true);
  assert.deepEqual(harness.calls, ['collapse:repo-a', 'select:repo-a']);
  assert.equal(harness.getDirtyCount(), 2);

  harness.calls.length = 0;
  harness.setLeftNavSelection({
    kind: 'project',
    directoryId: 'dir-a',
  });
  const projectExpandHandled = harness.router.handleRepositoryTreeArrow(
    Buffer.from('\u001b[C', 'utf8'),
  );
  assert.equal(projectExpandHandled, true);
  assert.deepEqual(harness.calls, ['expand:repo:dir-a', 'select:repo:dir-a']);
  assert.equal(harness.getDirtyCount(), 3);

  harness.calls.length = 0;
  harness.setLeftNavSelection({
    kind: 'conversation',
    sessionId: 'session-a',
  });
  assert.equal(harness.router.handleRepositoryTreeArrow(Buffer.from('\u001b[C', 'utf8')), false);

  harness.setLeftNavSelection({
    kind: 'home',
  });
  assert.equal(harness.router.handleRepositoryTreeArrow(Buffer.from('\u001b[D', 'utf8')), false);
  assert.equal(harness.router.handleRepositoryTreeArrow(Buffer.from('x', 'utf8')), false);

  harness.setLeftNavSelection({
    kind: 'conversation',
    sessionId: 'session-b',
  });
  assert.equal(harness.router.handleRepositoryTreeArrow(Buffer.from('\u001b[D', 'utf8')), false);
});

void test('repository fold input handles prefix chords, timeout, and conversation reset path', () => {
  const harness = createHarness();

  const prefixHandled = harness.router.handleRepositoryFoldChords(Buffer.from([0x0b]));
  assert.equal(prefixHandled, true);
  assert.equal(harness.getPrefixAtMs(), 1000);
  assert.equal(harness.getDirtyCount(), 0);

  const expandAllHandled = harness.router.handleRepositoryFoldChords(Buffer.from([0x0a]));
  assert.equal(expandAllHandled, true);
  assert.equal(harness.getPrefixAtMs(), null);
  assert.equal(harness.calls.includes('expand-all'), true);
  assert.equal(harness.getDirtyCount(), 1);

  harness.calls.length = 0;
  harness.router.handleRepositoryFoldChords(Buffer.from([0x0b]));
  const collapseAllHandled = harness.router.handleRepositoryFoldChords(Buffer.from([0x30]));
  assert.equal(collapseAllHandled, true);
  assert.equal(harness.calls.includes('collapse-all'), true);
  assert.equal(harness.getDirtyCount(), 2);

  harness.setPrefixAtMs(0);
  harness.setNowMs(5000);
  const timedOutHandled = harness.router.handleRepositoryFoldChords(Buffer.from([0x0a]));
  assert.equal(timedOutHandled, false);
  assert.equal(harness.getPrefixAtMs(), null);

  harness.setLeftNavSelection({
    kind: 'conversation',
    sessionId: 'session-a',
  });
  harness.setPrefixAtMs(100);
  const conversationHandled = harness.router.handleRepositoryFoldChords(Buffer.from([0x0b]));
  assert.equal(conversationHandled, false);
  assert.equal(harness.getPrefixAtMs(), null);
});
