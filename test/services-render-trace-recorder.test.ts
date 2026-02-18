import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import { RenderTraceRecorder } from '../src/services/render-trace-recorder.ts';
import { RENDER_TRACE_MODE, RENDER_TRACE_STATE_VERSION } from '../src/mux/live-mux/render-trace-state.ts';

const LABELS = {
  repositoryId: 'repository-1',
  repositoryName: 'harness',
  projectId: 'directory-1',
  projectPath: '/tmp/harness',
  threadId: 'session-1',
  threadTitle: 'session title',
  agentType: 'terminal',
  conversationId: 'session-1',
} as const;

void test('render trace recorder records only while active and honors conversation filter', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-render-trace-recorder-a-'));
  const statePath = join(workspace, 'active-render-trace.json');
  const outputPath = join(workspace, 'render-trace.log');
  let nowMs = 1000;
  const recorder = new RenderTraceRecorder({
    statePath,
    nowMs: () => nowMs,
    nowIso: () => '2026-02-18T00:00:00.000Z',
    refreshIntervalMs: 1,
  });

  assert.equal(recorder.isActive(), false);
  assert.equal(recorder.shouldCaptureConversation('session-1'), false);

  writeFileSync(
    statePath,
    JSON.stringify(
      {
        version: RENDER_TRACE_STATE_VERSION,
        mode: RENDER_TRACE_MODE,
        outputPath,
        sessionName: null,
        conversationId: 'session-1',
        startedAt: '2026-02-18T00:00:00.000Z',
      },
      null,
      2,
    ),
    'utf8',
  );
  nowMs += 10;

  assert.equal(recorder.isActive(), true);
  assert.equal(recorder.shouldCaptureConversation('session-1'), true);
  assert.equal(recorder.shouldCaptureConversation('session-2'), false);

  recorder.record({
    direction: 'incoming',
    source: 'terminal-output',
    eventType: 'control-sequence-risk',
    labels: LABELS,
    payload: { count: 1 },
  });
  recorder.record({
    direction: 'incoming',
    source: 'terminal-output',
    eventType: 'control-sequence-risk',
    labels: {
      ...LABELS,
      conversationId: 'session-2',
      threadId: 'session-2',
    },
    payload: { count: 999 },
  });
  recorder.record({
    direction: 'incoming',
    source: 'terminal-output',
    eventType: 'control-sequence-risk',
    labels: LABELS,
    payload: { count: 1 },
    dedupeKey: 'issue',
    dedupeValue: 'issue-1',
  });
  recorder.record({
    direction: 'incoming',
    source: 'terminal-output',
    eventType: 'control-sequence-risk',
    labels: LABELS,
    payload: { count: 1 },
    dedupeKey: 'issue',
    dedupeValue: 'issue-1',
  });

  const lines = readFileSync(outputPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
  assert.equal(first['eventType'], 'control-sequence-risk');

  rmSync(statePath, { force: true });
  nowMs += 10;
  recorder.record({
    direction: 'outgoing',
    source: 'screen',
    eventType: 'ansi-integrity-failed',
    labels: LABELS,
    payload: { issues: ['row 1: dangling ESC'] },
  });
  assert.equal(readFileSync(outputPath, 'utf8').trim().split('\n').length, 2);

  recorder.close();
  rmSync(workspace, { recursive: true, force: true });
});

void test('render trace recorder ignores invalid states and supports default timestamps', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-render-trace-recorder-b-'));
  const statePath = join(workspace, 'active-render-trace.json');
  const outputPath = join(workspace, 'render-trace.log');
  let nowMs = 1000;
  writeFileSync(
    statePath,
    JSON.stringify({
      version: RENDER_TRACE_STATE_VERSION,
      mode: RENDER_TRACE_MODE,
      outputPath: '',
      sessionName: null,
      conversationId: null,
      startedAt: '2026-02-18T00:00:00.000Z',
    }),
    'utf8',
  );

  const recorder = new RenderTraceRecorder({
    statePath,
    nowMs: () => nowMs,
    refreshIntervalMs: 1,
  });
  recorder.record({
    direction: 'incoming',
    source: 'terminal-output',
    eventType: 'control-sequence-risk',
    labels: LABELS,
    payload: { count: 1 },
  });
  assert.equal(existsSync(outputPath), false);

  writeFileSync(
    statePath,
    JSON.stringify({
      version: RENDER_TRACE_STATE_VERSION,
      mode: RENDER_TRACE_MODE,
      outputPath,
      sessionName: null,
      conversationId: null,
      startedAt: '2026-02-18T00:00:00.000Z',
    }),
    'utf8',
  );
  nowMs += 10;
  recorder.record({
    direction: 'incoming',
    source: 'terminal-output',
    eventType: 'control-sequence-risk',
    labels: LABELS,
    payload: { count: 2 },
  });
  const record = JSON.parse(readFileSync(outputPath, 'utf8').trim()) as Record<string, unknown>;
  assert.equal(typeof record['ts'], 'string');

  recorder.close();
  rmSync(workspace, { recursive: true, force: true });
});
