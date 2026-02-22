import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  actionAtWorkspaceRailCell,
  buildWorkspaceRailViewRows as buildWorkspaceRailViewRowsRaw,
  projectWorkspaceRailConversation as projectWorkspaceRailConversationRaw,
} from '../../../src/mux/workspace-rail-model.ts';
import { statusModelFor } from '../../support/status-model.ts';

type StrictWorkspaceRailModel = Parameters<typeof buildWorkspaceRailViewRowsRaw>[0];
type StrictWorkspaceConversation = StrictWorkspaceRailModel['conversations'][number];
type FixtureWorkspaceConversation = Omit<StrictWorkspaceConversation, 'statusModel'> & {
  statusModel?: StrictWorkspaceConversation['statusModel'];
};
type FixtureWorkspaceRailModel = Omit<StrictWorkspaceRailModel, 'conversations'> & {
  conversations: readonly FixtureWorkspaceConversation[];
};

function normalizeConversationFixture(
  value: FixtureWorkspaceConversation,
): StrictWorkspaceConversation {
  if (value.statusModel !== undefined && value.statusModel !== null) {
    return value as StrictWorkspaceConversation;
  }
  const status = value.status ?? 'completed';
  const attentionReason = value.attentionReason;
  const lastKnownWork = value.lastKnownWork ?? null;
  const lastKnownWorkAt = value.lastKnownWorkAt ?? null;
  const detailLower = lastKnownWork?.toLowerCase() ?? '';
  const phase =
    status === 'needs-input'
      ? 'needs-action'
      : status === 'exited'
        ? 'exited'
        : detailLower.includes('needs input') ||
            detailLower.includes('needs-input') ||
            detailLower.includes('attention-required') ||
            detailLower.includes('attention required') ||
            detailLower.includes('approval denied')
          ? 'needs-action'
          : detailLower === 'active' ||
              detailLower === 'working' ||
              detailLower.startsWith('working:')
            ? 'working'
            : detailLower === 'inactive' ||
                detailLower.includes('turn complete') ||
                detailLower.includes('turn completed')
              ? 'idle'
              : status === 'running'
                ? 'starting'
                : 'idle';
  const modelOptions: NonNullable<Parameters<typeof statusModelFor>[1]> = {
    attentionReason,
    phase,
    lastKnownWork,
    lastKnownWorkAt,
    activityHint:
      phase === 'needs-action' || phase === 'working' || phase === 'idle' ? phase : null,
  };
  if (lastKnownWork !== null || attentionReason !== null) {
    modelOptions.detailText = (lastKnownWork ?? attentionReason) as string;
  }
  if (lastKnownWorkAt !== null) {
    modelOptions.observedAt = lastKnownWorkAt;
  } else if (value.lastEventAt !== null) {
    modelOptions.observedAt = value.lastEventAt;
  }
  return {
    ...value,
    statusModel: statusModelFor(status, modelOptions),
  };
}

function normalizeModelFixture(value: FixtureWorkspaceRailModel): StrictWorkspaceRailModel {
  const conversations = value.conversations.map((entry) => normalizeConversationFixture(entry));
  return {
    ...value,
    conversations,
  };
}

function buildWorkspaceRailViewRows(
  model: FixtureWorkspaceRailModel,
  rows: number,
): ReturnType<typeof buildWorkspaceRailViewRowsRaw> {
  return buildWorkspaceRailViewRowsRaw(normalizeModelFixture(model), rows);
}

function projectWorkspaceRailConversation(
  conversation: FixtureWorkspaceConversation,
  options?: Parameters<typeof projectWorkspaceRailConversationRaw>[1],
): ReturnType<typeof projectWorkspaceRailConversationRaw> {
  return projectWorkspaceRailConversationRaw(normalizeConversationFixture(conversation), options);
}

void test('workspace rail model keeps running sessions in starting when completion text is not canonical', () => {
  const projection = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-lagging-complete',
      directoryKey: 'dir',
      title: 'task',
      agentLabel: 'codex',
      cpuPercent: null,
      memoryMb: null,
      lastKnownWork: 'stream response.completed',
      lastKnownWorkAt: '2026-01-01T00:00:03.000Z',
      status: 'running',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: '2026-01-01T00:00:03.000Z',
      controller: null,
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:05.000Z'),
    },
  );
  assert.equal(projection.status, 'starting');
  assert.equal(projection.glyph, '◔');
});

