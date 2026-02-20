import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { parseNimTuiArgs, parseNimTuiCommand } from '../scripts/nim-tui-smoke.ts';

test('nim tui arg parser resolves defaults and runtime paths', () => {
  const parsed = parseNimTuiArgs([], {
    cwd: '/tmp/workspace',
    env: {
      HOME: '/tmp/home',
    },
  });
  assert.equal(parsed.tenantId, 'nim-tui-tenant');
  assert.equal(parsed.userId, 'nim-tui-user');
  assert.equal(parsed.model, 'anthropic/claude-3-haiku-20240307');
  assert.equal(parsed.uiMode, 'debug');
  assert.equal(parsed.liveAnthropic, true);
  assert.equal(parsed.eventStorePath.includes('/workspaces/'), true);
  assert.equal(parsed.sessionStorePath.includes('/workspaces/'), true);
  assert.equal(parsed.telemetryPath?.includes('/workspaces/'), true);
});

test('nim tui arg parser supports mock override and disables telemetry', () => {
  const parsed = parseNimTuiArgs(
    [
      '--tenant-id',
      'tenant-x',
      '--user-id',
      'user-x',
      '--model',
      'anthropic/claude-3-5-haiku-latest',
      '--ui-mode',
      'seamless',
      '--mock',
      '--session-id',
      'session-x',
      '--event-store-path',
      './ev.sqlite',
      '--session-store-path',
      './sess.sqlite',
      '--no-telemetry',
      '--secrets-file',
      './secrets.env',
      '--base-url',
      'http://localhost:1234',
    ],
    {
      cwd: '/tmp/workspace',
      env: {
        HOME: '/tmp/home',
      },
    },
  );
  assert.equal(parsed.tenantId, 'tenant-x');
  assert.equal(parsed.userId, 'user-x');
  assert.equal(parsed.model, 'anthropic/claude-3-5-haiku-latest');
  assert.equal(parsed.uiMode, 'seamless');
  assert.equal(parsed.liveAnthropic, false);
  assert.equal(parsed.sessionId, 'session-x');
  assert.equal(parsed.eventStorePath.endsWith('/tmp/workspace/ev.sqlite'), true);
  assert.equal(parsed.sessionStorePath.endsWith('/tmp/workspace/sess.sqlite'), true);
  assert.equal(parsed.telemetryPath, undefined);
  assert.equal(parsed.secretsFile, './secrets.env');
  assert.equal(parsed.baseUrl, 'http://localhost:1234');
});

test('nim tui command parser maps interactive commands', () => {
  assert.deepEqual(parseNimTuiCommand('/help'), { type: 'help' });
  assert.deepEqual(parseNimTuiCommand('/exit'), { type: 'exit' });
  assert.deepEqual(parseNimTuiCommand('/state'), { type: 'state' });
  assert.deepEqual(parseNimTuiCommand('/abort'), { type: 'abort' });
  assert.deepEqual(parseNimTuiCommand('/send hello'), { type: 'send', text: 'hello' });
  assert.deepEqual(parseNimTuiCommand('plain hello'), { type: 'send', text: 'plain hello' });
  assert.deepEqual(parseNimTuiCommand('/steer hello'), { type: 'steer', text: 'hello' });
  assert.deepEqual(parseNimTuiCommand('/queue hello'), {
    type: 'queue',
    text: 'hello',
    priority: 'normal',
  });
  assert.deepEqual(parseNimTuiCommand('/queue high hello'), {
    type: 'queue',
    text: 'hello',
    priority: 'high',
  });
  assert.deepEqual(parseNimTuiCommand('/replay'), { type: 'replay', count: 30 });
  assert.deepEqual(parseNimTuiCommand('/replay 5'), { type: 'replay', count: 5 });
  assert.deepEqual(parseNimTuiCommand('/mode debug'), { type: 'mode', mode: 'debug' });
  assert.deepEqual(parseNimTuiCommand('/mode seamless'), { type: 'mode', mode: 'seamless' });
  assert.deepEqual(parseNimTuiCommand('/model anthropic/claude-3-haiku-20240307'), {
    type: 'switch-model',
    model: 'anthropic/claude-3-haiku-20240307',
  });
  assert.deepEqual(parseNimTuiCommand('/session new'), { type: 'session-new' });
  assert.deepEqual(parseNimTuiCommand('/session resume session-x'), {
    type: 'session-resume',
    sessionId: 'session-x',
  });
});

test('nim tui command parser rejects invalid inputs', () => {
  assert.throws(() => parseNimTuiCommand('/mode nope'), {
    message: 'invalid mode: nope',
  });
  assert.throws(() => parseNimTuiCommand('/model nope'), {
    message: 'invalid model ref: nope',
  });
  assert.throws(() => parseNimTuiCommand('/replay nope'), {
    message: 'invalid replay count: nope',
  });
  assert.throws(() => parseNimTuiCommand('/unknown'), {
    message: 'unknown command: /unknown',
  });
});
