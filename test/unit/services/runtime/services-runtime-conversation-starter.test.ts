import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { RuntimeConversationStarter } from '../../../../src/services/runtime-conversation-starter.ts';

interface ConversationRecord {
  readonly sessionId: string;
  readonly directoryId: string | null;
  readonly agentType: string;
  adapterState: Record<string, unknown>;
  live: boolean;
  lastOutputCursor: number;
  launchCommand: string;
}

void test('runtime conversation starter returns existing live conversation and records already-live startup span', async () => {
  const calls: string[] = [];
  const existing: ConversationRecord = {
    sessionId: 'session-live',
    directoryId: 'directory-1',
    agentType: 'codex',
    adapterState: {},
    live: true,
    lastOutputCursor: 42,
    launchCommand: '',
  };

  const starter = new RuntimeConversationStarter<
    ConversationRecord,
    { readonly sessionId: string }
  >({
    runWithStartInFlight: async (_sessionId, run) => {
      calls.push('runWithStartInFlight');
      return await run();
    },
    conversationById: () => existing,
    ensureConversation: () => {
      throw new Error('ensure should not be called for existing live conversation');
    },
    normalizeThreadAgentType: (agentType) => agentType,
    codexArgs: ['--codex-default'],
    critiqueDefaultArgs: ['--critique-default'],
    sessionCwdForConversation: () => '/workspace',
    buildLaunchArgs: () => ['resume', '--foo'],
    launchCommandForAgent: (agentType) => `launch-${agentType}`,
    formatCommandForDebugBar: (command, args) => `${command} ${args.join(' ')}`,
    startConversationSpan: () => ({
      end: () => {
        calls.push('startSpan.end');
      },
    }),
    firstPaintTargetSessionId: () => 'session-live',
    endStartCommandSpan: (input) => {
      calls.push(`endStartCommandSpan:${JSON.stringify(input)}`);
    },
    layout: () => ({
      rightCols: 120,
      paneRows: 40,
    }),
    startPtySession: async () => {
      calls.push('startPtySession');
    },
    setPtySize: () => {
      calls.push('setPtySize');
    },
    sendResize: () => {
      calls.push('sendResize');
    },
    sessionEnv: {},
    worktreeId: 'worktree-1',
    terminalForegroundHex: '#ffffff',
    terminalBackgroundHex: '#000000',
    recordStartCommand: () => {
      calls.push('recordStartCommand');
    },
    getSessionStatus: async () => {
      calls.push('getSessionStatus');
      return {
        sessionId: 'session-live',
      };
    },
    upsertFromSessionSummary: () => {
      calls.push('upsertFromSessionSummary');
    },
    subscribeConversationEvents: async () => {
      calls.push('subscribeConversationEvents');
    },
  });

  const result = await starter.startConversation('session-live');

  assert.equal(result, existing);
  assert.equal(existing.launchCommand, 'launch-codex resume --foo');
  assert.deepEqual(calls, ['runWithStartInFlight', 'endStartCommandSpan:{"alreadyLive":true}']);
});