void test('workspace rail model keeps explicit turn completion text even with newer running events', () => {
  const projection = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-stale-complete',
      directoryKey: 'dir',
      title: 'task',
      agentLabel: 'codex',
      cpuPercent: 0.3,
      memoryMb: 20,
      lastKnownWork: 'turn complete (812ms)',
      lastKnownWorkAt: '2026-01-01T00:00:03.000Z',
      status: 'running',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: '2026-01-01T00:00:08.000Z',
      controller: null,
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:09.000Z'),
    },
  );
  assert.equal(projection.status, 'idle');
  assert.equal(projection.glyph, '○');
  assert.equal(projection.detailText, 'turn complete (812ms)');
});

void test('workspace rail model keeps idle projection when last event does not advance past completion telemetry', () => {
  const projection = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-idle-equal-event',
      directoryKey: 'dir',
      title: 'task',
      agentLabel: 'codex',
      cpuPercent: 0.3,
      memoryMb: 20,
      lastKnownWork: 'turn complete (812ms)',
      lastKnownWorkAt: '2026-01-01T00:00:10.000Z',
      status: 'running',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: '2026-01-01T00:00:10.000Z',
      controller: null,
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:11.000Z'),
    },
  );
  assert.equal(projection.status, 'idle');
  assert.equal(projection.glyph, '○');
  assert.equal(projection.detailText, 'turn complete (812ms)');
});

void test('workspace rail model keeps status-line text consistent despite selected-thread output activity', () => {
  const nowMs = Date.parse('2026-01-01T00:00:10.500Z');
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
        },
      ],
      conversations: [
        {
          sessionId: 'conversation-selected-like',
          directoryKey: 'dir',
          title: 'selected-like',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: 'writing response…',
          lastKnownWorkAt: '2026-01-01T00:00:10.000Z',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:10.450Z',
        },
        {
          sessionId: 'conversation-unselected-like',
          directoryKey: 'dir',
          title: 'unselected-like',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: 'writing response…',
          lastKnownWorkAt: '2026-01-01T00:00:10.000Z',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:10.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-selected-like',
      nowMs,
    },
    24,
  );

  const selectedBody = rows.find(
    (row) =>
      row.kind === 'conversation-body' &&
      row.conversationSessionId === 'conversation-selected-like',
  );
  const unselectedBody = rows.find(
    (row) =>
      row.kind === 'conversation-body' &&
      row.conversationSessionId === 'conversation-unselected-like',
  );
  assert.notEqual(selectedBody, undefined);
  assert.notEqual(unselectedBody, undefined);
  assert.equal(selectedBody?.text.includes('writing response…'), true);
  assert.equal(unselectedBody?.text.includes('writing response…'), true);
});

void test('workspace rail model includes normalized status in fallback detail text when telemetry is missing', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
        },
      ],
      conversations: [
        {
          sessionId: 'conversation-no-telemetry',
          directoryKey: 'dir',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: 1.2,
          memoryMb: 33,
          lastKnownWork: null,
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-no-telemetry',
      nowMs: Date.parse('2026-01-01T00:00:30.000Z'),
    },
    24,
  );
  const bodyRow = rows.find(
    (row) =>
      row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-no-telemetry',
  );
  assert.notEqual(bodyRow, undefined);
  assert.equal(bodyRow?.text.includes('starting'), true);
});

void test('workspace rail model infers needs-action and keeps unknown running text as starting', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
        },
      ],
      conversations: [
        {
          sessionId: 'conversation-needs-action',
          directoryKey: 'dir',
          title: 'approval',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: 'needs-input: approval denied',
          lastKnownWorkAt: '2026-01-01T00:00:10.000Z',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:10.000Z',
        },
        {
          sessionId: 'conversation-working',
          directoryKey: 'dir',
          title: 'streaming',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: 'tool request in progress',
          lastKnownWorkAt: '2026-01-01T00:00:12.000Z',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:12.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
      nowMs: Date.parse('2026-01-01T00:00:13.000Z'),
    },
    26,
  );
  const needsActionRow = rows.find(
    (row) =>
      row.kind === 'conversation-title' &&
      row.conversationSessionId === 'conversation-needs-action',
  );
  const workingRow = rows.find(
    (row) =>
      row.kind === 'conversation-title' && row.conversationSessionId === 'conversation-working',
  );
  assert.notEqual(needsActionRow, undefined);
  assert.notEqual(workingRow, undefined);
  assert.equal(needsActionRow?.text.includes('▲ codex - approval'), true);
  assert.equal(workingRow?.text.includes('◔ codex - streaming'), true);
});

