import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  parseAgentToolStatusList,
  RuntimeCommandMenuAgentTools,
} from '../../../../src/services/runtime-command-menu-agent-tools.ts';

void test('parseAgentToolStatusList keeps only valid agent tool status rows', () => {
  const parsed = parseAgentToolStatusList({
    tools: [
      {
        agentType: 'codex',
        launchCommand: 'codex',
        available: true,
        installCommand: null,
      },
      {
        agentType: 'unknown',
        launchCommand: 'tool',
        available: false,
        installCommand: 'install tool',
      },
      {
        agentType: 'critique',
        launchCommand: 1,
        available: false,
        installCommand: 'bunx critique@latest',
      },
    ],
  });
  assert.deepEqual(parsed, [
    {
      agentType: 'codex',
      launchCommand: 'codex',
      available: true,
      installCommand: null,
    },
  ]);
});

void test('RuntimeCommandMenuAgentTools refreshes status cache and marks dirty only with an open menu', async () => {
  const queue: Array<() => Promise<void>> = [];
  let dirtyCount = 0;
  let menuState: { scope: string } | null = {
    scope: 'thread-start',
  };
  const service = new RuntimeCommandMenuAgentTools({
    sendCommand: async () => ({
      tools: [
        {
          agentType: 'codex',
          launchCommand: 'codex',
          available: false,
          installCommand: 'brew install codex-cli',
        },
      ],
    }),
    queueControlPlaneOp: (task) => {
      queue.push(task);
    },
    getCommandMenu: () => menuState,
    markDirty: () => {
      dirtyCount += 1;
    },
  });

  service.refresh();
  assert.equal(queue.length, 1);
  await queue.shift()?.();
  assert.equal(dirtyCount, 1);
  assert.equal(service.statusForAgent('codex')?.installCommand, 'brew install codex-cli');

  menuState = null;
  service.refresh();
  await queue.shift()?.();
  assert.equal(dirtyCount, 1);
});