void test('runtime conversation starter starts codex conversation, updates status, and subscribes events', async () => {
  const calls: string[] = [];
  const startPtyInputs: Array<{
    sessionId: string;
    args: readonly string[];
    env: Record<string, string>;
    cwd: string;
    initialCols: number;
    initialRows: number;
    worktreeId?: string;
    terminalForegroundHex?: string;
    terminalBackgroundHex?: string;
  }> = [];
  const endPayloads: Array<Record<string, unknown>> = [];
  const summaryUpserts: Array<string> = [];
  const record: ConversationRecord = {
    sessionId: 'session-start',
    directoryId: 'directory-1',
    agentType: 'codex',
    adapterState: { resumeSessionId: 'resume-1' },
    live: false,
    lastOutputCursor: 77,
    launchCommand: '',
  };

  const starter = new RuntimeConversationStarter<
    ConversationRecord,
    { readonly sessionId: string }
  >({
    runWithStartInFlight: async (_sessionId, run) => {
      calls.push('runWithStartInFlight');
      return await run();
    },
    conversationById: () => undefined,
    ensureConversation: () => {
      calls.push('ensureConversation');
      return record;
    },
    normalizeThreadAgentType: (agentType) => agentType,
    codexArgs: ['--codex-default'],
    critiqueDefaultArgs: ['--critique-default'],
    sessionCwdForConversation: () => '/workspace/start',
    buildLaunchArgs: (input) => {
      calls.push(`buildLaunchArgs:${input.agentType}:${input.baseArgsForAgent.join(',')}`);
      return ['resume', '--model', 'o4'];
    },
    launchCommandForAgent: (agentType) => `launch-${agentType}`,
    formatCommandForDebugBar: (command, args) => `${command} ${args.join(' ')}`,
    startConversationSpan: (sessionId) => ({
      end: (input) => {
        endPayloads.push(input ?? {});
        calls.push(`startSpan.end:${sessionId}`);
      },
    }),
    firstPaintTargetSessionId: () => 'session-start',
    endStartCommandSpan: (input) => {
      calls.push(`endStartCommandSpan:${JSON.stringify(input)}`);
    },
    layout: () => ({
      rightCols: 132,
      paneRows: 44,
    }),
    startPtySession: async (input) => {
      startPtyInputs.push(input);
      calls.push('startPtySession');
    },
    setPtySize: (sessionId, size) => {
      calls.push(`setPtySize:${sessionId}:${size.cols}x${size.rows}`);
    },
    sendResize: (sessionId, cols, rows) => {
      calls.push(`sendResize:${sessionId}:${cols}x${rows}`);
    },
    sessionEnv: {
      HARNESS_ENV: '1',
    },
    worktreeId: 'worktree-1',
    terminalForegroundHex: '#f1f1f1',
    terminalBackgroundHex: '#101010',
    recordStartCommand: (sessionId, launchArgs) => {
      calls.push(`recordStartCommand:${sessionId}:${launchArgs[0] ?? ''}`);
    },
    getSessionStatus: async (sessionId) => {
      calls.push(`getSessionStatus:${sessionId}`);
      return {
        sessionId,
      };
    },
    upsertFromSessionSummary: (summary) => {
      summaryUpserts.push(summary.sessionId);
      calls.push(`upsertFromSessionSummary:${summary.sessionId}`);
    },
    subscribeConversationEvents: async (sessionId) => {
      calls.push(`subscribeConversationEvents:${sessionId}`);
    },
  });

  const result = await starter.startConversation('session-start');

  assert.equal(result, record);
  assert.equal(record.lastOutputCursor, 0);
  assert.equal(record.launchCommand, 'launch-codex resume --model o4');
  assert.deepEqual(startPtyInputs, [
    {
      sessionId: 'session-start',
      args: ['resume', '--model', 'o4'],
      env: { HARNESS_ENV: '1' },
      cwd: '/workspace/start',
      initialCols: 132,
      initialRows: 44,
      worktreeId: 'worktree-1',
      terminalForegroundHex: '#f1f1f1',
      terminalBackgroundHex: '#101010',
    },
  ]);
  assert.deepEqual(endPayloads, [{ live: false }]);
  assert.deepEqual(summaryUpserts, ['session-start']);
  assert.deepEqual(calls, [
    'runWithStartInFlight',
    'ensureConversation',
    'buildLaunchArgs:codex:--codex-default',
    'startPtySession',
    'setPtySize:session-start:132x44',
    'sendResize:session-start:132x44',
    'endStartCommandSpan:{"alreadyLive":false,"argCount":3,"resumed":true}',
    'ensureConversation',
    'recordStartCommand:session-start:resume',
    'getSessionStatus:session-start',
    'upsertFromSessionSummary:session-start',
    'subscribeConversationEvents:session-start',
    'startSpan.end:session-start',
  ]);
});

