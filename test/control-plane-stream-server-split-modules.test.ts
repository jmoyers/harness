import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { test } from 'bun:test';
import {
  pollGitStatus,
  pollHistoryFile,
  pollHistoryFileUnsafe,
  refreshGitStatusForDirectory,
} from '../src/control-plane/stream-server-background.ts';
import { eventIncludesRepositoryId } from '../src/control-plane/stream-server-observed-filter.ts';
import {
  applySessionKeyEvent,
  handleSessionEvent,
  notifyKeyEventFromPayload,
  unmappedNotifyKeyEventFromPayload,
} from '../src/control-plane/stream-server-session-runtime.ts';
import type {
  ControlPlaneDirectoryRecord,
  ControlPlaneRepositoryRecord,
} from '../src/store/control-plane-store.ts';
import { statusModelFor } from './support/status-model.ts';

const FIXED_TS = '2026-02-17T00:00:00.000Z';

function makeRepositoryRecord(repositoryId: string): ControlPlaneRepositoryRecord {
  return {
    repositoryId,
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    name: repositoryId,
    remoteUrl: `https://github.com/example/${repositoryId}`,
    defaultBranch: 'main',
    metadata: {},
    createdAt: FIXED_TS,
    archivedAt: null,
  };
}

function makeDirectoryRecord(directoryId: string): ControlPlaneDirectoryRecord {
  return {
    directoryId,
    tenantId: 'tenant-local',
    userId: 'user-local',
    workspaceId: 'workspace-local',
    path: '/tmp',
    createdAt: FIXED_TS,
    archivedAt: null,
  };
}

function createBackgroundContext(): Parameters<typeof pollHistoryFile>[0] {
  const repositories = new Map<string, ControlPlaneRepositoryRecord>();
  return {
    historyNextAllowedPollAtMs: 0,
    historyPollInFlight: false,
    historyIdleStreak: 0,
    historyOffset: 0,
    historyRemainder: '',
    codexHistory: {
      enabled: true,
      filePath: '~/missing-history.jsonl',
      pollMs: 50,
    },
    sessions: new Map(),
    stateStore: {
      findConversationIdByCodexThreadId: () => null,
      upsertRepository: (input) => {
        const record: ControlPlaneRepositoryRecord = {
          repositoryId: input.repositoryId,
          tenantId: input.tenantId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          name: input.name,
          remoteUrl: input.remoteUrl,
          defaultBranch: input.defaultBranch ?? 'main',
          metadata: input.metadata ?? {},
          createdAt: FIXED_TS,
          archivedAt: null,
        };
        repositories.set(record.repositoryId, record);
        return record;
      },
      getRepository: (repositoryId) => repositories.get(repositoryId) ?? null,
    },
    ingestParsedTelemetryEvent: () => {},
    resolveSessionIdByThreadId: () => null,
    gitStatusPollInFlight: false,
    gitStatusDirectoriesById: new Map(),
    gitStatusByDirectoryId: new Map(),
    gitStatusRefreshInFlightDirectoryIds: new Set(),
    gitStatusMonitor: {
      maxConcurrency: 1,
      minDirectoryRefreshMs: 0,
    },
    readGitDirectorySnapshot: async () => ({
      summary: {
        branch: 'main',
        changedFiles: 0,
        additions: 0,
        deletions: 0,
      },
      repository: {
        normalizedRemoteUrl: null,
        commitCount: null,
        lastCommitAt: null,
        shortCommitHash: null,
        inferredName: null,
        defaultBranch: null,
      },
    }),
    repositoryRecord: (repository) => ({
      repositoryId: repository.repositoryId,
    }),
    publishObservedEvent: () => {},
  };
}