void test('workspace rail model infers needs-action from approval-denied summary without needs-input marker', () => {
  const projection = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-approval-only',
      directoryKey: 'dir',
      title: 'approval',
      agentLabel: 'codex',
      cpuPercent: null,
      memoryMb: null,
      lastKnownWork: 'approval denied by policy',
      lastKnownWorkAt: '2026-01-01T00:00:10.000Z',
      status: 'running',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: '2026-01-01T00:00:10.000Z',
      controller: null,
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:11.000Z'),
    },
  );
  assert.equal(projection.status, 'needs-action');
  assert.equal(projection.glyph, '▲');
});

void test('workspace rail conversation projection falls back to needs-input status line label', () => {
  const projection = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-needs-input-detail',
      directoryKey: 'dir',
      title: 'task',
      agentLabel: 'codex',
      cpuPercent: null,
      memoryMb: null,
      lastKnownWork: null,
      lastKnownWorkAt: null,
      status: 'needs-input',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: null,
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:30.000Z'),
    },
  );

  assert.equal(projection.status, 'needs-action');
  assert.equal(projection.detailText.includes('needs input'), true);
});

void test('workspace rail model covers status inference keyword variants', () => {
  const nowMs = Date.parse('2026-01-01T00:00:20.000Z');
  const project = (lastKnownWork: string): ReturnType<typeof projectWorkspaceRailConversation> =>
    projectWorkspaceRailConversation(
      {
        sessionId: `case-${lastKnownWork}`,
        directoryKey: 'dir',
        title: 'task',
        agentLabel: 'codex',
        cpuPercent: null,
        memoryMb: null,
        lastKnownWork,
        lastKnownWorkAt: '2026-01-01T00:00:19.000Z',
        status: 'running',
        attentionReason: null,
        startedAt: '2026-01-01T00:00:00.000Z',
        lastEventAt: '2026-01-01T00:00:19.000Z',
        controller: null,
      },
      { nowMs },
    );

  assert.equal(project('needs input from user').status, 'needs-action');
  assert.equal(project('attention-required: approval').status, 'needs-action');
  assert.equal(project('approval denied by policy').status, 'needs-action');
  assert.equal(project('conversation started').status, 'starting');
  assert.equal(project('response complete').status, 'starting');
  assert.equal(project('working: preparing changes').status, 'working');
  assert.equal(project('thinking through solution').status, 'starting');
  assert.equal(project('tool execute').status, 'starting');
  assert.equal(project('unrecognized status text').status, 'starting');
});

void test('workspace rail model treats missing lastEventAt as current for last-known-work text', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
        },
      ],
      conversations: [
        {
          sessionId: 'conversation-no-last-event',
          directoryKey: 'dir',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: null,
          memoryMb: null,
          lastKnownWork: 'turn complete (1200ms)',
          status: 'running',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: null,
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-no-last-event',
      nowMs: Date.parse('2026-01-01T00:00:10.000Z'),
    },
    24,
  );
  const titleRow = rows.find(
    (row) =>
      row.kind === 'conversation-title' &&
      row.conversationSessionId === 'conversation-no-last-event',
  );
  const bodyRow = rows.find(
    (row) =>
      row.kind === 'conversation-body' &&
      row.conversationSessionId === 'conversation-no-last-event',
  );
  assert.notEqual(titleRow, undefined);
  assert.notEqual(bodyRow, undefined);
  assert.equal(titleRow?.text.includes('○ codex - task'), true);
  assert.equal(bodyRow?.text.includes('turn complete (1200ms)'), true);
});

void test('workspace rail conversation projection exposes glyph and detail text', () => {
  const projected = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-1',
      directoryKey: 'dir',
      title: 'task',
      agentLabel: 'codex',
      cpuPercent: null,
      memoryMb: null,
      lastKnownWork: 'writing response…',
      lastKnownWorkAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: '2026-01-01T00:00:00.000Z',
      controller: null,
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:01.000Z'),
    },
  );
  assert.equal(projected.status, 'starting');
  assert.equal(projected.glyph, '◔');
  assert.equal(projected.detailText, 'writing response…');
});

