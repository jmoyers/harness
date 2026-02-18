import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { BaseAgentStatusReducer } from '../src/control-plane/status/reducer-base.ts';
import { ClaudeStatusReducer } from '../src/control-plane/status/reducers/claude-status-reducer.ts';
import { CodexStatusReducer } from '../src/control-plane/status/reducers/codex-status-reducer.ts';
import { CritiqueStatusReducer } from '../src/control-plane/status/reducers/critique-status-reducer.ts';
import { CursorStatusReducer } from '../src/control-plane/status/reducers/cursor-status-reducer.ts';
import { TerminalStatusReducer } from '../src/control-plane/status/reducers/terminal-status-reducer.ts';
import { SessionStatusEngine } from '../src/control-plane/status/session-status-engine.ts';
import type { StreamSessionStatusModel } from '../src/control-plane/stream-protocol.ts';
import { statusModelFor } from './support/status-model.ts';

const OBSERVED_AT = '2026-02-18T00:00:00.000Z';

function expectStatusModel(value: StreamSessionStatusModel | null): StreamSessionStatusModel {
  if (value === null) {
    throw new Error('expected status model');
  }
  return value;
}

void test('session status engine projects codex/claude/cursor telemetry into status model', () => {
  const engine = new SessionStatusEngine();

  const codexActive = expectStatusModel(engine.project({
    agentType: 'codex',
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'codex.user_prompt',
      severity: null,
      summary: 'prompt submitted',
      observedAt: OBSERVED_AT,
    },
    observedAt: OBSERVED_AT,
    previous: null,
  }));
  assert.equal(codexActive.phase, 'working');
  assert.equal(codexActive.detailText, 'active');
  assert.equal(codexActive.glyph, '◆');

  const codexResponseCompleted = expectStatusModel(engine.project({
    agentType: 'codex',
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'codex.sse_event',
      severity: null,
      summary: 'stream response.completed',
      observedAt: '2026-02-18T00:00:01.000Z',
    },
    observedAt: '2026-02-18T00:00:01.000Z',
    previous: codexActive,
  }));
  assert.equal(codexResponseCompleted.phase, 'working');
  assert.equal(codexResponseCompleted.detailText, 'active');

  const claudeStopped = expectStatusModel(engine.project({
    agentType: 'claude',
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'claude.stop',
      severity: null,
      summary: null,
      observedAt: OBSERVED_AT,
    },
    observedAt: OBSERVED_AT,
    previous: null,
  }));
  assert.equal(claudeStopped.phase, 'idle');
  assert.equal(claudeStopped.detailText, 'inactive');

  const cursorWorking = expectStatusModel(engine.project({
    agentType: 'cursor',
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'cursor.beforesubmitprompt',
      severity: null,
      summary: null,
      observedAt: OBSERVED_AT,
    },
    observedAt: OBSERVED_AT,
    previous: null,
  }));
  assert.equal(cursorWorking.phase, 'working');
  assert.equal(cursorWorking.detailText, 'active');
});

void test('session status engine returns null for non-agent types', () => {
  const engine = new SessionStatusEngine();

  const unknownNeedsAction = engine.project({
    agentType: 'unknown-agent',
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'custom.event',
      severity: null,
      summary: 'attention required',
      observedAt: OBSERVED_AT,
    },
    observedAt: OBSERVED_AT,
    previous: null,
  });
  assert.equal(unknownNeedsAction, null);

  const genericIdle = engine.project({
    agentType: 'terminal',
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'custom.event',
      severity: null,
      summary: 'turn complete (100ms)',
      observedAt: '2026-02-18T00:00:01.000Z',
    },
    observedAt: '2026-02-18T00:00:01.000Z',
    previous: null,
  });
  assert.equal(genericIdle, null);

  const critiqueNoProjection = engine.project({
    agentType: 'critique',
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'custom.event',
      severity: null,
      summary: null,
      observedAt: OBSERVED_AT,
    },
    observedAt: OBSERVED_AT,
    previous: null,
  });
  assert.equal(critiqueNoProjection, null);
});