void test('split module coverage: background history polling defensive branches are exercised', async () => {
  const guardCtx = createBackgroundContext();
  guardCtx.historyPollInFlight = true;
  await pollHistoryFile(guardCtx);
  assert.equal(guardCtx.historyPollInFlight, true);

  const catchCtx = createBackgroundContext();
  catchCtx.pollHistoryFileUnsafe = async () => {
    throw new Error('poll failure');
  };
  await pollHistoryFile(catchCtx);
  assert.equal(catchCtx.historyIdleStreak, 1);
  assert.equal(catchCtx.historyPollInFlight, false);
  assert.equal(catchCtx.historyNextAllowedPollAtMs > Date.now(), true);

  const closedDbCtx = createBackgroundContext();
  closedDbCtx.pollHistoryFileUnsafe = async () => {
    throw new Error('Cannot use a closed database');
  };
  await assert.rejects(() => pollHistoryFile(closedDbCtx), /closed database/i);
  assert.equal(closedDbCtx.historyPollInFlight, false);

  const missingCtx = createBackgroundContext();
  let openedPath = '';
  missingCtx.codexHistory.filePath = '~/does-not-exist-history-file.jsonl';
  missingCtx.openHistoryFile = async (path) => {
    openedPath = path;
    const error = new Error('missing') as Error & { code?: string };
    error.code = 'ENOENT';
    throw error;
  };
  assert.equal(await pollHistoryFileUnsafe(missingCtx), false);
  assert.equal(openedPath.startsWith(homedir()), true);

  const tildeCtx = createBackgroundContext();
  let openedHomePath = '';
  tildeCtx.codexHistory.filePath = '~';
  tildeCtx.openHistoryFile = async (path) => {
    openedHomePath = path;
    const error = new Error('missing') as Error & { code?: string };
    error.code = 'ENOENT';
    throw error;
  };
  assert.equal(await pollHistoryFileUnsafe(tildeCtx), false);
  assert.equal(openedHomePath, homedir());

  const nonEnoentCtx = createBackgroundContext();
  nonEnoentCtx.openHistoryFile = async () => {
    const error = new Error('access denied') as Error & { code?: string };
    error.code = 'EACCES';
    throw error;
  };
  await assert.rejects(() => pollHistoryFileUnsafe(nonEnoentCtx), /access denied/);

  let closedNonFinite = false;
  const nonFiniteCtx = createBackgroundContext();
  nonFiniteCtx.openHistoryFile = async () => ({
    stat: async () => ({ size: Number.NaN }),
    read: async () => ({ bytesRead: 0 }),
    close: async () => {
      closedNonFinite = true;
    },
  });
  assert.equal(await pollHistoryFileUnsafe(nonFiniteCtx), false);
  assert.equal(closedNonFinite, true);

  const noRemainingCtx = createBackgroundContext();
  noRemainingCtx.historyOffset = 0;
  noRemainingCtx.openHistoryFile = async () => ({
    stat: async () => ({ size: 0 }),
    read: async () => ({ bytesRead: 0 }),
    close: async () => {},
  });
  assert.equal(await pollHistoryFileUnsafe(noRemainingCtx), false);

  const zeroReadCtx = createBackgroundContext();
  zeroReadCtx.openHistoryFile = async () => ({
    stat: async () => ({ size: 4 }),
    read: async () => ({ bytesRead: 0 }),
    close: async () => {},
  });
  assert.equal(await pollHistoryFileUnsafe(zeroReadCtx), false);
});