void test('workspace rail conversation projection keeps detail text independent from controller metadata', () => {
  const projected = projectWorkspaceRailConversation(
    {
      sessionId: 'conversation-1',
      directoryKey: 'dir',
      title: 'task',
      agentLabel: 'codex',
      cpuPercent: null,
      memoryMb: null,
      lastKnownWork: null,
      lastKnownWorkAt: null,
      status: 'completed',
      attentionReason: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      lastEventAt: '2026-01-01T00:00:00.000Z',
      controller: {
        controllerId: 'agent-1',
        controllerType: 'agent',
        controllerLabel: 'Build Bot',
        claimedAt: '2026-01-01T00:00:00.000Z',
      },
    },
    {
      nowMs: Date.parse('2026-01-01T00:00:01.000Z'),
    },
  );
  assert.equal(projected.status, 'idle');
  assert.equal(projected.glyph, '○');
  assert.equal(projected.detailText, 'inactive');
});

void test('workspace rail conversation projection supports default option branches', () => {
  const projected = projectWorkspaceRailConversation({
    sessionId: 'conversation-default',
    directoryKey: 'dir',
    title: '',
    agentLabel: 'codex',
    cpuPercent: null,
    memoryMb: null,
    lastKnownWork: null,
    lastKnownWorkAt: null,
    status: 'running',
    attentionReason: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    lastEventAt: null,
    controller: {
      controllerId: 'human-local',
      controllerType: 'human',
      controllerLabel: 'Me',
      claimedAt: '2026-01-01T00:00:00.000Z',
    },
  });
  assert.equal(projected.status, 'starting');
  assert.equal(projected.glyph, '◔');
  assert.equal(projected.detailText, 'starting');
});

void test('workspace rail conversation projection falls back to attention reason when detail text is blank', () => {
  const projected = projectWorkspaceRailConversation({
    sessionId: 'conversation-attention-fallback',
    directoryKey: 'dir',
    title: 'task',
    agentLabel: 'codex',
    cpuPercent: null,
    memoryMb: null,
    status: 'needs-input',
    statusModel: {
      ...statusModelFor('needs-input', {
        attentionReason: null,
      }),
      detailText: '   ',
    },
    lastKnownWork: null,
    lastKnownWorkAt: null,
    attentionReason: 'manual approval',
    startedAt: '2026-01-01T00:00:00.000Z',
    lastEventAt: '2026-01-01T00:00:01.000Z',
  });
  assert.equal(projected.detailText, 'manual approval');
});

void test('workspace rail conversation projection falls back to status label when detail and attention are blank', () => {
  const projected = projectWorkspaceRailConversation({
    sessionId: 'conversation-status-label-fallback',
    directoryKey: 'dir',
    title: 'task',
    agentLabel: 'codex',
    cpuPercent: null,
    memoryMb: null,
    status: 'completed',
    statusModel: {
      ...statusModelFor('completed', {
        attentionReason: null,
      }),
      detailText: '   ',
    },
    lastKnownWork: null,
    lastKnownWorkAt: null,
    attentionReason: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    lastEventAt: '2026-01-01T00:00:01.000Z',
  });
  assert.equal(projected.detailText, 'inactive');
});

void test('workspace rail model renders fixed terminal and critique glyphs while suppressing status detail rows', () => {
  const rows = buildWorkspaceRailViewRows(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
        },
      ],
      conversations: [
        {
          sessionId: 'conversation-terminal',
          directoryKey: 'dir',
          title: 'shell',
          agentLabel: 'terminal',
          cpuPercent: 0,
          memoryMb: 0,
          status: 'running',
          statusModel: statusModelFor('running', {
            phase: 'working',
            detailText: 'active',
            activityHint: 'working',
          }),
          lastKnownWork: 'active',
          lastKnownWorkAt: '2026-01-01T00:00:01.000Z',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
        },
        {
          sessionId: 'conversation-critique',
          directoryKey: 'dir',
          title: 'review',
          agentLabel: 'critique',
          cpuPercent: 0,
          memoryMb: 0,
          status: 'running',
          statusModel: statusModelFor('running', {
            phase: 'working',
            detailText: 'active',
            activityHint: 'working',
          }),
          lastKnownWork: 'active',
          lastKnownWorkAt: '2026-01-01T00:00:01.000Z',
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: '2026-01-01T00:00:01.000Z',
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-terminal',
    },
    24,
  );

  const terminalTitle = rows.find(
    (row) =>
      row.kind === 'conversation-title' && row.conversationSessionId === 'conversation-terminal',
  );
  const critiqueTitle = rows.find(
    (row) =>
      row.kind === 'conversation-title' && row.conversationSessionId === 'conversation-critique',
  );
  assert.notEqual(terminalTitle, undefined);
  assert.notEqual(critiqueTitle, undefined);
  assert.equal(terminalTitle?.text.includes('⌨ terminal - shell'), true);
  assert.equal(critiqueTitle?.text.includes('✎ critique - review'), true);
  assert.equal(terminalTitle?.text.includes('◆ terminal - shell'), false);
  assert.equal(critiqueTitle?.text.includes('◆ critique - review'), false);

  assert.equal(
    rows.some(
      (row) =>
        row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-terminal',
    ),
    false,
  );
  assert.equal(
    rows.some(
      (row) =>
        row.kind === 'conversation-body' && row.conversationSessionId === 'conversation-critique',
    ),
    false,
  );
});

