import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import { StatusTimelineRecorder } from '../../../src/services/status-timeline-recorder.ts';
import {
  STATUS_TIMELINE_MODE,
  STATUS_TIMELINE_STATE_VERSION,
} from '../../../src/mux/live-mux/status-timeline-state.ts';

const LABELS = {
  repositoryId: 'repository-1',
  repositoryName: 'harness',
  projectId: 'directory-1',
  projectPath: '/tmp/harness',
  threadId: 'session-1',
  threadTitle: 'session title',
  agentType: 'codex',
  conversationId: 'session-1',
} as const;

void test('status timeline recorder writes records only while active state exists', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-status-timeline-recorder-a-'));
  const statePath = join(workspace, 'active-status-timeline.json');
  const outputPath = join(workspace, 'status-timeline.log');
  let nowMs = 1000;
  let nowIsoCounter = 0;
  const recorder = new StatusTimelineRecorder({
    statePath,
    nowMs: () => nowMs,
    nowIso: () => `2026-02-18T00:00:00.${String(nowIsoCounter++).padStart(3, '0')}Z`,
    refreshIntervalMs: 1,
  });

  recorder.record({
    direction: 'incoming',
    source: 'control-plane-key-events',
    eventType: 'session-status',
    labels: LABELS,
    payload: { before: 'none' },
  });
  assert.equal(existsSync(outputPath), false);

  writeFileSync(
    statePath,
    JSON.stringify(
      {
        version: STATUS_TIMELINE_STATE_VERSION,
        mode: STATUS_TIMELINE_MODE,
        outputPath,
        sessionName: null,
        startedAt: '2026-02-18T00:00:00.000Z',
      },
      null,
      2,
    ),
    'utf8',
  );
  nowMs += 10;

  recorder.record({
    direction: 'incoming',
    source: 'control-plane-key-events',
    eventType: 'session-status',
    labels: LABELS,
    payload: { status: 'running' },
  });
  const firstWritten = readFileSync(outputPath, 'utf8').trim().split('\n');
  assert.equal(firstWritten.length, 1);
  assert.equal(JSON.parse(firstWritten[0] ?? '{}')['eventType'], 'session-status');

  recorder.record({
    direction: 'outgoing',
    source: 'render-status-line',
    eventType: 'status-line',
    labels: LABELS,
    payload: { statusFooter: 'footer-1' },
    dedupeKey: 'status-line',
    dedupeValue: 'footer-1',
  });
  recorder.record({
    direction: 'outgoing',
    source: 'render-status-line',
    eventType: 'status-line',
    labels: LABELS,
    payload: { statusFooter: 'footer-1' },
    dedupeKey: 'status-line',
    dedupeValue: 'footer-1',
  });
  const dedupedWritten = readFileSync(outputPath, 'utf8').trim().split('\n');
  assert.equal(dedupedWritten.length, 2);

  rmSync(statePath, { force: true });
  nowMs += 10;
  recorder.record({
    direction: 'incoming',
    source: 'stream-envelope',
    eventType: 'pty.exit',
    labels: LABELS,
    payload: { exitCode: 0 },
  });
  const afterStopWritten = readFileSync(outputPath, 'utf8').trim().split('\n');
  assert.equal(afterStopWritten.length, 2);

  recorder.close();
  rmSync(workspace, { recursive: true, force: true });
});

void test('status timeline recorder ignores invalid state payloads', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-status-timeline-recorder-b-'));
  const statePath = join(workspace, 'active-status-timeline.json');
  const outputPath = join(workspace, 'status-timeline.log');
  writeFileSync(
    statePath,
    JSON.stringify({
      version: STATUS_TIMELINE_STATE_VERSION,
      mode: STATUS_TIMELINE_MODE,
      outputPath: '',
      sessionName: null,
      startedAt: '2026-02-18T00:00:00.000Z',
    }),
    'utf8',
  );

  const recorder = new StatusTimelineRecorder({
    statePath,
    nowMs: () => 1000,
    nowIso: () => '2026-02-18T00:00:00.000Z',
    refreshIntervalMs: 1,
  });
  recorder.record({
    direction: 'incoming',
    source: 'control-plane-key-events',
    eventType: 'session-status',
    labels: LABELS,
    payload: { status: 'running' },
  });
  assert.equal(existsSync(outputPath), false);

  recorder.close();
  rmSync(workspace, { recursive: true, force: true });
});

void test('status timeline recorder uses default wall-clock timestamp when nowIso is not provided', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-status-timeline-recorder-c-'));
  const statePath = join(workspace, 'active-status-timeline.json');
  const outputPath = join(workspace, 'status-timeline.log');
  writeFileSync(
    statePath,
    JSON.stringify({
      version: STATUS_TIMELINE_STATE_VERSION,
      mode: STATUS_TIMELINE_MODE,
      outputPath,
      sessionName: null,
      startedAt: '2026-02-18T00:00:00.000Z',
    }),
    'utf8',
  );
  const recorder = new StatusTimelineRecorder({
    statePath,
    refreshIntervalMs: 1,
  });
  recorder.record({
    direction: 'incoming',
    source: 'control-plane-key-events',
    eventType: 'session-status',
    labels: LABELS,
    payload: { status: 'running' },
  });
  const record = JSON.parse(readFileSync(outputPath, 'utf8').trim()) as Record<string, unknown>;
  assert.equal(typeof record['ts'], 'string');
  assert.equal(String(record['ts']).includes('T'), true);
  recorder.close();
  rmSync(workspace, { recursive: true, force: true });
});
