import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'bun:test';
import { resolveHarnessConfigPath } from '../src/config/config-core.ts';
import { HarnessRuntimeContextFactory } from '../src/cli/runtime/context.ts';

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'runtime-context-factory-test-'));
}

function createEnv(workspace: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HARNESS_INVOKE_CWD: workspace,
    XDG_CONFIG_HOME: resolve(workspace, '.xdg-config'),
    HOME: workspace,
  };
}

test('runtime context factory resolves default and named session paths', () => {
  const workspace = createWorkspace();
  const env = createEnv(workspace);
  const factory = new HarnessRuntimeContextFactory(env, workspace, () => undefined);

  const defaultRuntime = factory.create(null);
  assert.equal(defaultRuntime.invocationDirectory, workspace);
  assert.equal(defaultRuntime.gatewayRecordPath.endsWith('gateway.json'), true);
  assert.equal(defaultRuntime.profileDir.includes('/profiles'), true);
  assert.equal(defaultRuntime.profileStatePath.endsWith('active-profile.json'), true);

  const namedRuntime = factory.create('session-a');
  assert.equal(namedRuntime.sessionName, 'session-a');
  assert.equal(namedRuntime.gatewayRecordPath.includes('/sessions/session-a/'), true);
  assert.equal(namedRuntime.profileDir.endsWith('/profiles/session-a'), true);
});

test('runtime context factory resolves inspect runtime args from config', () => {
  const workspace = createWorkspace();
  const env = createEnv(workspace);
  const configPath = resolveHarnessConfigPath(workspace, env);
  mkdirSync(resolve(configPath, '..'), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        configVersion: 1,
        debug: {
          enabled: true,
          inspect: {
            enabled: true,
            gatewayPort: 9228,
            clientPort: 9229,
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const factory = new HarnessRuntimeContextFactory(env, workspace, () => undefined);
  const runtime = factory.create(null);
  assert.equal(
    runtime.runtimeOptions.gatewayRuntimeArgs.includes('--inspect=localhost:9228/harness-gateway'),
    true,
  );
  assert.equal(
    runtime.runtimeOptions.clientRuntimeArgs.includes('--inspect=localhost:9229/harness-client'),
    true,
  );
});

test('runtime context factory default stdout path reports legacy migration messages', () => {
  const workspace = createWorkspace();
  const env = createEnv(workspace);
  const legacyRoot = resolve(workspace, '.harness');
  mkdirSync(legacyRoot, { recursive: true });
  writeFileSync(resolve(legacyRoot, 'legacy-artifact.txt'), 'artifact', 'utf8');

  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown): boolean => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const factory = new HarnessRuntimeContextFactory(env, workspace);
    const runtime = factory.create(null);
    assert.equal(runtime.invocationDirectory, workspace);
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(writes.join('').includes('[migration] local .harness migrated'), true);
});
