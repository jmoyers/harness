import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { claudePromptExtractor } from '../../../src/control-plane/prompt/extractors/claude-prompt-extractor.ts';
import { codexPromptExtractor } from '../../../src/control-plane/prompt/extractors/codex-prompt-extractor.ts';
import { cursorPromptExtractor } from '../../../src/control-plane/prompt/extractors/cursor-prompt-extractor.ts';

void test('direct prompt extractors cover method contracts', () => {
  const claudePrompt = claudePromptExtractor.fromNotify({
    observedAt: '2026-02-19T00:00:00.000Z',
    payload: {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'claude prompt',
    },
  });
  assert.equal(claudePrompt?.text, 'claude prompt');
  assert.equal(
    claudePromptExtractor.fromNotify({
      observedAt: '2026-02-19T00:00:00.000Z',
      payload: {},
    }),
    null,
  );
  assert.equal(
    claudePromptExtractor.fromTelemetry({
      source: 'otlp-log',
      eventName: 'claude.userpromptsubmit',
      summary: 'prompt',
      payload: { prompt: 'ignored' },
      observedAt: '2026-02-19T00:00:00.000Z',
    }),
    null,
  );

  const cursorPrompt = cursorPromptExtractor.fromNotify({
    observedAt: '2026-02-19T00:00:00.000Z',
    payload: {
      event: 'beforeSubmitPrompt',
      prompt: 'cursor prompt',
    },
  });
  assert.equal(cursorPrompt?.text, 'cursor prompt');
  assert.equal(
    cursorPromptExtractor.fromNotify({
      observedAt: '2026-02-19T00:00:00.000Z',
      payload: {},
    }),
    null,
  );
  assert.equal(
    cursorPromptExtractor.fromTelemetry({
      source: 'otlp-log',
      eventName: 'cursor.beforesubmitprompt',
      summary: 'prompt',
      payload: { prompt: 'ignored' },
      observedAt: '2026-02-19T00:00:00.000Z',
    }),
    null,
  );

  assert.equal(
    codexPromptExtractor.fromNotify({
      observedAt: '2026-02-19T00:00:00.000Z',
      payload: { type: 'agent-turn-complete' },
    }),
    null,
  );
  const codexPrompt = codexPromptExtractor.fromTelemetry({
    source: 'otlp-log',
    eventName: 'codex.user_prompt',
    summary: 'prompt: codex prompt',
    payload: {
      body: {
        note: 'fallback to summary',
      },
    },
    observedAt: '2026-02-19T00:00:00.000Z',
  });
  assert.equal(codexPrompt?.text, 'codex prompt');
  assert.equal(
    codexPromptExtractor.fromTelemetry({
      source: 'otlp-metric',
      eventName: 'codex.user_prompt',
      summary: 'prompt: should be ignored',
      payload: {},
      observedAt: '2026-02-19T00:00:00.000Z',
    }),
    null,
  );
});