void test('workspace rail projection maps runtime status when status model is null', () => {
  const baseConversation: StrictWorkspaceConversation = {
    sessionId: 'conversation-1',
    directoryKey: 'dir',
    title: 'thread',
    agentLabel: 'codex',
    cpuPercent: null,
    memoryMb: null,
    attentionReason: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    lastEventAt: null,
    status: 'completed',
    statusModel: null,
  };

  assert.equal(
    projectWorkspaceRailConversationRaw({
      ...baseConversation,
      status: 'needs-input',
    }).status,
    'needs-action',
  );
  assert.equal(
    projectWorkspaceRailConversationRaw({
      ...baseConversation,
      status: 'running',
    }).status,
    'starting',
  );
  assert.equal(
    projectWorkspaceRailConversationRaw({
      ...baseConversation,
      status: 'exited',
    }).status,
    'exited',
  );
  assert.equal(
    projectWorkspaceRailConversationRaw({
      ...baseConversation,
      status: 'completed',
    }).status,
    'idle',
  );
  assert.equal(
    projectWorkspaceRailConversationRaw({
      ...baseConversation,
      status: 'running',
    }).statusVisible,
    false,
  );
});

void test('workspace rail model omits title glyph when non-terminal conversation has null status model', () => {
  const rows = buildWorkspaceRailViewRowsRaw(
    {
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: 'none',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
        },
      ],
      conversations: [
        {
          sessionId: 'conversation-null-status-model',
          directoryKey: 'dir',
          title: 'task',
          agentLabel: 'codex',
          cpuPercent: 0,
          memoryMb: 0,
          status: 'running',
          statusModel: null,
          lastKnownWork: null,
          lastKnownWorkAt: null,
          attentionReason: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          lastEventAt: null,
          controller: null,
        },
      ],
      processes: [],
      activeProjectId: null,
      activeConversationId: 'conversation-null-status-model',
    },
    20,
  );
  const titleRow = rows.find(
    (row) =>
      row.kind === 'conversation-title' &&
      row.conversationSessionId === 'conversation-null-status-model',
  );
  assert.notEqual(titleRow, undefined);
  assert.equal(titleRow?.text.includes('codex - task'), true);
  assert.equal(/[▲◔◆○■⌨✎]/u.test(titleRow?.text ?? ''), false);
});

