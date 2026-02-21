import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { ControlPlaneStreamServer } from '../../../src/control-plane/stream-server.ts';
import { FakeLiveSession } from '../../helpers/control-plane-stream-server-test-helpers.ts';

function withPathEnvironment(pathValue: string, run: () => Promise<void>): Promise<void> {
  const previousPath = process.env.PATH;
  const previousPathExt = process.env.PATHEXT;
  process.env.PATH = pathValue;
  if (process.platform === 'win32') {
    process.env.PATHEXT = '.CMD;.EXE;.BAT;.COM';
  }
  return run().finally(() => {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    if (previousPathExt === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = previousPathExt;
    }
  });
}

void test('fresh-install style PATH returns unavailable tools with configured install commands', async () => {
  const emptyPathDir = mkdtempSync(join(tmpdir(), 'harness-agent-tools-empty-'));
  try {
    await withPathEnvironment(emptyPathDir, async () => {
      const server = new ControlPlaneStreamServer({
        startSession: (input) => new FakeLiveSession(input),
        agentInstall: {
          codex: { command: 'brew install codex-cli' },
          claude: { command: 'brew install claude-code' },
          cursor: { command: 'brew install cursor-agent' },
          critique: { command: 'bun add --global critique@latest' },
        },
      });
      try {
        const tools = server.resolveAgentToolStatus();
        assert.equal(tools.length, 4);
        for (const tool of tools) {
          assert.equal(tool.available, false);
        }
        assert.equal(
          tools.find((tool) => tool.agentType === 'codex')?.installCommand,
          'brew install codex-cli',
        );
        assert.equal(
          tools.find((tool) => tool.agentType === 'claude')?.installCommand,
          'brew install claude-code',
        );
        assert.equal(
          tools.find((tool) => tool.agentType === 'cursor')?.installCommand,
          'brew install cursor-agent',
        );
        assert.equal(
          tools.find((tool) => tool.agentType === 'critique')?.installCommand,
          'bun add --global critique@latest',
        );
      } finally {
        await server.close();
      }
    });
  } finally {
    rmSync(emptyPathDir, { recursive: true, force: true });
  }
});

void test('fresh-install style PATH marks codex available when a local codex executable exists', async () => {
  const binDir = mkdtempSync(join(tmpdir(), 'harness-agent-tools-bin-'));
  const commandFileName = process.platform === 'win32' ? 'codex.cmd' : 'codex';
  const commandPath = join(binDir, commandFileName);
  writeFileSync(
    commandPath,
    process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n',
    'utf8',
  );
  if (process.platform !== 'win32') {
    chmodSync(commandPath, 0o755);
  }
  try {
    await withPathEnvironment(binDir, async () => {
      const server = new ControlPlaneStreamServer({
        startSession: (input) => new FakeLiveSession(input),
      });
      try {
        const tools = server.resolveAgentToolStatus(['codex', 'critique']);
        assert.equal(tools.length, 2);
        assert.equal(tools[0]?.agentType, 'codex');
        assert.equal(tools[0]?.available, true);
        assert.equal(tools[1]?.agentType, 'critique');
        assert.equal(tools[1]?.available, false);
      } finally {
        await server.close();
      }
    });
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});