void test('split module coverage: background git polling in-flight and error branches are exercised', async () => {
  const inFlightCtx = createBackgroundContext();
  const directory = makeDirectoryRecord('directory-git');
  inFlightCtx.gitStatusPollInFlight = true;
  inFlightCtx.gitStatusDirectoriesById.set(directory.directoryId, directory);
  await pollGitStatus(inFlightCtx);
  assert.equal(inFlightCtx.gitStatusPollInFlight, true);

  const earlyReturnCtx = createBackgroundContext();
  earlyReturnCtx.gitStatusRefreshInFlightDirectoryIds.add(directory.directoryId);
  await refreshGitStatusForDirectory(earlyReturnCtx, directory);
  assert.equal(
    earlyReturnCtx.gitStatusRefreshInFlightDirectoryIds.has(directory.directoryId),
    true,
  );

  const failingCtx: Parameters<typeof refreshGitStatusForDirectory>[0] = {
    ...createBackgroundContext(),
    readGitDirectorySnapshot: async () => {
      throw new Error('git failure');
    },
  };
  failingCtx.gitStatusByDirectoryId.set(directory.directoryId, {
    summary: {
      branch: 'main',
      changedFiles: 1,
      additions: 2,
      deletions: 3,
    },
    repositorySnapshot: {
      normalizedRemoteUrl: null,
      commitCount: null,
      lastCommitAt: null,
      shortCommitHash: null,
      inferredName: null,
      defaultBranch: null,
    },
    repositoryId: null,
    lastRefreshedAtMs: 1,
    lastRefreshDurationMs: 1,
  });
  await refreshGitStatusForDirectory(failingCtx, directory);
  const refreshed = failingCtx.gitStatusByDirectoryId.get(directory.directoryId);
  assert.notEqual(refreshed, undefined);
  assert.equal((refreshed?.lastRefreshedAtMs ?? 0) >= 1, true);
  assert.equal(failingCtx.gitStatusRefreshInFlightDirectoryIds.has(directory.directoryId), false);

  const closedDbGitCtx: Parameters<typeof refreshGitStatusForDirectory>[0] = {
    ...createBackgroundContext(),
    readGitDirectorySnapshot: async () => {
      throw new Error('Database has closed');
    },
  };
  await assert.rejects(
    () => refreshGitStatusForDirectory(closedDbGitCtx, directory),
    /database has closed/i,
  );
  assert.equal(
    closedDbGitCtx.gitStatusRefreshInFlightDirectoryIds.has(directory.directoryId),
    false,
  );
});

void test('split module coverage: observed filter repository checks include directory-git-updated events', () => {
  const includes = eventIncludesRepositoryId(
    {
      type: 'directory-git-updated',
      directoryId: 'directory-1',
      summary: {
        branch: 'main',
        changedFiles: 0,
        additions: 0,
        deletions: 0,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: null,
        commitCount: null,
        lastCommitAt: null,
        shortCommitHash: null,
        inferredName: null,
        defaultBranch: null,
      },
      repositoryId: 'repository-1',
      repository: null,
      observedAt: FIXED_TS,
    },
    'repository-1',
  );
  assert.equal(includes, true);

  assert.equal(
    eventIncludesRepositoryId(
      {
        type: 'github-pr-upserted',
        pr: {
          repositoryId: 'repository-1',
        },
      },
      'repository-1',
    ),
    true,
  );
  assert.equal(
    eventIncludesRepositoryId(
      {
        type: 'github-pr-closed',
        prRecordId: 'pr-1',
        repositoryId: 'repository-2',
        ts: FIXED_TS,
      },
      'repository-1',
    ),
    false,
  );
  assert.equal(
    eventIncludesRepositoryId(
      {
        type: 'github-pr-jobs-updated',
        prRecordId: 'pr-1',
        repositoryId: 'repository-3',
        ciRollup: 'pending',
        jobs: [],
        ts: FIXED_TS,
      },
      'repository-3',
    ),
    true,
  );
});

