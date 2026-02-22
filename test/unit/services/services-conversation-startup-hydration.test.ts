import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { ConversationStartupHydrationService } from '../../../src/services/conversation-startup-hydration.ts';

interface SessionSummary {
  readonly sessionId: string;
  readonly live: boolean;
}

void test('conversation startup hydration service hydrates directories and sessions and records span counts', async () => {
  const calls: string[] = [];
  let spanEndPayload: Record<string, unknown> | null = null;
  const service = new ConversationStartupHydrationService<SessionSummary>({
    startHydrationSpan: () => ({
      end: (input) => {
        spanEndPayload = input ?? null;
        calls.push('spanEnd');
      },
    }),
    hydrateDirectoryList: async () => {
      calls.push('hydrateDirectoryList');
    },
    directoryIds: () => ['dir-1', 'dir-2'],
    hydratePersistedConversationsForDirectory: async (directoryId) => {
      calls.push(`hydratePersisted:${directoryId}`);
      return directoryId === 'dir-1' ? 2 : 1;
    },
    listSessions: async () => {
      calls.push('listSessions');
      return [
        { sessionId: 'session-live', live: true },
        { sessionId: 'session-idle', live: false },
      ];
    },
    upsertFromSessionSummary: (summary) => {
      calls.push(`upsertSummary:${summary.sessionId}`);
    },
    subscribeConversationEvents: async (sessionId) => {
      calls.push(`subscribe:${sessionId}`);
    },
  });

  await service.hydrateConversationList();

  assert.deepEqual(calls, [
    'hydrateDirectoryList',
    'hydratePersisted:dir-1',
    'hydratePersisted:dir-2',
    'listSessions',
    'upsertSummary:session-live',
    'subscribe:session-live',
    'upsertSummary:session-idle',
    'spanEnd',
  ]);
  assert.deepEqual(spanEndPayload, {
    persisted: 3,
    live: 2,
  });
});

void test('conversation startup hydration service handles empty hydration payloads', async () => {
  let spanEndPayload: Record<string, unknown> | null = null;
  const service = new ConversationStartupHydrationService<SessionSummary>({
    startHydrationSpan: () => ({
      end: (input) => {
        spanEndPayload = input ?? null;
      },
    }),
    hydrateDirectoryList: async () => {},
    directoryIds: () => [],
    hydratePersistedConversationsForDirectory: async () => 0,
    listSessions: async () => [],
    upsertFromSessionSummary: () => {},
    subscribeConversationEvents: async () => {},
  });

  await service.hydrateConversationList();

  assert.deepEqual(spanEndPayload, {
    persisted: 0,
    live: 0,
  });
});
