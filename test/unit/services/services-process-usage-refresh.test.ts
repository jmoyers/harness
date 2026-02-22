import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { ProcessUsageRefreshService } from '../../../src/services/process-usage-refresh.ts';

interface Conversation {
  readonly processId: number | null;
}

interface Sample {
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
}

void test('process usage refresh service refreshes snapshots and emits change notifications', async () => {
  const changedCalls: string[] = [];
  const spanCalls: string[] = [];
  const service = new ProcessUsageRefreshService<Conversation, Sample>({
    readProcessUsageSample: async () => ({ cpuPercent: 10, memoryMb: 20 }),
    processIdForConversation: (conversation) => conversation.processId,
    processUsageEqual: (left, right) =>
      left.cpuPercent === right.cpuPercent && left.memoryMb === right.memoryMb,
    startPerfSpan: (_name, attrs) => {
      spanCalls.push(`start:${JSON.stringify(attrs)}`);
      return {
        end: (endAttrs) => spanCalls.push(`end:${JSON.stringify(endAttrs)}`),
      };
    },
    onChanged: () => {
      changedCalls.push('changed');
    },
    refreshSnapshots: async (options) => {
      options.processUsageBySessionId.set('session-a', { cpuPercent: 10, memoryMb: 20 });
      return {
        samples: options.conversations.size,
        changed: true,
      };
    },
  });

  await service.refresh(
    'startup',
    new Map<string, Conversation>([['session-a', { processId: 1 }]]),
  );

  assert.deepEqual(changedCalls, ['changed']);
  assert.deepEqual(spanCalls, [
    'start:{"reason":"startup","conversations":1}',
    'end:{"reason":"startup","samples":1,"changed":true}',
  ]);
  assert.deepEqual(service.getSample('session-a'), { cpuPercent: 10, memoryMb: 20 });
});

void test('process usage refresh service skips onChanged when snapshots are unchanged', async () => {
  const changedCalls: string[] = [];
  const service = new ProcessUsageRefreshService<Conversation, Sample>({
    readProcessUsageSample: async () => ({ cpuPercent: 10, memoryMb: 20 }),
    processIdForConversation: (conversation) => conversation.processId,
    processUsageEqual: () => true,
    startPerfSpan: () => ({
      end: () => {},
    }),
    onChanged: () => {
      changedCalls.push('changed');
    },
    refreshSnapshots: async () => ({
      samples: 2,
      changed: false,
    }),
  });

  await service.refresh(
    'interval',
    new Map<string, Conversation>([
      ['session-a', { processId: 1 }],
      ['session-b', { processId: 2 }],
    ]),
  );

  assert.deepEqual(changedCalls, []);
});

void test('process usage refresh service ignores overlapping refresh calls', async () => {
  let resolveRefresh: (() => void) | null = null;
  let refreshCalls = 0;
  const service = new ProcessUsageRefreshService<Conversation, Sample>({
    readProcessUsageSample: async () => ({ cpuPercent: 1, memoryMb: 2 }),
    processIdForConversation: (conversation) => conversation.processId,
    processUsageEqual: () => true,
    startPerfSpan: () => ({
      end: () => {},
    }),
    onChanged: () => {},
    refreshSnapshots: async () => {
      refreshCalls += 1;
      await new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      });
      return {
        samples: 1,
        changed: false,
      };
    },
  });

  const first = service.refresh(
    'interval',
    new Map<string, Conversation>([['session-a', { processId: 1 }]]),
  );
  const second = service.refresh(
    'interval',
    new Map<string, Conversation>([['session-a', { processId: 1 }]]),
  );
  await second;
  if (resolveRefresh === null) {
    throw new Error('expected refresh resolver');
  }
  (resolveRefresh as () => void)();
  await first;

  assert.equal(refreshCalls, 1);
});

void test('process usage refresh service exposes usage map lifecycle helpers', async () => {
  const service = new ProcessUsageRefreshService<Conversation, Sample>({
    readProcessUsageSample: async () => ({ cpuPercent: 1, memoryMb: 2 }),
    processIdForConversation: (conversation) => conversation.processId,
    processUsageEqual: () => false,
    startPerfSpan: () => ({
      end: () => {},
    }),
    onChanged: () => {},
    refreshSnapshots: async (options) => {
      options.processUsageBySessionId.set('session-x', { cpuPercent: 5, memoryMb: 6 });
      return {
        samples: 1,
        changed: true,
      };
    },
  });

  await service.refresh(
    'startup',
    new Map<string, Conversation>([['session-x', { processId: 3 }]]),
  );
  assert.equal(service.readonlyUsage().has('session-x'), true);
  assert.deepEqual(service.getSample('session-x'), { cpuPercent: 5, memoryMb: 6 });

  service.deleteSession('session-x');
  assert.equal(service.readonlyUsage().has('session-x'), false);
  assert.equal(service.getSample('session-x'), undefined);
});
