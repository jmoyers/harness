import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  collapseAllRepositoryGroups,
  collapseRepositoryGroup,
  expandAllRepositoryGroups,
  expandRepositoryGroup,
  firstDirectoryForRepositoryGroup,
  reduceRepositoryFoldChordInput,
  repositoryTreeArrowAction,
  selectedRepositoryGroupIdForLeftNav,
  toggleRepositoryGroup,
} from '../../../../src/mux/live-mux/repository-folding.ts';
import type { ConversationState } from '../../../../src/mux/live-mux/conversation-state.ts';

void test('repository folding selection and arrow helpers resolve expected targets', () => {
  const conversations = new Map<string, ConversationState>([
    [
      'session-a',
      {
        directoryId: 'dir-a',
      } as ConversationState,
    ],
    [
      'session-b',
      {
        directoryId: null,
      } as ConversationState,
    ],
  ]);
  const groupForDirectory = (directoryId: string) => `group:${directoryId}`;

  assert.equal(
    selectedRepositoryGroupIdForLeftNav(
      {
        kind: 'repository',
        repositoryId: 'repo-a',
      },
      conversations,
      groupForDirectory,
    ),
    'repo-a',
  );
  assert.equal(
    selectedRepositoryGroupIdForLeftNav(
      {
        kind: 'project',
        directoryId: 'dir-a',
      },
      conversations,
      groupForDirectory,
    ),
    'group:dir-a',
  );
  assert.equal(
    selectedRepositoryGroupIdForLeftNav(
      {
        kind: 'github',
        directoryId: 'dir-a',
      },
      conversations,
      groupForDirectory,
    ),
    'group:dir-a',
  );
  assert.equal(
    selectedRepositoryGroupIdForLeftNav(
      {
        kind: 'conversation',
        sessionId: 'session-a',
      },
      conversations,
      groupForDirectory,
    ),
    'group:dir-a',
  );
  assert.equal(
    selectedRepositoryGroupIdForLeftNav(
      {
        kind: 'conversation',
        sessionId: 'session-b',
      },
      conversations,
      groupForDirectory,
    ),
    null,
  );
  assert.equal(
    selectedRepositoryGroupIdForLeftNav(
      {
        kind: 'conversation',
        sessionId: 'missing',
      },
      conversations,
      groupForDirectory,
    ),
    null,
  );
  assert.equal(
    selectedRepositoryGroupIdForLeftNav(
      {
        kind: 'home',
      },
      conversations,
      groupForDirectory,
    ),
    null,
  );

  assert.equal(
    repositoryTreeArrowAction(
      Buffer.from('\u001b[C', 'utf8'),
      {
        kind: 'conversation',
        sessionId: 'session-a',
      },
      'repo-a',
    ),
    null,
  );
  assert.equal(
    repositoryTreeArrowAction(
      Buffer.from('\u001b[C', 'utf8'),
      {
        kind: 'repository',
        repositoryId: 'repo-a',
      },
      null,
    ),
    null,
  );
  assert.equal(
    repositoryTreeArrowAction(
      Buffer.from('\u001b[C', 'utf8'),
      {
        kind: 'repository',
        repositoryId: 'repo-a',
      },
      'repo-a',
    ),
    'expand',
  );
  assert.equal(
    repositoryTreeArrowAction(
      Buffer.from('\u001b[D', 'utf8'),
      {
        kind: 'project',
        directoryId: 'dir-a',
      },
      'repo-a',
    ),
    'collapse',
  );
  assert.equal(
    repositoryTreeArrowAction(
      Buffer.from('x', 'utf8'),
      {
        kind: 'project',
        directoryId: 'dir-a',
      },
      'repo-a',
    ),
    null,
  );
});

