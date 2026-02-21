import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { SessionPromptEngine } from '../../../src/control-plane/prompt/session-prompt-engine.ts';

void test('prompt engine extracts claude UserPromptSubmit prompt payload', () => {
  const engine = new SessionPromptEngine();
  const prompt = engine.extractFromNotify({
    agentType: 'claude',
    observedAt: '2026-02-19T12:00:00.000Z',
    payload: {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Refactor the parser and add tests',
    },
  });
  assert.notEqual(prompt, null);
  assert.equal(prompt?.text, 'Refactor the parser and add tests');
  assert.equal(prompt?.captureSource, 'hook-notify');
  assert.equal(prompt?.providerEventName, 'claude.userpromptsubmit');
  assert.equal(prompt?.confidence, 'high');
});

void test('prompt engine extracts cursor beforeSubmitPrompt and supports null text', () => {
  const engine = new SessionPromptEngine();
  const withText = engine.extractFromNotify({
    agentType: 'cursor',
    observedAt: '2026-02-19T12:00:00.000Z',
    payload: {
      event: 'beforeSubmitPrompt',
      prompt: 'Write integration coverage for retries',
    },
  });
  assert.notEqual(withText, null);
  assert.equal(withText?.text, 'Write integration coverage for retries');
  assert.equal(withText?.providerEventName, 'cursor.beforesubmitprompt');

  const withoutText = engine.extractFromNotify({
    agentType: 'cursor',
    observedAt: '2026-02-19T12:00:01.000Z',
    payload: {
      event: 'beforeSubmitPrompt',
      conversation_id: 'cursor-thread',
    },
  });
  assert.notEqual(withoutText, null);
  assert.equal(withoutText?.text, null);
  assert.equal(withoutText?.confidence, 'low');
});

void test('prompt engine extracts codex otlp user prompt text', () => {
  const engine = new SessionPromptEngine();
  const prompt = engine.extractFromTelemetry({
    agentType: 'codex',
    source: 'otlp-log',
    eventName: 'codex.user_prompt',
    summary: 'prompt submitted',
    observedAt: '2026-02-19T12:00:00.000Z',
    payload: {
      body: {
        prompt: 'Investigate snapshot hash mismatch',
      },
    },
  });
  assert.notEqual(prompt, null);
  assert.equal(prompt?.text, 'Investigate snapshot hash mismatch');
  assert.equal(prompt?.captureSource, 'otlp-log');
  assert.equal(prompt?.confidence, 'high');
});

void test('prompt engine extracts codex history prompt text', () => {
  const engine = new SessionPromptEngine();
  const prompt = engine.extractFromTelemetry({
    agentType: 'codex',
    source: 'history',
    eventName: 'user_prompt',
    summary: 'Ship a fix for cursor hook parsing',
    observedAt: '2026-02-19T12:00:00.000Z',
    payload: {
      type: 'user_prompt',
      message: 'Ship a fix for cursor hook parsing',
    },
  });
  assert.notEqual(prompt, null);
  assert.equal(prompt?.text, 'Ship a fix for cursor hook parsing');
  assert.equal(prompt?.captureSource, 'history');
});

void test('prompt engine extracts codex prompt text from lifecycle summary fallback', () => {
  const engine = new SessionPromptEngine();
  const prompt = engine.extractFromTelemetry({
    agentType: 'codex',
    source: 'otlp-log',
    eventName: 'codex.user_prompt',
    summary: 'prompt: summarize the failing test',
    observedAt: '2026-02-19T12:00:00.000Z',
    payload: {
      body: {
        status: 'ok',
      },
    },
  });
  assert.notEqual(prompt, null);
  assert.equal(prompt?.text, 'summarize the failing test');
  assert.equal(prompt?.confidence, 'medium');
});

void test('prompt engine ignores non-prompt events across agents', () => {
  const engine = new SessionPromptEngine();
  assert.equal(
    engine.extractFromNotify({
      agentType: 'claude',
      observedAt: '2026-02-19T12:00:00.000Z',
      payload: { hook_event_name: 'PreToolUse' },
    }),
    null,
  );
  assert.equal(
    engine.extractFromNotify({
      agentType: 'codex',
      observedAt: '2026-02-19T12:00:00.000Z',
      payload: { type: 'agent-turn-complete' },
    }),
    null,
  );
  assert.equal(
    engine.extractFromTelemetry({
      agentType: 'claude',
      source: 'otlp-log',
      eventName: 'claude.userpromptsubmit',
      summary: 'prompt',
      observedAt: '2026-02-19T12:00:00.000Z',
      payload: { prompt: 'x' },
    }),
    null,
  );
  assert.equal(
    engine.extractFromTelemetry({
      agentType: 'cursor',
      source: 'otlp-log',
      eventName: 'cursor.beforesubmitprompt',
      summary: 'prompt',
      observedAt: '2026-02-19T12:00:00.000Z',
      payload: { prompt: 'x' },
    }),
    null,
  );
  assert.equal(
    engine.extractFromTelemetry({
      agentType: 'codex',
      source: 'otlp-metric',
      eventName: 'codex.turn.e2e_duration_ms',
      summary: 'turn complete',
      observedAt: '2026-02-19T12:00:00.000Z',
      payload: {},
    }),
    null,
  );
});