void test('runtime conversation starter uses critique defaults and skips startup target side effects when target differs', async () => {
  const calls: string[] = [];
  const record: ConversationRecord = {
    sessionId: 'session-critique',
    directoryId: 'directory-critique',
    agentType: 'critique',
    adapterState: {},
    live: false,
    lastOutputCursor: 2,
    launchCommand: '',
  };

  const starter = new RuntimeConversationStarter<
    ConversationRecord,
    { readonly sessionId: string }
  >({
    runWithStartInFlight: async (_sessionId, run) => {
      return await run();
    },
    conversationById: () => record,
    ensureConversation: () => record,
    normalizeThreadAgentType: (agentType) => agentType,
    codexArgs: ['--codex-default'],
    critiqueDefaultArgs: ['--watch'],
    sessionCwdForConversation: () => '/workspace/critique',
    buildLaunchArgs: (input) => {
      calls.push(`buildLaunchArgs:${input.agentType}:${input.baseArgsForAgent.join(',')}`);
      return ['critique', '--watch'];
    },
    launchCommandForAgent: (agentType) => `launch-${agentType}`,
    formatCommandForDebugBar: (command, args) => `${command} ${args.join(' ')}`,
    startConversationSpan: () => ({
      end: () => {
        calls.push('startSpan.end');
      },
    }),
    firstPaintTargetSessionId: () => 'other-session',
    endStartCommandSpan: () => {
      calls.push('endStartCommandSpan');
    },
    layout: () => ({
      rightCols: 80,
      paneRows: 24,
    }),
    startPtySession: async (input) => {
      calls.push(`startPtySession:${Object.keys(input).join(',')}`);
    },
    setPtySize: () => {
      calls.push('setPtySize');
    },
    sendResize: () => {
      calls.push('sendResize');
    },
    sessionEnv: {},
    worktreeId: undefined,
    terminalForegroundHex: undefined,
    terminalBackgroundHex: undefined,
    recordStartCommand: () => {
      calls.push('recordStartCommand');
    },
    getSessionStatus: async () => {
      calls.push('getSessionStatus');
      return null;
    },
    upsertFromSessionSummary: () => {
      calls.push('upsertFromSessionSummary');
    },
    subscribeConversationEvents: async () => {
      calls.push('subscribeConversationEvents');
    },
  });

  await starter.startConversation('session-critique');

  assert.equal(record.launchCommand, 'launch-critique critique --watch');
  assert.deepEqual(calls, [
    'buildLaunchArgs:critique:--watch',
    'startPtySession:sessionId,args,env,cwd,initialCols,initialRows',
    'setPtySize',
    'sendResize',
    'recordStartCommand',
    'getSessionStatus',
    'subscribeConversationEvents',
    'startSpan.end',
  ]);
});

void test('runtime conversation starter falls back to empty base args for non-codex non-critique agents', async () => {
  let capturedBaseArgs: readonly string[] = [];
  const record: ConversationRecord = {
    sessionId: 'session-other',
    directoryId: null,
    agentType: 'terminal',
    adapterState: {},
    live: false,
    lastOutputCursor: 0,
    launchCommand: '',
  };

  const starter = new RuntimeConversationStarter<
    ConversationRecord,
    { readonly sessionId: string }
  >({
    runWithStartInFlight: async (_sessionId, run) => {
      return await run();
    },
    conversationById: () => record,
    ensureConversation: () => record,
    normalizeThreadAgentType: (agentType) => agentType,
    codexArgs: ['--codex-default'],
    critiqueDefaultArgs: ['--watch'],
    sessionCwdForConversation: () => '/workspace',
    buildLaunchArgs: (input) => {
      capturedBaseArgs = input.baseArgsForAgent;
      return ['bash'];
    },
    launchCommandForAgent: () => 'launch-terminal',
    formatCommandForDebugBar: (command, args) => `${command} ${args.join(' ')}`,
    startConversationSpan: () => ({
      end: () => {},
    }),
    firstPaintTargetSessionId: () => null,
    endStartCommandSpan: () => {},
    layout: () => ({
      rightCols: 100,
      paneRows: 30,
    }),
    startPtySession: async () => {},
    setPtySize: () => {},
    sendResize: () => {},
    sessionEnv: {},
    worktreeId: undefined,
    terminalForegroundHex: undefined,
    terminalBackgroundHex: undefined,
    recordStartCommand: () => {},
    getSessionStatus: async () => null,
    upsertFromSessionSummary: () => {},
    subscribeConversationEvents: async () => {},
  });

  await starter.startConversation('session-other');

  assert.deepEqual(capturedBaseArgs, []);
});