void test('split module coverage: session runtime notify mapping covers fallback branches', () => {
  assert.equal(notifyKeyEventFromPayload('terminal', {}, FIXED_TS), null);
  assert.equal(notifyKeyEventFromPayload('claude', {}, FIXED_TS), null);
  assert.equal(notifyKeyEventFromPayload('claude', { hook_event_name: '!!!' }, FIXED_TS), null);
  assert.equal(notifyKeyEventFromPayload('cursor', {}, FIXED_TS), null);
  assert.equal(notifyKeyEventFromPayload('cursor', { event: '!!!' }, FIXED_TS), null);

  const running = notifyKeyEventFromPayload(
    'claude',
    {
      hook_event_name: 'notification',
      notification_type: 'approval approved',
    },
    FIXED_TS,
  );
  assert.equal(running?.statusHint, 'running');

  const unknownNotification = notifyKeyEventFromPayload(
    'claude',
    {
      hook_event_name: 'notification',
      notification_type: 'unknown-state',
    },
    FIXED_TS,
  );
  assert.equal(unknownNotification?.statusHint, null);
  assert.equal(unknownNotification?.summary, 'unknown-state');

  const interruptedNotification = notifyKeyEventFromPayload(
    'claude',
    {
      hook_event_name: 'notification',
      notification_type: 'user_interrupted',
    },
    FIXED_TS,
  );
  assert.equal(interruptedNotification?.statusHint, 'completed');
  assert.equal(interruptedNotification?.summary, 'user_interrupted');

  const blankNotification = notifyKeyEventFromPayload(
    'claude',
    {
      hook_event_name: 'notification',
      notification_type: '   ',
    },
    FIXED_TS,
  );
  assert.equal(blankNotification?.statusHint, null);
  assert.equal(blankNotification?.summary, 'notification');

  const fallback = notifyKeyEventFromPayload(
    'claude',
    {
      hook_event_name: 'custom_hook',
    },
    FIXED_TS,
  );
  assert.equal(fallback?.summary, null);

  const cursorRunning = notifyKeyEventFromPayload(
    'cursor',
    {
      event: 'beforeSubmitPrompt',
    },
    FIXED_TS,
  );
  assert.equal(cursorRunning?.eventName, 'cursor.beforesubmitprompt');
  assert.equal(cursorRunning?.statusHint, 'running');

  const cursorCompletedFromStop = notifyKeyEventFromPayload(
    'cursor',
    {
      event: 'stop',
      final_status: 'aborted',
    },
    FIXED_TS,
  );
  assert.equal(cursorCompletedFromStop?.statusHint, 'completed');
  assert.equal(cursorCompletedFromStop?.summary, 'turn complete (aborted)');

  const cursorBeforeTool = notifyKeyEventFromPayload(
    'cursor',
    {
      event: 'beforeShellExecution',
    },
    FIXED_TS,
  );
  assert.equal(cursorBeforeTool?.statusHint, 'running');
  assert.equal(cursorBeforeTool?.summary, 'tool started (hook)');

  const cursorAfterTool = notifyKeyEventFromPayload(
    'cursor',
    {
      event: 'afterMCPExecution',
    },
    FIXED_TS,
  );
  assert.equal(cursorAfterTool?.statusHint, null);
  assert.equal(cursorAfterTool?.summary, 'tool finished (hook)');

  const cursorFallbackSummary = notifyKeyEventFromPayload(
    'cursor',
    {
      event: 'custom_cursor_event',
    },
    FIXED_TS,
  );
  assert.equal(cursorFallbackSummary?.summary, null);

  const codexCompletedNotify = notifyKeyEventFromPayload(
    'codex',
    {
      type: 'agent-turn-complete',
    },
    FIXED_TS,
  );
  assert.equal(codexCompletedNotify?.statusHint, 'completed');
  assert.equal(codexCompletedNotify?.summary, 'turn complete (notify)');

  const codexInterruptedNotify = notifyKeyEventFromPayload(
    'codex',
    {
      type: 'turn_aborted',
      reason: 'interrupted',
    },
    FIXED_TS,
  );
  assert.equal(codexInterruptedNotify?.statusHint, 'completed');
  assert.equal(codexInterruptedNotify?.summary, 'turn complete (turn_aborted)');

  assert.equal(
    notifyKeyEventFromPayload(
      'codex',
      {
        type: 'agent-turn-progress',
      },
      FIXED_TS,
    ),
    null,
  );
});