void test('workspace rail model renders github project row and only expands summary when explicitly expanded', () => {
  const reviewByDirectory = new Map([
    [
      'dir',
      {
        status: 'ready' as const,
        branchName: 'feature/github-rail',
        branchSource: 'current' as const,
        pr: {
          number: 123,
          title: 'GitHub rail integration',
          url: 'https://github.com/acme/harness/pull/123',
          authorLogin: 'jmoyers',
          headBranch: 'feature/github-rail',
          baseBranch: 'main',
          state: 'open' as const,
          isDraft: false,
          mergedAt: null,
          closedAt: null,
          updatedAt: '2026-02-21T00:00:00.000Z',
          createdAt: '2026-02-20T00:00:00.000Z',
        },
        openThreads: [
          {
            threadId: 'thread-open',
            isResolved: false,
            isOutdated: false,
            resolvedByLogin: null,
            comments: [
              {
                commentId: 'comment-open',
                authorLogin: 'alice',
                body: 'looks good',
                url: null,
                createdAt: '2026-02-21T00:00:00.000Z',
                updatedAt: '2026-02-21T00:00:00.000Z',
              },
            ],
          },
        ],
        resolvedThreads: [],
        errorMessage: null,
      },
    ],
  ]);

  const collapsedRows = buildWorkspaceRailViewRowsRaw(
    {
      showGitHubIntegration: true,
      visibleGitHubDirectoryKeys: ['dir'],
      githubReviewByDirectoryKey: reviewByDirectory,
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: '/tmp/harness',
          repositoryId: 'repo-a',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
        },
      ],
      repositories: [
        {
          repositoryId: 'repo-a',
          name: 'harness',
          remoteUrl: 'https://github.com/acme/harness.git',
          associatedProjectCount: 1,
          commitCount: 100,
          lastCommitAt: '2026-02-21T00:00:00.000Z',
          shortCommitHash: 'abc1234',
        },
      ],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
    },
    24,
  );
  const collapsedGithubRow = collapsedRows.find(
    (row) => row.kind === 'github-header' && row.directoryKey === 'dir',
  );
  assert.notEqual(collapsedGithubRow, undefined);
  assert.equal(collapsedGithubRow?.railAction, 'project.github.open');
  assert.equal(collapsedGithubRow?.text.includes('▶ github pr (#123 open, unresolved 1)'), true);

  const selectedRows = buildWorkspaceRailViewRowsRaw(
    {
      showGitHubIntegration: true,
      visibleGitHubDirectoryKeys: ['dir'],
      githubReviewByDirectoryKey: reviewByDirectory,
      githubSelectionEnabled: true,
      activeGitHubProjectId: 'dir',
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: '/tmp/harness',
          repositoryId: 'repo-a',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
        },
      ],
      repositories: [
        {
          repositoryId: 'repo-a',
          name: 'harness',
          remoteUrl: 'https://github.com/acme/harness.git',
          associatedProjectCount: 1,
          commitCount: 100,
          lastCommitAt: '2026-02-21T00:00:00.000Z',
          shortCommitHash: 'abc1234',
        },
      ],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
    },
    24,
  );
  assert.equal(
    selectedRows.some(
      (row) =>
        row.kind === 'github-header' &&
        row.directoryKey === 'dir' &&
        row.active &&
        row.text.includes('▶ github pr (#123 open, unresolved 1)'),
    ),
    true,
  );
  assert.equal(
    selectedRows.some((row) => row.kind === 'github-detail' && row.directoryKey === 'dir'),
    false,
  );

  const expandedRows = buildWorkspaceRailViewRowsRaw(
    {
      showGitHubIntegration: true,
      visibleGitHubDirectoryKeys: ['dir'],
      expandedGitHubDirectoryKeys: ['dir'],
      githubReviewByDirectoryKey: reviewByDirectory,
      githubSelectionEnabled: true,
      activeGitHubProjectId: 'dir',
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: '/tmp/harness',
          repositoryId: 'repo-a',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
        },
      ],
      repositories: [
        {
          repositoryId: 'repo-a',
          name: 'harness',
          remoteUrl: 'https://github.com/acme/harness.git',
          associatedProjectCount: 1,
          commitCount: 100,
          lastCommitAt: '2026-02-21T00:00:00.000Z',
          shortCommitHash: 'abc1234',
        },
      ],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
    },
    24,
  );
  assert.equal(
    expandedRows.some(
      (row) =>
        row.kind === 'github-header' &&
        row.directoryKey === 'dir' &&
        row.active &&
        row.text.includes('▼ github pr (#123 open, unresolved 1)'),
    ),
    true,
  );
  assert.equal(
    expandedRows.some(
      (row) => row.kind === 'github-detail' && row.text.includes('pr #123 open GitHub rail'),
    ),
    true,
  );
});

void test('workspace rail model keeps github project row hidden until explicitly requested', () => {
  const rows = buildWorkspaceRailViewRowsRaw(
    {
      showGitHubIntegration: true,
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: '/tmp/harness',
          repositoryId: 'repo-a',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
        },
      ],
      repositories: [
        {
          repositoryId: 'repo-a',
          name: 'harness',
          remoteUrl: 'https://github.com/acme/harness.git',
          associatedProjectCount: 1,
          commitCount: 100,
          lastCommitAt: '2026-02-21T00:00:00.000Z',
          shortCommitHash: 'abc1234',
        },
      ],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
    },
    24,
  );
  assert.equal(
    rows.some((row) => row.kind === 'github-header' && row.directoryKey === 'dir'),
    false,
  );
});

