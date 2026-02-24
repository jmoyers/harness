import assert from 'node:assert/strict';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'bun:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startPtySession, type PtyExit } from '../../../src/pty/pty_host.ts';
import { TerminalSnapshotOracle } from '../../../src/terminal/snapshot-oracle.ts';
import { createWorkspace, workspaceXdgConfigHome } from '../../helpers/harness-cli-test-helpers.ts';

const HARNESS_SCRIPT_PATH = resolve(process.cwd(), 'scripts/harness.ts');

function tsRuntimeArgs(scriptPath: string, args: readonly string[] = []): string[] {
  return [scriptPath, ...args];
}

function isPtyExit(value: unknown): value is PtyExit {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { code?: unknown; signal?: unknown };
  const codeOk = typeof candidate.code === 'number' || candidate.code === null;
  const signalOk = typeof candidate.signal === 'string' || candidate.signal === null;
  return codeOk && signalOk;
}

function waitForExit(
  session: ReturnType<typeof startPtySession>,
  timeoutMs: number,
): Promise<PtyExit> {
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      rejectExit(new Error('timed out waiting for nim cli pty exit'));
    }, timeoutMs);
    session.once('exit', (result: unknown) => {
      clearTimeout(timer);
      if (!isPtyExit(result)) {
        rejectExit(new Error('received malformed pty exit payload'));
        return;
      }
      resolveExit(result);
    });
  });
}

async function waitForSnapshotLineContaining(
  oracle: TerminalSnapshotOracle,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const frame = oracle.snapshotWithoutHash();
    if (frame.lines.some((line) => line.includes(text))) {
      return;
    }
    await delay(40);
  }
  throw new Error(`timed out waiting for snapshot text: ${text}`);
}

function listFilesRecursively(root: string): readonly string[] {
  if (!existsSync(root)) {
    return [];
  }
  const output: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else {
        output.push(absolutePath);
      }
    }
  }
  return output;
}

void test(
  'harness nim respects --session by writing nim sqlite artifacts into the named session scope',
  async () => {
    const workspace = createWorkspace();
    const scopedSessionName = 'nim-e2e-scope';
    const oracle = new TerminalSnapshotOracle(120, 32);
    const xdgConfigHome = workspaceXdgConfigHome(workspace);
    const session = startPtySession({
      command: process.execPath,
      commandArgs: tsRuntimeArgs(HARNESS_SCRIPT_PATH, [
        '--session',
        scopedSessionName,
        'nim',
        '--mock',
      ]),
      cwd: workspace,
      env: {
        ...process.env,
        HARNESS_INVOKE_CWD: workspace,
        XDG_CONFIG_HOME: xdgConfigHome,
      },
      initialCols: 120,
      initialRows: 32,
    });
    const exitPromise = waitForExit(session, 45_000);
    session.on('data', (chunk: Buffer) => {
      oracle.ingest(chunk);
    });

    try {
      await waitForSnapshotLineContaining(oracle, 'harness coordination agent', 20_000);
      session.write('\u0003');
      const exit = await exitPromise;
      assert.equal(exit.signal, null);
      assert.equal(exit.code === 0 || exit.code === 130, true);

      const allRuntimeFiles = listFilesRecursively(join(xdgConfigHome, 'harness', 'workspaces'));
      const hasScopedEventStore = allRuntimeFiles.some((path) =>
        path.endsWith(`/sessions/${scopedSessionName}/nim/events.sqlite`),
      );
      const hasScopedSessionStore = allRuntimeFiles.some((path) =>
        path.endsWith(`/sessions/${scopedSessionName}/nim/sessions.sqlite`),
      );
      const hasScopedTelemetry = allRuntimeFiles.some((path) =>
        path.endsWith(`/sessions/${scopedSessionName}/nim/events.jsonl`),
      );
      const hasUnscopedEventStore = allRuntimeFiles.some(
        (path) => path.endsWith('/nim/events.sqlite') && !path.includes('/sessions/'),
      );
      assert.equal(hasScopedEventStore, true);
      assert.equal(hasScopedSessionStore, true);
      assert.equal(hasScopedTelemetry, true);
      assert.equal(hasUnscopedEventStore, false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
  { timeout: 60_000 },
);