void test('split module coverage: session runtime emits prompt events from notify payloads', () => {
  const promptEvents: Array<{
    providerEventName: string | null;
    text: string | null;
    captureSource: string;
    confidence: string;
  }> = [];
  const state = {
    id: 'session-prompt',
    directoryId: 'directory-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    agentType: 'claude',
    adapterState: {},
    eventSubscriberConnectionIds: new Set<string>(),
    status: 'running' as const,
    statusModel: statusModelFor('running'),
    attentionReason: null,
    lastEventAt: null,
    lastExit: null,
    exitedAt: null,
    latestTelemetry: null,
    session: {
      write: () => {},
      resize: () => {},
      processId: () => 123,
    },
  };
  const ctx: Parameters<typeof handleSessionEvent>[0] = {
    sessions: new Map([[state.id, state]]),
    connectionCanMutateSession: () => true,
    destroySession: () => {},
    deactivateSession: () => {},
    sendToConnection: () => {},
    sessionScope: (session) => ({
      tenantId: session.tenantId,
      userId: session.userId,
      workspaceId: session.workspaceId,
      directoryId: session.directoryId,
      conversationId: session.id,
    }),
    publishObservedEvent: () => {},
    publishSessionKeyObservedEvent: () => {},
    publishSessionPromptObservedEvent: (_session, prompt) => {
      promptEvents.push({
        providerEventName: prompt.providerEventName,
        text: prompt.text,
        captureSource: prompt.captureSource,
        confidence: prompt.confidence,
      });
    },
    refreshSessionStatusModel: () => {},
    toPublicSessionController: (controller) => controller,
    stateStore: {
      updateConversationAdapterState: () => {},
      updateConversationRuntime: () => {},
    },
  };

  handleSessionEvent(ctx, state.id, {
    type: 'notify',
    record: {
      ts: FIXED_TS,
      payload: {
        hook_event_name: 'UserPromptSubmit',
        prompt: 'capture this prompt',
      },
    },
  });

  handleSessionEvent(ctx, state.id, {
    type: 'notify',
    record: {
      ts: FIXED_TS,
      payload: {
        hook_event_name: 'PreToolUse',
      },
    },
  });

  assert.equal(promptEvents.length, 1);
  assert.deepEqual(promptEvents[0], {
    providerEventName: 'claude.userpromptsubmit',
    text: 'capture this prompt',
    captureSource: 'hook-notify',
    confidence: 'high',
  });
});

void test('split module coverage: unmapped notify payload emits explicit key event record', () => {
  const unmappedCursor = unmappedNotifyKeyEventFromPayload(
    'cursor',
    {
      someField: 'value',
      another: true,
    },
    FIXED_TS,
  );
  assert.equal(unmappedCursor.eventName, 'cursor.notify.unmapped');
  assert.equal(unmappedCursor.statusHint, null);
  assert.equal(unmappedCursor.summary, 'notify payload unmapped keys=someField,another');

  const unmappedUnknown = unmappedNotifyKeyEventFromPayload(
    'unknown',
    {
      foo: 'bar',
    },
    FIXED_TS,
  );
  assert.equal(unmappedUnknown.eventName, 'agent.notify.unmapped');

  const unmappedNoKeys = unmappedNotifyKeyEventFromPayload('codex', {}, FIXED_TS);
  assert.equal(unmappedNoKeys.summary, 'notify payload unmapped (no keys)');
});

void test('split module coverage: session runtime handles notify key events without status hints', () => {
  const runtimeWrites: Array<Record<string, unknown>> = [];
  const state = {
    id: 'session-1',
    directoryId: 'directory-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    agentType: 'claude',
    adapterState: {},
    eventSubscriberConnectionIds: new Set<string>(),
    status: 'running' as const,
    statusModel: statusModelFor('running'),
    attentionReason: null,
    lastEventAt: null,
    lastExit: null,
    exitedAt: null,
    latestTelemetry: null,
    session: {
      write: () => {},
      resize: () => {},
      processId: () => 123,
    },
  };
  const ctx: Parameters<typeof handleSessionEvent>[0] = {
    sessions: new Map([[state.id, state]]),
    connectionCanMutateSession: () => true,
    destroySession: () => {},
    deactivateSession: () => {},
    sendToConnection: () => {},
    sessionScope: (session) => ({
      tenantId: session.tenantId,
      userId: session.userId,
      workspaceId: session.workspaceId,
      directoryId: session.directoryId,
      conversationId: session.id,
    }),
    publishObservedEvent: () => {},
    publishSessionKeyObservedEvent: () => {},
    publishSessionPromptObservedEvent: () => {},
    refreshSessionStatusModel: () => {},
    toPublicSessionController: (controller) => controller,
    stateStore: {
      updateConversationAdapterState: () => {},
      updateConversationRuntime: (_conversationId, input) => {
        runtimeWrites.push({
          status: input.status,
          attentionReason: input.attentionReason,
          lastEventAt: input.lastEventAt,
        });
      },
    },
  };

  handleSessionEvent(ctx, state.id, {
    type: 'notify',
    record: {
      ts: FIXED_TS,
      payload: {
        hook_event_name: 'custom_event',
      },
    },
  });

  assert.equal(runtimeWrites.length > 0, true);
  assert.deepEqual(runtimeWrites[runtimeWrites.length - 1], {
    status: 'running',
    attentionReason: null,
    lastEventAt: FIXED_TS,
  });
});