void test('runtime conversation starter recovers when pty.start reports existing live session', async () => {
  const calls: string[] = [];
  const record: ConversationRecord = {
    sessionId: 'session-race',
    directoryId: 'directory-1',
    agentType: 'codex',
    adapterState: {},
    live: false,
    lastOutputCursor: 9,
    launchCommand: '',
  };

  const starter = new RuntimeConversationStarter<
    ConversationRecord,
    { readonly sessionId: string }
  >({
    runWithStartInFlight: async (_sessionId, run) => {
      calls.push('runWithStartInFlight');
      return await run();
    },
    conversationById: () => record,
    ensureConversation: () => {
      calls.push('ensureConversation');
      return record;
    },
    normalizeThreadAgentType: (agentType) => agentType,
    codexArgs: ['--codex-default'],
    critiqueDefaultArgs: ['--critique-default'],
    sessionCwdForConversation: () => '/workspace',
    buildLaunchArgs: () => ['resume', '--foo'],
    launchCommandForAgent: () => 'launch-codex',
    formatCommandForDebugBar: (command, args) => `${command} ${args.join(' ')}`,
    startConversationSpan: (sessionId) => ({
      end: () => {
        calls.push(`startSpan.end:${sessionId}`);
      },
    }),
    firstPaintTargetSessionId: () => 'session-race',
    endStartCommandSpan: (input) => {
      calls.push(`endStartCommandSpan:${JSON.stringify(input)}`);
    },
    layout: () => ({
      rightCols: 120,
      paneRows: 40,
    }),
    startPtySession: async () => {
      calls.push('startPtySession');
      throw new Error('session already exists: session-race');
    },
    setPtySize: (sessionId, size) => {
      calls.push(`setPtySize:${sessionId}:${size.cols}x${size.rows}`);
    },
    sendResize: (sessionId, cols, rows) => {
      calls.push(`sendResize:${sessionId}:${cols}x${rows}`);
    },
    sessionEnv: {},
    worktreeId: 'worktree-1',
    terminalForegroundHex: undefined,
    terminalBackgroundHex: undefined,
    recordStartCommand: () => {
      calls.push('recordStartCommand');
    },
    getSessionStatus: async (sessionId) => {
      calls.push(`getSessionStatus:${sessionId}`);
      return {
        sessionId,
      };
    },
    upsertFromSessionSummary: (summary) => {
      calls.push(`upsertFromSessionSummary:${summary.sessionId}`);
    },
    subscribeConversationEvents: async (sessionId) => {
      calls.push(`subscribeConversationEvents:${sessionId}`);
    },
  });

  const result = await starter.startConversation('session-race');
  assert.equal(result, record);
  assert.deepEqual(calls, [
    'runWithStartInFlight',
    'startPtySession',
    'setPtySize:session-race:120x40',
    'sendResize:session-race:120x40',
    'endStartCommandSpan:{"alreadyLive":true,"recoveredDuplicateStart":true}',
    'ensureConversation',
    'getSessionStatus:session-race',
    'upsertFromSessionSummary:session-race',
    'subscribeConversationEvents:session-race',
    'startSpan.end:session-race',
  ]);
});

void test('runtime conversation starter rethrows non-duplicate pty.start failures', async () => {
  const starter = new RuntimeConversationStarter<
    ConversationRecord,
    { readonly sessionId: string }
  >({
    runWithStartInFlight: async (_sessionId, run) => {
      return await run();
    },
    conversationById: () => ({
      sessionId: 'session-fail',
      directoryId: 'directory-1',
      agentType: 'codex',
      adapterState: {},
      live: false,
      lastOutputCursor: 0,
      launchCommand: '',
    }),
    ensureConversation: () => ({
      sessionId: 'session-fail',
      directoryId: 'directory-1',
      agentType: 'codex',
      adapterState: {},
      live: false,
      lastOutputCursor: 0,
      launchCommand: '',
    }),
    normalizeThreadAgentType: (agentType) => agentType,
    codexArgs: ['--codex-default'],
    critiqueDefaultArgs: ['--critique-default'],
    sessionCwdForConversation: () => '/workspace',
    buildLaunchArgs: () => ['resume'],
    launchCommandForAgent: () => 'launch-codex',
    formatCommandForDebugBar: (command, args) => `${command} ${args.join(' ')}`,
    startConversationSpan: () => ({
      end: () => {},
    }),
    firstPaintTargetSessionId: () => null,
    endStartCommandSpan: () => {},
    layout: () => ({
      rightCols: 80,
      paneRows: 24,
    }),
    startPtySession: async () => {
      throw new Error('network timeout');
    },
    setPtySize: () => {},
    sendResize: () => {},
    sessionEnv: {},
    worktreeId: undefined,
    terminalForegroundHex: undefined,
    terminalBackgroundHex: undefined,
    recordStartCommand: () => {},
    getSessionStatus: async () => null,
    upsertFromSessionSummary: () => {},
    subscribeConversationEvents: async () => {},
  });

  await assert.rejects(() => starter.startConversation('session-fail'), /network timeout/);
});
