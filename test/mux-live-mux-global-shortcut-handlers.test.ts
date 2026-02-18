import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { handleGlobalShortcut } from '../src/mux/live-mux/global-shortcut-handlers.ts';

interface RecordedQueueCall {
  readonly label: string;
  readonly task: () => Promise<void>;
}

function baseOptions(overrides: Partial<Parameters<typeof handleGlobalShortcut>[0]> = {}) {
  const queued: RecordedQueueCall[] = [];
  const calls = {
    requestStop: 0,
    newThread: 0,
    critique: 0,
    profileToggle: 0,
    statusTimelineToggle: 0,
    renderTraceToggle: 0,
    renderTraceConversationId: null as string | null,
    archive: 0,
    interrupt: 0,
    takeover: 0,
    addDirectory: 0,
    closeDirectory: 0,
    cycle: 0,
  };
  const options: Parameters<typeof handleGlobalShortcut>[0] = {
    shortcut: null,
    requestStop: () => {
      calls.requestStop += 1;
    },
    resolveDirectoryForAction: () => 'directory-1',
    openNewThreadPrompt: (_directoryId) => {
      calls.newThread += 1;
    },
    openOrCreateCritiqueConversationInDirectory: async (_directoryId) => {
      calls.critique += 1;
    },
    toggleGatewayProfile: async () => {
      calls.profileToggle += 1;
    },
    toggleGatewayStatusTimeline: async () => {
      calls.statusTimelineToggle += 1;
    },
    toggleGatewayRenderTrace: async (conversationId) => {
      calls.renderTraceToggle += 1;
      calls.renderTraceConversationId = conversationId;
    },
    resolveConversationForAction: () => 'conversation-1',
    conversationsHas: () => true,
    queueControlPlaneOp: (task, label) => {
      queued.push({ task, label });
    },
    archiveConversation: async (_sessionId) => {
      calls.archive += 1;
    },
    interruptConversation: async (_sessionId) => {
      calls.interrupt += 1;
    },
    takeoverConversation: async (_sessionId) => {
      calls.takeover += 1;
    },
    openAddDirectoryPrompt: () => {
      calls.addDirectory += 1;
    },
    resolveClosableDirectoryId: () => 'directory-1',
    closeDirectory: async (_directoryId) => {
      calls.closeDirectory += 1;
    },
    cycleLeftNavSelection: (_direction) => {
      calls.cycle += 1;
    },
    ...overrides,
  };
  return {
    calls,
    queued,
    options,
  };
}

void test('global shortcut handler covers direct and queued actions', async () => {
  {
    const { options, calls } = baseOptions({ shortcut: null });
    assert.equal(handleGlobalShortcut(options), false);
    assert.equal(calls.requestStop, 0);
  }

  {
    const { options, calls } = baseOptions({ shortcut: 'mux.app.quit' });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(calls.requestStop, 1);
  }

  {
    const { options, calls } = baseOptions({
      shortcut: 'mux.conversation.new',
      resolveDirectoryForAction: () => null,
    });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(calls.newThread, 0);
  }

  {
    const { options, calls } = baseOptions({
      shortcut: 'mux.conversation.new',
      resolveDirectoryForAction: () => 'directory-2',
    });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(calls.newThread, 1);
  }

  {
    const { options, queued, calls } = baseOptions({
      shortcut: 'mux.conversation.critique.open-or-create',
      resolveDirectoryForAction: () => 'directory-critique',
    });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.label, 'shortcut-open-or-create-critique-conversation');
    await queued[0]!.task();
    assert.equal(calls.critique, 1);
  }

  {
    const { options, queued, calls } = baseOptions({
      shortcut: 'mux.gateway.profile.toggle',
    });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.label, 'shortcut-toggle-gateway-profile');
    await queued[0]!.task();
    assert.equal(calls.profileToggle, 1);
  }

  {
    const { options, queued, calls } = baseOptions({
      shortcut: 'mux.gateway.status-timeline.toggle',
    });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.label, 'shortcut-toggle-gateway-status-timeline');
    await queued[0]!.task();
    assert.equal(calls.statusTimelineToggle, 1);
  }

  {
    const { options, queued, calls } = baseOptions({
      shortcut: 'mux.gateway.render-trace.toggle',
      resolveConversationForAction: () => 'conversation-trace',
    });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.label, 'shortcut-toggle-gateway-render-trace');
    await queued[0]!.task();
    assert.equal(calls.renderTraceToggle, 1);
    assert.equal(calls.renderTraceConversationId, 'conversation-trace');
  }

  {
    const { options, queued } = baseOptions({
      shortcut: 'mux.conversation.archive',
      resolveConversationForAction: () => null,
    });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(queued.length, 0);
  }

  {
    const { options, queued, calls } = baseOptions({
      shortcut: 'mux.conversation.delete',
      resolveConversationForAction: () => 'conversation-delete',
      conversationsHas: (sessionId) => sessionId === 'conversation-delete',
    });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.label, 'shortcut-delete-conversation');
    await queued[0]!.task();
    assert.equal(calls.archive, 1);
  }

  {
    const { options, queued, calls } = baseOptions({
      shortcut: 'mux.conversation.interrupt',
      resolveConversationForAction: () => 'conversation-interrupt',
      conversationsHas: (sessionId) => sessionId === 'conversation-interrupt',
    });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.label, 'shortcut-interrupt-conversation');
    await queued[0]!.task();
    assert.equal(calls.interrupt, 1);
  }

  {
    const { options, queued, calls } = baseOptions({
      shortcut: 'mux.conversation.takeover',
      resolveConversationForAction: () => 'conversation-takeover',
      conversationsHas: (sessionId) => sessionId === 'conversation-takeover',
    });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.label, 'shortcut-takeover-conversation');
    await queued[0]!.task();
    assert.equal(calls.takeover, 1);
  }

  {
    const { options, calls } = baseOptions({ shortcut: 'mux.directory.add' });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(calls.addDirectory, 1);
  }

  {
    const { options, queued, calls } = baseOptions({
      shortcut: 'mux.directory.close',
      resolveClosableDirectoryId: () => 'directory-close',
    });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.label, 'shortcut-close-directory');
    await queued[0]!.task();
    assert.equal(calls.closeDirectory, 1);
  }

  {
    const { options, calls } = baseOptions({ shortcut: 'mux.conversation.next' });
    assert.equal(handleGlobalShortcut(options), true);
    assert.equal(calls.cycle, 1);
  }

  {
    const { options } = baseOptions({ shortcut: 'mux.unknown.action' });
    assert.equal(handleGlobalShortcut(options), false);
  }
});