void test('workspace rail model github row covers loading, error, missing review, and no-pr detail states', () => {
  const baseModel = {
    showGitHubIntegration: true,
    visibleGitHubDirectoryKeys: ['dir'],
    expandedGitHubDirectoryKeys: ['dir'],
    directories: [
      {
        key: 'dir',
        workspaceId: 'harness',
        worktreeId: '/tmp/harness',
        repositoryId: 'repo-a',
        git: {
          branch: 'main',
          additions: 0,
          deletions: 0,
          changedFiles: 0,
        },
      },
    ],
    repositories: [
      {
        repositoryId: 'repo-a',
        name: 'harness',
        remoteUrl: 'https://github.com/acme/harness.git',
        associatedProjectCount: 1,
        commitCount: 100,
        lastCommitAt: '2026-02-21T00:00:00.000Z',
        shortCommitHash: 'abc1234',
      },
    ],
    conversations: [],
    processes: [],
    activeProjectId: null,
    activeConversationId: null,
  } as const;

  const notLoaded = buildWorkspaceRailViewRowsRaw(baseModel, 24);
  assert.equal(
    notLoaded.some((row) => row.kind === 'github-detail' && row.text.includes('status not loaded')),
    true,
  );

  const loading = buildWorkspaceRailViewRowsRaw(
    {
      ...baseModel,
      githubReviewByDirectoryKey: new Map([
        [
          'dir',
          {
            status: 'loading' as const,
            branchName: 'feature/loading',
            branchSource: 'current' as const,
            pr: null,
            openThreads: [],
            resolvedThreads: [],
            errorMessage: null,
          },
        ],
      ]),
    },
    24,
  );
  assert.equal(
    loading.some(
      (row) => row.kind === 'github-detail' && row.text.includes('status loading GitHub review'),
    ),
    true,
  );

  const errored = buildWorkspaceRailViewRowsRaw(
    {
      ...baseModel,
      githubReviewByDirectoryKey: new Map([
        [
          'dir',
          {
            status: 'error' as const,
            branchName: null,
            branchSource: null,
            pr: null,
            openThreads: [],
            resolvedThreads: [],
            errorMessage: '  api   timeout ',
          },
        ],
      ]),
    },
    24,
  );
  assert.equal(
    errored.some(
      (row) => row.kind === 'github-detail' && row.text.includes('status error api timeout'),
    ),
    true,
  );

  const noPr = buildWorkspaceRailViewRowsRaw(
    {
      ...baseModel,
      githubReviewByDirectoryKey: new Map([
        [
          'dir',
          {
            status: 'ready' as const,
            branchName: 'feature/no-pr',
            branchSource: 'pinned' as const,
            pr: null,
            openThreads: [],
            resolvedThreads: [],
            errorMessage: null,
          },
        ],
      ]),
    },
    24,
  );
  assert.equal(
    noPr.some((row) => row.kind === 'github-detail' && row.text.includes('branch feature/no-pr')),
    true,
  );
  assert.equal(
    noPr.some(
      (row) =>
        row.kind === 'github-detail' && row.text.includes('no pull request for tracked branch'),
    ),
    true,
  );
});

void test('workspace rail model github summary labels draft, merged, and closed pull requests', () => {
  const buildRows = (state: 'open' | 'merged' | 'closed', isDraft: boolean) =>
    buildWorkspaceRailViewRowsRaw(
      {
        showGitHubIntegration: true,
        visibleGitHubDirectoryKeys: ['dir'],
        githubReviewByDirectoryKey: new Map([
          [
            'dir',
            {
              status: 'ready' as const,
              branchName: 'feature/state',
              branchSource: 'current' as const,
              pr: {
                number: 55,
                title: 'State PR',
                url: 'https://github.com/acme/harness/pull/55',
                authorLogin: 'jmoyers',
                headBranch: 'feature/state',
                baseBranch: 'main',
                state,
                isDraft,
                mergedAt: null,
                closedAt: null,
                updatedAt: '2026-02-21T00:00:00.000Z',
                createdAt: '2026-02-21T00:00:00.000Z',
              },
              openThreads: [],
              resolvedThreads: [],
              errorMessage: null,
            },
          ],
        ]),
        directories: [
          {
            key: 'dir',
            workspaceId: 'harness',
            worktreeId: '/tmp/harness',
            repositoryId: 'repo-a',
            git: {
              branch: 'main',
              additions: 0,
              deletions: 0,
              changedFiles: 0,
            },
          },
        ],
        repositories: [
          {
            repositoryId: 'repo-a',
            name: 'harness',
            remoteUrl: 'https://github.com/acme/harness.git',
            associatedProjectCount: 1,
            commitCount: 100,
            lastCommitAt: '2026-02-21T00:00:00.000Z',
            shortCommitHash: 'abc1234',
          },
        ],
        conversations: [],
        processes: [],
        activeProjectId: null,
        activeConversationId: null,
      },
      20,
    );

  const draft = buildRows('open', true);
  const merged = buildRows('merged', false);
  const closed = buildRows('closed', false);
  assert.equal(
    draft.some((row) => row.text.includes('(#55 draft, unresolved 0)')),
    true,
  );
  assert.equal(
    merged.some((row) => row.text.includes('(#55 merged, unresolved 0)')),
    true,
  );
  assert.equal(
    closed.some((row) => row.text.includes('(#55 closed, unresolved 0)')),
    true,
  );
});

