import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  DEFAULT_RENDER_TRACE_ROOT_PATH,
  parseActiveRenderTraceState,
  RENDER_TRACE_FILE_NAME,
  RENDER_TRACE_MODE,
  RENDER_TRACE_STATE_VERSION,
  resolveDefaultRenderTraceOutputPath,
  resolveRenderTraceStatePath,
} from '../src/mux/live-mux/render-trace-state.ts';

void test('render trace state path and output path resolution are stable', () => {
  assert.equal(
    resolveRenderTraceStatePath('/tmp/harness', null),
    '/tmp/harness/.harness/active-render-trace.json',
  );
  assert.equal(
    resolveRenderTraceStatePath('/tmp/harness', 'session-a'),
    '/tmp/harness/.harness/sessions/session-a/active-render-trace.json',
  );
  assert.equal(
    resolveDefaultRenderTraceOutputPath('/tmp/harness', null),
    `/tmp/harness/${DEFAULT_RENDER_TRACE_ROOT_PATH}/${RENDER_TRACE_FILE_NAME}`,
  );
  assert.equal(
    resolveDefaultRenderTraceOutputPath('/tmp/harness', 'session-a'),
    `/tmp/harness/${DEFAULT_RENDER_TRACE_ROOT_PATH}/session-a/${RENDER_TRACE_FILE_NAME}`,
  );
});

void test('render trace state parser accepts valid payloads and rejects invalid shapes', () => {
  const valid = parseActiveRenderTraceState({
    version: RENDER_TRACE_STATE_VERSION,
    mode: RENDER_TRACE_MODE,
    outputPath: '/tmp/harness/render-trace.log',
    sessionName: 'session-a',
    conversationId: 'session-123',
    startedAt: '2026-02-18T00:00:00.000Z',
  });
  assert.deepEqual(valid, {
    version: RENDER_TRACE_STATE_VERSION,
    mode: RENDER_TRACE_MODE,
    outputPath: '/tmp/harness/render-trace.log',
    sessionName: 'session-a',
    conversationId: 'session-123',
    startedAt: '2026-02-18T00:00:00.000Z',
  });

  const validWithoutFilter = parseActiveRenderTraceState({
    version: RENDER_TRACE_STATE_VERSION,
    mode: RENDER_TRACE_MODE,
    outputPath: '/tmp/harness/render-trace.log',
    sessionName: null,
    conversationId: null,
    startedAt: '2026-02-18T00:00:00.000Z',
  });
  assert.equal(validWithoutFilter?.conversationId, null);

  assert.equal(parseActiveRenderTraceState(null), null);
  assert.equal(parseActiveRenderTraceState('invalid'), null);
  assert.equal(
    parseActiveRenderTraceState({
      version: 0,
      mode: RENDER_TRACE_MODE,
      outputPath: '/tmp/harness/render-trace.log',
      sessionName: null,
      conversationId: null,
      startedAt: '2026-02-18T00:00:00.000Z',
    }),
    null,
  );
  assert.equal(
    parseActiveRenderTraceState({
      version: RENDER_TRACE_STATE_VERSION,
      mode: 'invalid',
      outputPath: '/tmp/harness/render-trace.log',
      sessionName: null,
      conversationId: null,
      startedAt: '2026-02-18T00:00:00.000Z',
    }),
    null,
  );
  assert.equal(
    parseActiveRenderTraceState({
      version: RENDER_TRACE_STATE_VERSION,
      mode: RENDER_TRACE_MODE,
      outputPath: '',
      sessionName: null,
      conversationId: null,
      startedAt: '2026-02-18T00:00:00.000Z',
    }),
    null,
  );
  assert.equal(
    parseActiveRenderTraceState({
      version: RENDER_TRACE_STATE_VERSION,
      mode: RENDER_TRACE_MODE,
      outputPath: '/tmp/harness/render-trace.log',
      sessionName: 1,
      conversationId: null,
      startedAt: '2026-02-18T00:00:00.000Z',
    }),
    null,
  );
  assert.equal(
    parseActiveRenderTraceState({
      version: RENDER_TRACE_STATE_VERSION,
      mode: RENDER_TRACE_MODE,
      outputPath: '/tmp/harness/render-trace.log',
      sessionName: null,
      conversationId: 1,
      startedAt: '2026-02-18T00:00:00.000Z',
    }),
    null,
  );
  assert.equal(
    parseActiveRenderTraceState({
      version: RENDER_TRACE_STATE_VERSION,
      mode: RENDER_TRACE_MODE,
      outputPath: '/tmp/harness/render-trace.log',
      sessionName: null,
      conversationId: null,
      startedAt: '',
    }),
    null,
  );
});