void test('session status engine handles runtime-only branches for agent reducers', () => {
  const engine = new SessionStatusEngine();

  const attentionRequired = expectStatusModel(engine.project({
    agentType: 'codex',
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'custom.event',
      severity: null,
      summary: 'attention required',
      observedAt: OBSERVED_AT,
    },
    observedAt: OBSERVED_AT,
    previous: null,
  }));
  assert.equal(attentionRequired.phase, 'needs-action');
  assert.equal(attentionRequired.detailText, 'attention required');

  const turnComplete = expectStatusModel(engine.project({
    agentType: 'codex',
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'custom.event',
      severity: null,
      summary: 'turn complete (100ms)',
      observedAt: '2026-02-18T00:00:01.000Z',
    },
    observedAt: '2026-02-18T00:00:01.000Z',
    previous: attentionRequired,
  }));
  assert.equal(turnComplete.phase, 'idle');
  assert.equal(turnComplete.lastKnownWork, 'turn complete (100ms)');

  const completed = expectStatusModel(engine.project({
    agentType: 'codex',
    runtimeStatus: 'completed',
    attentionReason: null,
    telemetry: null,
    observedAt: OBSERVED_AT,
    previous: null,
  }));
  assert.equal(completed.phase, 'idle');
  assert.equal(completed.detailText, 'inactive');
  assert.equal(completed.badge, 'DONE');

  const exited = expectStatusModel(engine.project({
    agentType: 'codex',
    runtimeStatus: 'exited',
    attentionReason: null,
    telemetry: null,
    observedAt: OBSERVED_AT,
    previous: null,
  }));
  assert.equal(exited.phase, 'exited');
  assert.equal(exited.detailText, 'exited');
  assert.equal(exited.badge, 'EXIT');

  const previousWorkingNoText = statusModelFor('running', {
    phase: 'working',
    detailText: 'active',
    lastKnownWork: null,
    lastKnownWorkAt: null,
    phaseHint: 'working',
    observedAt: '2026-02-18T00:00:02.000Z',
  });
  const defaultWorkingText = expectStatusModel(engine.project({
    agentType: 'codex',
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'custom.event',
      severity: null,
      summary: null,
      observedAt: '2026-02-18T00:00:01.500Z',
    },
    observedAt: '2026-02-18T00:00:03.000Z',
    previous: previousWorkingNoText,
  }));
  assert.equal(defaultWorkingText.phase, 'working');
  assert.equal(defaultWorkingText.detailText, 'active');
});

void test('agent reducers are directly constructible and project telemetry consistently', () => {
  const codex = expectStatusModel(new CodexStatusReducer().project({
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'codex.user_prompt',
      severity: null,
      summary: null,
      observedAt: OBSERVED_AT,
    },
    observedAt: OBSERVED_AT,
    previous: null,
  }));
  assert.equal(codex.phase, 'working');

  const claude = expectStatusModel(new ClaudeStatusReducer().project({
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'claude.pretooluse',
      severity: null,
      summary: null,
      observedAt: OBSERVED_AT,
    },
    observedAt: OBSERVED_AT,
    previous: null,
  }));
  assert.equal(claude.phase, 'working');

  const cursor = expectStatusModel(new CursorStatusReducer().project({
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'cursor.beforemcptool',
      severity: null,
      summary: null,
      observedAt: OBSERVED_AT,
    },
    observedAt: OBSERVED_AT,
    previous: null,
  }));
  assert.equal(cursor.phase, 'working');

  const terminal = new TerminalStatusReducer().project({
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'custom.event',
      severity: null,
      summary: null,
      observedAt: OBSERVED_AT,
    },
    observedAt: OBSERVED_AT,
    previous: null,
  });
  assert.equal(terminal, null);

  const critique = new CritiqueStatusReducer().project({
    runtimeStatus: 'running',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'custom.event',
      severity: null,
      summary: null,
      observedAt: OBSERVED_AT,
    },
    observedAt: OBSERVED_AT,
    previous: null,
  });
  assert.equal(critique, null);
});

void test('base reducer default projection covers idle and exited default detail text', () => {
  class DefaultProjectionReducer extends BaseAgentStatusReducer {
    readonly agentType = 'default-projection';

    constructor() {
      super();
    }
  }

  const reducer = new DefaultProjectionReducer();
  const previousWithoutHint = statusModelFor('running', {
    phase: 'starting',
    detailText: 'starting',
    lastKnownWork: null,
    lastKnownWorkAt: '2026-02-18T00:00:10.000Z',
    phaseHint: null,
    observedAt: '2026-02-18T00:00:10.000Z',
  });

  const completedIdleDefault = expectStatusModel(reducer.project({
    runtimeStatus: 'completed',
    attentionReason: null,
    telemetry: {
      source: 'otlp-log',
      eventName: 'custom.event',
      severity: null,
      summary: null,
      observedAt: '2026-02-18T00:00:11.000Z',
    },
    observedAt: '2026-02-18T00:00:09.000Z',
    previous: previousWithoutHint,
  }));
  assert.equal(completedIdleDefault.phase, 'idle');
  assert.equal(completedIdleDefault.detailText, 'inactive');

  const exitedDefault = expectStatusModel(reducer.project({
    runtimeStatus: 'exited',
    attentionReason: null,
    telemetry: null,
    observedAt: '2026-02-18T00:00:09.000Z',
    previous: previousWithoutHint,
  }));
  assert.equal(exitedDefault.phase, 'exited');
  assert.equal(exitedDefault.detailText, 'exited');
});
