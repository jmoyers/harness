import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeConversationActions } from '../src/services/runtime-conversation-actions.ts';

interface ControllerRecord {
  readonly controllerId: string;
  readonly controllerType: string;
  readonly controllerLabel: string;
  readonly takeoverAt: string;
  readonly takeoverReason: string;
}

function createControllerRecord(controllerId: string): ControllerRecord {
  return {
    controllerId,
    controllerType: 'human',
    controllerLabel: 'label',
    takeoverAt: 'now',
    takeoverReason: 'reason',
  };
}

void test('runtime conversation actions create-and-activate flow delegates in expected sequence', async () => {
  const calls: string[] = [];
  const created: Array<Record<string, unknown>> = [];
  const ensured: Array<Record<string, unknown>> = [];
  const actions = new RuntimeConversationActions<ControllerRecord>({
    controlPlaneService: {
      createConversation: async (input) => {
        created.push(input);
      },
      claimSession: async () => null,
    },
    createConversationId: () => 'conversation-1',
    ensureConversation: (sessionId, seed) => {
      ensured.push({ sessionId, ...seed });
      calls.push('ensureConversation');
    },
    noteGitActivity: (directoryId) => {
      calls.push(`noteGit:${directoryId}`);
    },
    startConversation: async (sessionId) => {
      calls.push(`start:${sessionId}`);
    },
    activateConversation: async (sessionId) => {
      calls.push(`activate:${sessionId}`);
    },
    orderedConversationIds: () => [],
    conversationById: () => null,
    conversationsHas: () => false,
    applyController: () => {},
    setLastEventNow: () => {},
    muxControllerId: 'mux-controller-id',
    muxControllerLabel: 'mux-controller-label',
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  await actions.createAndActivateConversationInDirectory('directory-1', 'codex');

  assert.deepEqual(created, [
    {
      conversationId: 'conversation-1',
      directoryId: 'directory-1',
      title: '',
      agentType: 'codex',
      adapterState: {},
    },
  ]);
  assert.deepEqual(ensured, [
    {
      sessionId: 'conversation-1',
      directoryId: 'directory-1',
      title: '',
      agentType: 'codex',
      adapterState: {},
    },
  ]);
  assert.deepEqual(calls, [
    'ensureConversation',
    'noteGit:directory-1',
    'start:conversation-1',
    'activate:conversation-1',
  ]);
});

void test('runtime conversation actions open-or-create critique activates existing or creates new', async () => {
  const calls: string[] = [];
  const createdConversationIds: string[] = [];
  let nextConversationId = 'critique-created';
  const actions = new RuntimeConversationActions<ControllerRecord>({
    controlPlaneService: {
      createConversation: async (input) => {
        createdConversationIds.push(String(input.conversationId));
      },
      claimSession: async () => null,
    },
    createConversationId: () => nextConversationId,
    ensureConversation: () => {
      calls.push('ensureConversation');
    },
    noteGitActivity: () => {
      calls.push('noteGitActivity');
    },
    startConversation: async () => {
      calls.push('startConversation');
    },
    activateConversation: async (sessionId) => {
      calls.push(`activate:${sessionId}`);
    },
    orderedConversationIds: () => ['session-existing'],
    conversationById: (sessionId) =>
      sessionId === 'session-existing'
        ? {
            directoryId: 'directory-existing',
            agentType: 'critique',
          }
        : null,
    conversationsHas: () => false,
    applyController: () => {},
    setLastEventNow: () => {},
    muxControllerId: 'mux-controller-id',
    muxControllerLabel: 'mux-controller-label',
    markDirty: () => {},
  });

  await actions.openOrCreateCritiqueConversationInDirectory('directory-existing');
  assert.deepEqual(calls, ['activate:session-existing']);
  assert.equal(createdConversationIds.length, 0);

  calls.length = 0;
  nextConversationId = 'critique-created-2';
  const createFlowActions = new RuntimeConversationActions<ControllerRecord>({
    controlPlaneService: {
      createConversation: async (input) => {
        createdConversationIds.push(String(input.conversationId));
      },
      claimSession: async () => null,
    },
    createConversationId: () => nextConversationId,
    ensureConversation: () => {
      calls.push('ensureConversation');
    },
    noteGitActivity: () => {
      calls.push('noteGitActivity');
    },
    startConversation: async () => {
      calls.push('startConversation');
    },
    activateConversation: async (sessionId) => {
      calls.push(`activate:${sessionId}`);
    },
    orderedConversationIds: () => ['session-other'],
    conversationById: () => ({
      directoryId: 'directory-other',
      agentType: 'codex',
    }),
    conversationsHas: () => false,
    applyController: () => {},
    setLastEventNow: () => {},
    muxControllerId: 'mux-controller-id',
    muxControllerLabel: 'mux-controller-label',
    markDirty: () => {},
  });

  await createFlowActions.openOrCreateCritiqueConversationInDirectory('directory-target');
  assert.deepEqual(createdConversationIds, ['critique-created-2']);
  assert.deepEqual(calls, [
    'ensureConversation',
    'noteGitActivity',
    'startConversation',
    'activate:critique-created-2',
  ]);
});

void test('runtime conversation actions takeover delegates claim/apply/dirty flow', async () => {
  const calls: string[] = [];
  const applied: Array<Record<string, unknown>> = [];
  const actions = new RuntimeConversationActions<ControllerRecord>({
    controlPlaneService: {
      createConversation: async () => {},
      claimSession: async (input) => {
        calls.push(`claim:${input.sessionId}`);
        return createControllerRecord(input.controllerId);
      },
    },
    createConversationId: () => 'unused',
    ensureConversation: () => {},
    noteGitActivity: () => {},
    startConversation: async () => {},
    activateConversation: async () => {},
    orderedConversationIds: () => [],
    conversationById: () => null,
    conversationsHas: (sessionId) => sessionId === 'session-1',
    applyController: (sessionId, controller) => {
      applied.push({ sessionId, controllerId: controller.controllerId });
      calls.push(`apply:${sessionId}`);
    },
    setLastEventNow: (sessionId) => {
      calls.push(`lastEvent:${sessionId}`);
    },
    muxControllerId: 'mux-controller-id',
    muxControllerLabel: 'mux-controller-label',
    markDirty: () => {
      calls.push('markDirty');
    },
  });

  await actions.takeoverConversation('session-1');
  assert.deepEqual(applied, [{ sessionId: 'session-1', controllerId: 'mux-controller-id' }]);
  assert.deepEqual(calls, ['claim:session-1', 'apply:session-1', 'lastEvent:session-1', 'markDirty']);

  calls.length = 0;
  applied.length = 0;
  await actions.takeoverConversation('session-missing');
  assert.deepEqual(applied, []);
  assert.deepEqual(calls, []);
});
