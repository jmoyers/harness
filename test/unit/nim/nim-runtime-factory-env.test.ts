import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { createRuntimeFromEnv } from '../../../packages/nim/src/runtime/runtime-factory.ts';

function runtimePaths(prefix: string): {
  readonly cwd: string;
  readonly eventStorePath: string;
  readonly sessionStorePath: string;
} {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  return {
    cwd,
    eventStorePath: join(cwd, 'events.sqlite'),
    sessionStorePath: join(cwd, 'sessions.sqlite'),
  };
}

test('nim runtime factory allows startup without anthropic key and can configure it later', () => {
  const paths = runtimePaths('nim-runtime-env-');
  const handle = createRuntimeFromEnv({
    cwd: paths.cwd,
    eventStorePath: paths.eventStorePath,
    sessionStorePath: paths.sessionStorePath,
    telemetryPath: null,
    env: {
      HARNESS_NIM_MODEL: 'anthropic/claude-sonnet-4-20250514',
      ANTHROPIC_API_KEY: '',
    },
    liveAnthropic: true,
  });
  try {
    assert.deepEqual(handle.requiredApiKey, {
      envVar: 'ANTHROPIC_API_KEY',
      displayName: 'Anthropic API Key',
    });
    assert.equal(handle.hasRequiredApiKey(), false);
    handle.configureRequiredApiKey('sk-ant-test');
    assert.equal(handle.hasRequiredApiKey(), true);
  } finally {
    handle.close();
  }
});

test('nim runtime factory reports no required key in mock mode', () => {
  const paths = runtimePaths('nim-runtime-env-mock-');
  const handle = createRuntimeFromEnv({
    cwd: paths.cwd,
    eventStorePath: paths.eventStorePath,
    sessionStorePath: paths.sessionStorePath,
    telemetryPath: null,
    env: {},
    liveAnthropic: false,
  });
  try {
    assert.equal(handle.requiredApiKey, null);
    assert.equal(handle.hasRequiredApiKey(), true);
  } finally {
    handle.close();
  }
});
