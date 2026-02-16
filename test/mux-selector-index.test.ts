import assert from 'node:assert/strict';
import test from 'node:test';
import { cycleConversationId } from '../src/mux/conversation-rail.ts';
import { buildSelectorIndexEntries, visualConversationOrder } from '../src/mux/selector-index.ts';

void test('selector index follows directory order then per-directory session order', () => {
  const directories = new Map<string, { directoryId: string }>([
    ['dir-a', { directoryId: 'dir-a' }],
    ['dir-b', { directoryId: 'dir-b' }]
  ]);
  const conversations = new Map<string, {
    sessionId: string;
    directoryId: string | null;
    title: string;
    agentType: string;
  }>([
    ['session-1', { sessionId: 'session-1', directoryId: 'dir-b', title: 'b-1', agentType: 'codex' }],
    ['session-2', { sessionId: 'session-2', directoryId: 'dir-a', title: 'a-1', agentType: 'codex' }],
    ['session-3', { sessionId: 'session-3', directoryId: 'dir-a', title: 'a-2', agentType: 'terminal' }]
  ]);

  const entries = buildSelectorIndexEntries(directories, conversations, [
    'session-1',
    'session-2',
    'session-3'
  ]);

  assert.deepEqual(entries, [
    {
      selectorIndex: 1,
      directoryIndex: 1,
      directoryId: 'dir-a',
      sessionId: 'session-2',
      title: 'a-1',
      agentType: 'codex'
    },
    {
      selectorIndex: 2,
      directoryIndex: 2,
      directoryId: 'dir-a',
      sessionId: 'session-3',
      title: 'a-2',
      agentType: 'terminal'
    },
    {
      selectorIndex: 3,
      directoryIndex: 1,
      directoryId: 'dir-b',
      sessionId: 'session-1',
      title: 'b-1',
      agentType: 'codex'
    }
  ]);
});

void test('selector index appends unknown and null directories after known directories', () => {
  const directories = new Map<string, { directoryId: string }>([
    ['dir-a', { directoryId: 'dir-a' }]
  ]);
  const conversations = new Map<string, {
    sessionId: string;
    directoryId: string | null;
    title: string;
    agentType: string;
  }>([
    ['session-known', { sessionId: 'session-known', directoryId: 'dir-a', title: 'known', agentType: 'codex' }],
    ['session-unknown', { sessionId: 'session-unknown', directoryId: 'dir-z', title: 'unknown', agentType: 'codex' }],
    ['session-null', { sessionId: 'session-null', directoryId: null, title: 'null', agentType: 'terminal' }]
  ]);

  const entries = buildSelectorIndexEntries(directories, conversations, [
    'session-known',
    'session-unknown',
    'session-null'
  ]);

  assert.deepEqual(entries, [
    {
      selectorIndex: 1,
      directoryIndex: 1,
      directoryId: 'dir-a',
      sessionId: 'session-known',
      title: 'known',
      agentType: 'codex'
    },
    {
      selectorIndex: 2,
      directoryIndex: 1,
      directoryId: 'dir-z',
      sessionId: 'session-unknown',
      title: 'unknown',
      agentType: 'codex'
    },
    {
      selectorIndex: 3,
      directoryIndex: 1,
      directoryId: 'directory-missing',
      sessionId: 'session-null',
      title: 'null',
      agentType: 'terminal'
    }
  ]);
});

void test('selector index ignores unknown ordered session ids and normalizes blank directory ids', () => {
  const directories = new Map<string, { directoryId: string }>([
    ['dir-a', { directoryId: 'dir-a' }]
  ]);
  const conversations = new Map<string, {
    sessionId: string;
    directoryId: string | null;
    title: string;
    agentType: string;
  }>([
    ['session-1', { sessionId: 'session-1', directoryId: 'dir-a', title: 'known', agentType: 'codex' }],
    ['session-2', { sessionId: 'session-2', directoryId: '   ', title: 'blank', agentType: 'terminal' }]
  ]);

  const entries = buildSelectorIndexEntries(directories, conversations, [
    'session-missing',
    'session-1',
    'session-2',
    'session-missing-2'
  ]);

  assert.deepEqual(entries, [
    {
      selectorIndex: 1,
      directoryIndex: 1,
      directoryId: 'dir-a',
      sessionId: 'session-1',
      title: 'known',
      agentType: 'codex'
    },
    {
      selectorIndex: 2,
      directoryIndex: 1,
      directoryId: 'directory-missing',
      sessionId: 'session-2',
      title: 'blank',
      agentType: 'terminal'
    }
  ]);
});

void test('visual conversation order matches rendered project grouping for thread cycling', () => {
  const directories = new Map<string, { directoryId: string }>([
    ['dir-a', { directoryId: 'dir-a' }],
    ['dir-b', { directoryId: 'dir-b' }]
  ]);
  const conversations = new Map<string, {
    sessionId: string;
    directoryId: string | null;
    title: string;
    agentType: string;
  }>([
    ['session-b-1', { sessionId: 'session-b-1', directoryId: 'dir-b', title: 'b-1', agentType: 'codex' }],
    ['session-a-1', { sessionId: 'session-a-1', directoryId: 'dir-a', title: 'a-1', agentType: 'codex' }],
    ['session-b-2', { sessionId: 'session-b-2', directoryId: 'dir-b', title: 'b-2', agentType: 'terminal' }]
  ]);
  const insertionOrder = ['session-b-1', 'session-a-1', 'session-b-2'] as const;

  const visualOrder = visualConversationOrder(directories, conversations, insertionOrder);

  assert.deepEqual(visualOrder, ['session-a-1', 'session-b-1', 'session-b-2']);
  assert.equal(cycleConversationId(visualOrder, 'session-a-1', 'next'), 'session-b-1');
});