void test('split module coverage: applySessionKeyEvent centralizes status hint handling', () => {
  const runtimeWrites: Array<Record<string, unknown>> = [];
  const observedKeyEvents: Array<Record<string, unknown>> = [];
  const state = {
    id: 'session-centralized',
    directoryId: 'directory-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    agentType: 'cursor',
    adapterState: {},
    eventSubscriberConnectionIds: new Set<string>(),
    status: 'running' as const,
    statusModel: statusModelFor('running'),
    attentionReason: null,
    lastEventAt: null,
    lastExit: null,
    exitedAt: null,
    latestTelemetry: null,
    session: {
      write: () => {},
      resize: () => {},
      processId: () => 123,
    },
  };
  const ctx: Parameters<typeof applySessionKeyEvent>[0] = {
    sessions: new Map([[state.id, state]]),
    connectionCanMutateSession: () => true,
    destroySession: () => {},
    deactivateSession: () => {},
    sendToConnection: () => {},
    sessionScope: (session) => ({
      tenantId: session.tenantId,
      userId: session.userId,
      workspaceId: session.workspaceId,
      directoryId: session.directoryId,
      conversationId: session.id,
    }),
    publishObservedEvent: () => {},
    publishSessionKeyObservedEvent: (_session, keyEvent) => {
      observedKeyEvents.push({
        eventName: keyEvent.eventName,
        statusHint: keyEvent.statusHint,
      });
    },
    publishSessionPromptObservedEvent: () => {},
    refreshSessionStatusModel: () => {},
    toPublicSessionController: (controller) => controller,
    stateStore: {
      updateConversationAdapterState: () => {},
      updateConversationRuntime: (_conversationId, input) => {
        runtimeWrites.push({
          status: input.status,
          attentionReason: input.attentionReason,
          lastEventAt: input.lastEventAt,
        });
      },
    },
  };

  applySessionKeyEvent(
    ctx,
    state,
    {
      source: 'otlp-log',
      eventName: 'cursor.beforesubmitprompt',
      severity: null,
      summary: 'prompt submitted',
      observedAt: FIXED_TS,
      statusHint: 'running',
    },
    {
      applyStatusHint: true,
    },
  );
  applySessionKeyEvent(
    ctx,
    state,
    {
      source: 'otlp-log',
      eventName: 'cursor.notification',
      severity: null,
      summary: 'ignored hint',
      observedAt: '2026-02-17T00:00:01.000Z',
      statusHint: null,
    },
    {
      applyStatusHint: false,
    },
  );

  assert.equal(observedKeyEvents.length, 2);
  assert.deepEqual(runtimeWrites[0], {
    status: 'running',
    attentionReason: null,
    lastEventAt: FIXED_TS,
  });
  assert.deepEqual(runtimeWrites[1], {
    status: 'running',
    attentionReason: null,
    lastEventAt: '2026-02-17T00:00:01.000Z',
  });
});

void test('split module coverage: control-plane store types module is runtime importable', async () => {
  const moduleValue = await import('../src/store/control-plane-store-types.ts');
  assert.equal(typeof moduleValue, 'object');
  assert.notEqual(makeRepositoryRecord('repository-coverage').repositoryId.length, 0);
});