void test('repository fold chord reducer handles prefix, timeout, and expand/collapse actions', () => {
  const prefix = Buffer.from('gg', 'utf8');
  assert.deepEqual(
    reduceRepositoryFoldChordInput({
      input: prefix,
      leftNavSelection: {
        kind: 'conversation',
        sessionId: 'session-a',
      },
      nowMs: 100,
      prefixAtMs: null,
      chordTimeoutMs: 300,
      collapseAllChordPrefix: prefix,
    }),
    {
      consumed: false,
      nextPrefixAtMs: null,
      action: null,
    },
  );

  assert.deepEqual(
    reduceRepositoryFoldChordInput({
      input: prefix,
      leftNavSelection: {
        kind: 'repository',
        repositoryId: 'repo-a',
      },
      nowMs: 1000,
      prefixAtMs: 0,
      chordTimeoutMs: 300,
      collapseAllChordPrefix: prefix,
    }),
    {
      consumed: true,
      nextPrefixAtMs: 1000,
      action: null,
    },
  );

  assert.deepEqual(
    reduceRepositoryFoldChordInput({
      input: Buffer.from('\n', 'utf8'),
      leftNavSelection: {
        kind: 'repository',
        repositoryId: 'repo-a',
      },
      nowMs: 1200,
      prefixAtMs: 1100,
      chordTimeoutMs: 300,
      collapseAllChordPrefix: prefix,
    }),
    {
      consumed: true,
      nextPrefixAtMs: null,
      action: 'expand-all',
    },
  );

  assert.deepEqual(
    reduceRepositoryFoldChordInput({
      input: Buffer.from('0', 'utf8'),
      leftNavSelection: {
        kind: 'project',
        directoryId: 'dir-a',
      },
      nowMs: 1200,
      prefixAtMs: 1100,
      chordTimeoutMs: 300,
      collapseAllChordPrefix: prefix,
    }),
    {
      consumed: true,
      nextPrefixAtMs: null,
      action: 'collapse-all',
    },
  );

  assert.deepEqual(
    reduceRepositoryFoldChordInput({
      input: Buffer.from('x', 'utf8'),
      leftNavSelection: {
        kind: 'project',
        directoryId: 'dir-a',
      },
      nowMs: 1200,
      prefixAtMs: 1100,
      chordTimeoutMs: 300,
      collapseAllChordPrefix: prefix,
    }),
    {
      consumed: false,
      nextPrefixAtMs: null,
      action: null,
    },
  );

  assert.deepEqual(
    reduceRepositoryFoldChordInput({
      input: Buffer.from('x', 'utf8'),
      leftNavSelection: {
        kind: 'repository',
        repositoryId: 'repo-a',
      },
      nowMs: 100,
      prefixAtMs: null,
      chordTimeoutMs: 300,
      collapseAllChordPrefix: prefix,
    }),
    {
      consumed: false,
      nextPrefixAtMs: null,
      action: null,
    },
  );
});

void test('repository fold state mutators and first-directory lookup are stable', () => {
  const expanded = new Set<string>();
  const collapsed = new Set<string>();

  collapseRepositoryGroup('repo-a', false, expanded, collapsed);
  assert.equal(collapsed.has('repo-a'), true);
  expandRepositoryGroup('repo-a', false, expanded, collapsed);
  assert.equal(collapsed.has('repo-a'), false);

  collapseRepositoryGroup('repo-a', true, expanded, collapsed);
  assert.equal(expanded.has('repo-a'), false);
  expandRepositoryGroup('repo-a', true, expanded, collapsed);
  assert.equal(expanded.has('repo-a'), true);

  toggleRepositoryGroup('repo-a', true, expanded, collapsed);
  assert.equal(expanded.has('repo-a'), false);
  toggleRepositoryGroup('repo-a', true, expanded, collapsed);
  assert.equal(expanded.has('repo-a'), true);

  toggleRepositoryGroup('repo-a', false, expanded, collapsed);
  assert.equal(collapsed.has('repo-a'), true);
  toggleRepositoryGroup('repo-a', false, expanded, collapsed);
  assert.equal(collapsed.has('repo-a'), false);

  collapsed.add('repo-a');
  expanded.add('repo-b');
  assert.equal(collapseAllRepositoryGroups(collapsed, expanded), true);
  assert.equal(collapsed.size, 0);
  assert.equal(expanded.size, 0);
  collapsed.add('repo-a');
  expanded.add('repo-b');
  assert.equal(expandAllRepositoryGroups(collapsed, expanded), false);
  assert.equal(collapsed.size, 0);
  assert.equal(expanded.size, 0);

  const directories = new Map([
    [
      'dir-a',
      {
        directoryId: 'dir-a',
      },
    ],
    [
      'dir-b',
      {
        directoryId: 'dir-b',
      },
    ],
  ]);
  assert.equal(
    firstDirectoryForRepositoryGroup(
      directories,
      (directoryId) => (directoryId === 'dir-a' ? 'repo-a' : 'repo-b'),
      'repo-b',
    ),
    'dir-b',
  );
  assert.equal(
    firstDirectoryForRepositoryGroup(
      directories,
      (directoryId) => (directoryId === 'dir-a' ? 'repo-a' : 'repo-b'),
      'missing',
    ),
    null,
  );
});