void test('workspace rail model github summary includes ci failure when latest rollup failed', () => {
  const rows = buildWorkspaceRailViewRowsRaw(
    {
      showGitHubIntegration: true,
      visibleGitHubDirectoryKeys: ['dir'],
      githubReviewByDirectoryKey: new Map([
        [
          'dir',
          {
            status: 'ready' as const,
            branchName: 'feature/ci-failure',
            branchSource: 'current' as const,
            pr: {
              number: 77,
              title: 'CI failed PR',
              url: 'https://github.com/acme/harness/pull/77',
              authorLogin: 'jmoyers',
              headBranch: 'feature/ci-failure',
              baseBranch: 'main',
              state: 'open' as const,
              isDraft: false,
              mergedAt: null,
              closedAt: null,
              ciRollup: 'failure' as const,
              updatedAt: '2026-02-21T00:00:00.000Z',
              createdAt: '2026-02-21T00:00:00.000Z',
            },
            openThreads: [],
            resolvedThreads: [],
            errorMessage: null,
          },
        ],
      ]),
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: '/tmp/harness',
          repositoryId: 'repo-a',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
        },
      ],
      repositories: [
        {
          repositoryId: 'repo-a',
          name: 'harness',
          remoteUrl: 'https://github.com/acme/harness.git',
          associatedProjectCount: 1,
          commitCount: 100,
          lastCommitAt: '2026-02-21T00:00:00.000Z',
          shortCommitHash: 'abc1234',
        },
      ],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
    },
    20,
  );
  assert.equal(
    rows.some((row) => row.kind === 'github-header' && row.text.includes('ci failed')),
    true,
  );
});

void test('workspace rail model github header only toggles expansion from glyph hitbox', () => {
  const rows = buildWorkspaceRailViewRowsRaw(
    {
      showGitHubIntegration: true,
      visibleGitHubDirectoryKeys: ['dir'],
      githubReviewByDirectoryKey: new Map([
        [
          'dir',
          {
            status: 'ready' as const,
            branchName: 'feature/hitbox',
            branchSource: 'current' as const,
            pr: {
              number: 12,
              title: 'Hitbox PR',
              url: 'https://github.com/acme/harness/pull/12',
              authorLogin: 'jmoyers',
              headBranch: 'feature/hitbox',
              baseBranch: 'main',
              state: 'open' as const,
              isDraft: false,
              mergedAt: null,
              closedAt: null,
              updatedAt: '2026-02-21T00:00:00.000Z',
              createdAt: '2026-02-21T00:00:00.000Z',
            },
            openThreads: [],
            resolvedThreads: [],
            errorMessage: null,
          },
        ],
      ]),
      directories: [
        {
          key: 'dir',
          workspaceId: 'harness',
          worktreeId: '/tmp/harness',
          repositoryId: 'repo-a',
          git: {
            branch: 'main',
            additions: 0,
            deletions: 0,
            changedFiles: 0,
          },
        },
      ],
      repositories: [
        {
          repositoryId: 'repo-a',
          name: 'harness',
          remoteUrl: 'https://github.com/acme/harness.git',
          associatedProjectCount: 1,
          commitCount: 100,
          lastCommitAt: '2026-02-21T00:00:00.000Z',
          shortCommitHash: 'abc1234',
        },
      ],
      conversations: [],
      processes: [],
      activeProjectId: null,
      activeConversationId: null,
    },
    20,
  );
  const githubHeaderRowIndex = rows.findIndex(
    (row) => row.kind === 'github-header' && row.directoryKey === 'dir',
  );
  assert.notEqual(githubHeaderRowIndex, -1);
  const githubHeaderRow = rows[githubHeaderRowIndex]!;
  const glyphCol = githubHeaderRow.text.indexOf('▶');
  const labelCol = githubHeaderRow.text.indexOf('github pr');
  assert.notEqual(glyphCol, -1);
  assert.notEqual(labelCol, -1);
  assert.equal(
    actionAtWorkspaceRailCell(rows, githubHeaderRowIndex, glyphCol),
    'project.github.toggle',
  );
  assert.equal(
    actionAtWorkspaceRailCell(rows, githubHeaderRowIndex, labelCol),
    'project.github.open',
  );
});
