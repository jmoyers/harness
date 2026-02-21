/* oxlint-disable no-unused-vars */
import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { connectControlPlaneStreamClient } from '../../../src/control-plane/stream-client.ts';
import {
  startControlPlaneStreamServer,
  type StartControlPlaneSessionInput,
} from '../../../src/control-plane/stream-server.ts';
import { resolveHarnessWorkspaceDirectory } from '../../../src/config/harness-paths.ts';
import type { CodexLiveEvent } from '../../../src/codex/live-session.ts';
import { startPtySession, type PtyExit } from '../../../src/pty/pty_host.ts';
import { SqliteControlPlaneStore } from '../../../src/store/control-plane-store.ts';
import { TerminalSnapshotOracle } from '../../../src/terminal/snapshot-oracle.ts';

interface SessionDataEvent {
  cursor: number;
  chunk: Buffer;
}

interface SessionAttachHandlers {
  onData: (event: SessionDataEvent) => void;
  onExit: (exit: PtyExit) => void;
}

class StartupTestLiveSession {
  private readonly snapshotOracle: TerminalSnapshotOracle;
  private readonly attachments = new Map<string, SessionAttachHandlers>();
  private readonly listeners = new Set<(event: CodexLiveEvent) => void>();
  private nextAttachmentId = 1;
  private latestCursor = 0;

  constructor(input: StartControlPlaneSessionInput) {
    this.snapshotOracle = new TerminalSnapshotOracle(input.initialCols, input.initialRows);
  }

  attach(handlers: SessionAttachHandlers): string {
    const attachmentId = `attach-${this.nextAttachmentId}`;
    this.nextAttachmentId += 1;
    this.attachments.set(attachmentId, handlers);
    return attachmentId;
  }

  detach(attachmentId: string): void {
    this.attachments.delete(attachmentId);
  }

  latestCursorValue(): number {
    return this.latestCursor;
  }

  processId(): number | null {
    return null;
  }

  write(data: string | Uint8Array): void {
    const chunk = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data);
    this.snapshotOracle.ingest(chunk);
    this.latestCursor += 1;
    for (const handlers of this.attachments.values()) {
      handlers.onData({
        cursor: this.latestCursor,
        chunk,
      });
    }
  }

  resize(cols: number, rows: number): void {
    this.snapshotOracle.resize(cols, rows);
  }

  snapshot() {
    return this.snapshotOracle.snapshot();
  }

  close(): void {}

  onEvent(listener: (event: CodexLiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

interface CaptureMuxBootOutputOptions {
  controlPlaneHost?: string;
  controlPlanePort?: number;
  controlPlaneAuthToken?: string;
  extraEnv?: Record<string, string>;
}

interface StartInteractiveMuxOptions extends CaptureMuxBootOutputOptions {
  cols?: number;
  rows?: number;
}

function tsRuntimeArgs(scriptPath: string, args: readonly string[] = []): string[] {
  return [scriptPath, ...args];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function isPidRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ESRCH';
  }
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isPidRunning(pid)) {
      return true;
    }
    await delay(25);
  }
  return !isPidRunning(pid);
}

async function waitForRepositoryRows(
  client: Awaited<ReturnType<typeof connectControlPlaneStreamClient>>,
  scope: {
    readonly tenantId: string;
    readonly userId: string;
    readonly workspaceId: string;
  },
  timeoutMs: number,
): Promise<void> {
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < timeoutMs) {
    const listed = await client.sendCommand({
      type: 'repository.list',
      tenantId: scope.tenantId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    });
    const rows = Array.isArray(listed['repositories']) ? listed['repositories'] : [];
    if (rows.length > 0) {
      return;
    }
    await delay(40);
  }
  throw new Error('timed out waiting for repository rows');
}

async function waitForDirectoryGitStatus(
  client: Awaited<ReturnType<typeof connectControlPlaneStreamClient>>,
  scope: {
    readonly tenantId: string;
    readonly userId: string;
    readonly workspaceId: string;
    readonly directoryId: string;
  },
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < timeoutMs) {
    const listed = await client.sendCommand({
      type: 'directory.git-status',
      tenantId: scope.tenantId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      directoryId: scope.directoryId,
    });
    const rows = Array.isArray(listed['gitStatuses'])
      ? (listed['gitStatuses'] as readonly Record<string, unknown>[])
      : [];
    const row = rows[0];
    if (row !== undefined) {
      const repositoryId = row['repositoryId'];
      const summary =
        typeof row['summary'] === 'object' && row['summary'] !== null
          ? (row['summary'] as Record<string, unknown>)
          : null;
      if (typeof repositoryId === 'string' && typeof summary?.['branch'] === 'string') {
        return row;
      }
    }
    await delay(40);
  }
  throw new Error('timed out waiting for directory git status');
}

function githubJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
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
      rejectExit(new Error('timed out waiting for codex-live-mux exit'));
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

function assertExpectedBootTeardownExit(exit: PtyExit): void {
  assert.equal(exit.signal, null);
  assert.equal(exit.code === 0 || exit.code === 129 || exit.code === 130, true);
}

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'harness-mux-startup-'));
}

function workspaceXdgConfigHome(workspace: string): string {
  return join(workspace, '.harness-xdg');
}

function workspaceRuntimeRoot(workspace: string): string {
  return resolveHarnessWorkspaceDirectory(workspace, {
    XDG_CONFIG_HOME: workspaceXdgConfigHome(workspace),
  });
}

function normalizeTerminalOutput(value: string): string {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  const oscPattern = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, 'gu');
  const csiPattern = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'gu');
  const escPattern = new RegExp(`${ESC}[@-_]`, 'gu');
  return value
    .replace(oscPattern, '')
    .replace(csiPattern, '')
    .replace(escPattern, '')
    .replace(/\r/gu, '');
}

async function captureMuxBootOutput(
  workspace: string,
  durationMs: number,
  options: CaptureMuxBootOutputOptions = {},
): Promise<{ output: string; exit: PtyExit }> {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const collected: Buffer[] = [];
  const commandArgs = tsRuntimeArgs(scriptPath);
  if (options.controlPlaneHost !== undefined) {
    commandArgs.push('--harness-server-host', options.controlPlaneHost);
  }
  if (options.controlPlanePort !== undefined) {
    commandArgs.push('--harness-server-port', String(options.controlPlanePort));
  }
  if (options.controlPlaneAuthToken !== undefined) {
    commandArgs.push('--harness-server-token', options.controlPlaneAuthToken);
  }
  const session = startPtySession({
    command: process.execPath,
    commandArgs,
    cwd: workspace,
    env: {
      ...process.env,
      HARNESS_INVOKE_CWD: workspace,
      XDG_CONFIG_HOME: workspaceXdgConfigHome(workspace),
      ...(options.extraEnv ?? {}),
    },
  });
  let exitResult: PtyExit | null = null;
  const exitPromise = waitForExit(session, 20000);
  session.on('data', (chunk: Buffer) => {
    collected.push(chunk);
  });
  session.once('exit', (result: unknown) => {
    if (isPtyExit(result)) {
      exitResult = result;
    }
  });

  try {
    await delay(durationMs);
  } finally {
    if (exitResult === null) {
      session.close();
    }
  }

  const exit = await exitPromise;
  return {
    output: normalizeTerminalOutput(Buffer.concat(collected).toString('utf8')),
    exit,
  };
}

function startInteractiveMuxSession(
  workspace: string,
  options: StartInteractiveMuxOptions = {},
): {
  readonly session: ReturnType<typeof startPtySession>;
  readonly oracle: TerminalSnapshotOracle;
  readonly waitForExit: Promise<PtyExit>;
} {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const commandArgs = tsRuntimeArgs(scriptPath);
  if (options.controlPlaneHost !== undefined) {
    commandArgs.push('--harness-server-host', options.controlPlaneHost);
  }
  if (options.controlPlanePort !== undefined) {
    commandArgs.push('--harness-server-port', String(options.controlPlanePort));
  }
  if (options.controlPlaneAuthToken !== undefined) {
    commandArgs.push('--harness-server-token', options.controlPlaneAuthToken);
  }
  const cols = Math.max(40, Math.floor(options.cols ?? 100));
  const rows = Math.max(10, Math.floor(options.rows ?? 30));
  const oracle = new TerminalSnapshotOracle(cols, rows);
  const session = startPtySession({
    command: process.execPath,
    commandArgs,
    cwd: workspace,
    env: {
      ...process.env,
      HARNESS_INVOKE_CWD: workspace,
      XDG_CONFIG_HOME: workspaceXdgConfigHome(workspace),
      ...(options.extraEnv ?? {}),
    },
    initialCols: cols,
    initialRows: rows,
  });
  session.on('data', (chunk: Buffer) => {
    oracle.ingest(chunk);
  });
  return {
    session,
    oracle,
    waitForExit: waitForExit(session, 60000),
  };
}

async function waitForSnapshotLineContaining(
  oracle: TerminalSnapshotOracle,
  text: string,
  timeoutMs: number,
): Promise<{ row: number; col: number }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const frame = oracle.snapshotWithoutHash();
    const rowIndex = frame.lines.findIndex((line) => line.includes(text));
    if (rowIndex >= 0) {
      const colIndex = frame.lines[rowIndex]!.indexOf(text);
      return {
        row: rowIndex + 1,
        col: colIndex + 1,
      };
    }
    await delay(40);
  }
  throw new Error(`timed out waiting for snapshot text: ${text}`);
}

async function waitForProjectThreadButtonCell(
  oracle: TerminalSnapshotOracle,
  projectName: string,
  timeoutMs: number,
): Promise<{ row: number; col: number }> {
  const buttonLabel = '[+ thread]';
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const frame = oracle.snapshotWithoutHash();
    for (let rowIndex = 0; rowIndex < frame.lines.length; rowIndex += 1) {
      const line = frame.lines[rowIndex]!;
      if (!line.includes(projectName)) {
        continue;
      }
      const buttonIndex = line.indexOf(buttonLabel);
      if (buttonIndex < 0) {
        continue;
      }
      return {
        row: rowIndex + 1,
        col: buttonIndex + 1,
      };
    }
    await delay(40);
  }
  throw new Error(`timed out waiting for project thread button: ${projectName}`);
}

async function waitForSnapshotLineNotContaining(
  oracle: TerminalSnapshotOracle,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const frame = oracle.snapshotWithoutHash();
    const hasMatch = frame.lines.some((line) => line.includes(text));
    if (!hasMatch) {
      return;
    }
    await delay(40);
  }
  throw new Error(`timed out waiting for snapshot to remove text: ${text}`);
}

async function waitForDirectoryConversationCountAtLeast(
  client: Awaited<ReturnType<typeof connectControlPlaneStreamClient>>,
  scope: {
    readonly tenantId: string;
    readonly userId: string;
    readonly workspaceId: string;
    readonly directoryId: string;
  },
  minimumCount: number,
  timeoutMs: number,
): Promise<readonly Record<string, unknown>[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await client.sendCommand({
      type: 'conversation.list',
      directoryId: scope.directoryId,
      tenantId: scope.tenantId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    });
    const rows = Array.isArray(result['conversations'])
      ? (result['conversations'] as readonly Record<string, unknown>[])
      : [];
    if (rows.length >= minimumCount) {
      return rows;
    }
    await delay(40);
  }
  throw new Error(
    `timed out waiting for conversations in directory ${scope.directoryId} (count >= ${String(minimumCount)})`,
  );
}

function writeLeftMouseClick(
  session: ReturnType<typeof startPtySession>,
  col: number,
  row: number,
): void {
  const safeCol = Math.max(1, Math.floor(col));
  const safeRow = Math.max(1, Math.floor(row));
  session.write(`\u001b[<0;${String(safeCol)};${String(safeRow)}M`);
  session.write(`\u001b[<0;${String(safeCol)};${String(safeRow)}m`);
}

async function openCommandMenuWithShortcut(
  session: ReturnType<typeof startPtySession>,
  oracle: TerminalSnapshotOracle,
  timeoutMs: number,
): Promise<void> {
  const attempts = [
    '\u001bz',
    '\u0010',
    '\u001b[112;5u',
    '\u001b[27;5;112~',
    '\u001b[112;9u',
    '\u001b[27;9;112~',
  ] as const;
  const startedAt = Date.now();
  let attemptIndex = 0;
  while (Date.now() - startedAt < timeoutMs) {
    session.write(attempts[attemptIndex % attempts.length]!);
    attemptIndex += 1;
    try {
      await waitForSnapshotLineContaining(oracle, 'Command Menu', 600);
      return;
    } catch {
      // keep retrying across supported key encodings
    }
    await delay(50);
  }
  throw new Error('timed out opening command menu with shortcut');
}

async function closeCommandMenuWithEscape(
  session: ReturnType<typeof startPtySession>,
  oracle: TerminalSnapshotOracle,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    session.write('\u001b');
    await delay(60);
    const frame = oracle.snapshotWithoutHash();
    const hasCommandMenu = frame.lines.some((line) => line.includes('Command Menu'));
    if (!hasCommandMenu) {
      return;
    }
  }
  throw new Error('timed out closing command menu with escape');
}

async function requestMuxShutdown(session: ReturnType<typeof startPtySession>): Promise<void> {
  session.write('\u0003');
  const pid = session.processId();
  if (pid === null) {
    return;
  }
  await waitForPidExit(pid, 500);
}

function runGit(cwd: string, args: readonly string[]): void {
  execFileSync('git', [...args], {
    cwd,
    stdio: 'ignore',
  });
}

void test(
  'codex-live-mux keeps rail mouse clicks active after opening home pane',
  async () => {
    const workspace = createWorkspace();
    const interactive = startInteractiveMuxSession(workspace, {
      cols: 100,
      rows: 30,
    });

    try {
      const homeCell = await waitForSnapshotLineContaining(interactive.oracle, '🏠 home', 12000);

      writeLeftMouseClick(interactive.session, homeCell.col, homeCell.row);
      await delay(150);

      writeLeftMouseClick(interactive.session, homeCell.col, homeCell.row);
      await delay(150);
    } finally {
      try {
        await requestMuxShutdown(interactive.session);
        const exit = await interactive.waitForExit;
        assert.equal(exit.signal, null);
        assert.equal(exit.code === 0 || exit.code === 130, true);
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  },
  { timeout: 30000 },
);

void test(
  'codex-live-mux opens thread-scoped command menu when clicking left-rail [+ thread] button',
  async () => {
    const workspace = createWorkspace();
    const binDirectory = join(workspace, '.test-bin');
    mkdirSync(binDirectory, { recursive: true });
    const critiqueCommandName = process.platform === 'win32' ? 'critique.cmd' : 'critique';
    const critiqueCommandPath = join(binDirectory, critiqueCommandName);
    writeFileSync(
      critiqueCommandPath,
      process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n',
      'utf8',
    );
    if (process.platform !== 'win32') {
      chmodSync(critiqueCommandPath, 0o755);
    }
    const existingPath = process.env.PATH ?? '';
    const mergedPath =
      existingPath.length > 0 ? `${binDirectory}${delimiter}${existingPath}` : binDirectory;
    const interactive = startInteractiveMuxSession(workspace, {
      cols: 100,
      rows: 30,
      extraEnv: {
        PATH: mergedPath,
      },
    });

    try {
      const threadButtonCell = await waitForSnapshotLineContaining(
        interactive.oracle,
        '[+ thread]',
        12000,
      );
      writeLeftMouseClick(interactive.session, threadButtonCell.col, threadButtonCell.row);
      await waitForSnapshotLineContaining(interactive.oracle, 'Command Menu', 12000);
      await waitForSnapshotLineContaining(interactive.oracle, 'search: _', 12000);
      await waitForSnapshotLineContaining(
        interactive.oracle,
        'Start Critique thread (diff)',
        12000,
      );
    } finally {
      try {
        await requestMuxShutdown(interactive.session);
        const exit = await interactive.waitForExit;
        assert.equal(exit.signal, null);
        assert.equal(exit.code === 0 || exit.code === 130, true);
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  },
  { timeout: 30000 },
);

void test(
  'codex-live-mux command menu exposes oauth login actions for github and linear',
  async () => {
    const workspace = createWorkspace();
    const interactive = startInteractiveMuxSession(workspace, {
      cols: 100,
      rows: 30,
    });

    try {
      await waitForSnapshotLineContaining(interactive.oracle, '🏠 home', 12000);
      await openCommandMenuWithShortcut(interactive.session, interactive.oracle, 12000);
      interactive.session.write('oauth');
      await waitForSnapshotLineContaining(interactive.oracle, 'Log In to GitHub (OAuth)', 12000);
      await waitForSnapshotLineContaining(interactive.oracle, 'Log In to Linear (OAuth)', 12000);
    } finally {
      try {
        await requestMuxShutdown(interactive.session);
        const exit = await interactive.waitForExit;
        assert.equal(exit.signal, null);
        assert.equal(exit.code === 0 || exit.code === 130, true);
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  },
  { timeout: 45000 },
);

void test(
  'codex-live-mux command menu shows github repo + open pr actions with git suffix when repository has an open PR',
  async () => {
    const workspace = createWorkspace();
    const projectPath = join(workspace, 'ash-1');
    mkdirSync(projectPath, { recursive: true });

    const tenantId = 'tenant-github-command-menu';
    const userId = 'user-github-command-menu';
    const workspaceId = 'workspace-github-command-menu';
    const worktreeId = 'worktree-github-command-menu';
    const directoryId = 'directory-github-command-menu';
    const conversationId = 'conversation-github-command-menu';
    const branchName = 'jm/encamp-scout';
    const baseBranch = 'dev';
    const prUrl = 'https://github.com/encamp/ash/pull/901';
    const headSha = 'deadbeef901';
    const nowIso = '2026-02-19T00:00:00.000Z';

    const githubFetch: typeof fetch = async (input, init = {}) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(requestUrl);
      const method = (init.method ?? 'GET').toUpperCase();
      if (url.pathname === '/repos/encamp/ash/pulls' && method === 'POST') {
        const body =
          typeof init.body === 'string' && init.body.length > 0
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : {};
        const head = typeof body['head'] === 'string' ? body['head'] : branchName;
        const base = typeof body['base'] === 'string' ? body['base'] : baseBranch;
        return githubJsonResponse({
          number: 901,
          title: 'PR: jm/encamp-scout',
          html_url: prUrl,
          state: 'open',
          draft: false,
          updated_at: nowIso,
          created_at: nowIso,
          closed_at: null,
          head: {
            ref: head,
            sha: headSha,
          },
          base: {
            ref: base,
          },
          user: {
            login: 'jmoyers',
          },
        });
      }
      if (url.pathname === '/repos/encamp/ash/pulls' && method === 'GET') {
        const head = url.searchParams.get('head');
        if (head !== `encamp:${branchName}`) {
          return githubJsonResponse([]);
        }
        return githubJsonResponse([
          {
            number: 901,
            title: 'PR: jm/encamp-scout',
            html_url: prUrl,
            state: 'open',
            draft: false,
            updated_at: nowIso,
            created_at: nowIso,
            closed_at: null,
            head: {
              ref: branchName,
              sha: headSha,
            },
            base: {
              ref: baseBranch,
            },
            user: {
              login: 'jmoyers',
            },
          },
        ]);
      }
      if (
        /^\/repos\/encamp\/ash\/commits\/[^/]+\/check-runs$/u.test(url.pathname) &&
        method === 'GET'
      ) {
        return githubJsonResponse({
          check_runs: [],
        });
      }
      if (
        /^\/repos\/encamp\/ash\/commits\/[^/]+\/status$/u.test(url.pathname) &&
        method === 'GET'
      ) {
        return githubJsonResponse({
          statuses: [],
        });
      }
      return githubJsonResponse(
        {
          message: `unexpected github route ${method} ${url.pathname}`,
        },
        404,
      );
    };

    const server = await startControlPlaneStreamServer({
      stateStorePath: join(workspaceRuntimeRoot(workspace), 'control-plane.sqlite'),
      gitStatus: {
        enabled: true,
        pollMs: 100,
        maxConcurrency: 1,
        minDirectoryRefreshMs: 100,
      },
      github: {
        enabled: true,
        token: 'test-token',
        viewerLogin: 'jmoyers',
        pollMs: 1000,
      },
      githubFetch,
      readGitDirectorySnapshot: async () => ({
        summary: {
          branch: branchName,
          changedFiles: 0,
          additions: 0,
          deletions: 0,
        },
        repository: {
          normalizedRemoteUrl: 'https://github.com/encamp/ash',
          commitCount: 42,
          lastCommitAt: nowIso,
          shortCommitHash: 'abc1234',
          inferredName: 'ash',
          defaultBranch: baseBranch,
        },
      }),
      startSession: (input) => new StartupTestLiveSession(input),
    });
    const address = server.address();
    const client = await connectControlPlaneStreamClient({
      host: address.address,
      port: address.port,
    });
    let interactive: ReturnType<typeof startInteractiveMuxSession> | null = null;

    try {
      await client.sendCommand({
        type: 'directory.upsert',
        directoryId,
        tenantId,
        userId,
        workspaceId,
        path: projectPath,
      });
      await client.sendCommand({
        type: 'conversation.create',
        conversationId,
        directoryId,
        title: 'GitHub action visibility',
        agentType: 'codex',
        adapterState: {},
      });

      await waitForRepositoryRows(
        client,
        {
          tenantId,
          userId,
          workspaceId,
        },
        6000,
      );
      await waitForDirectoryGitStatus(
        client,
        {
          tenantId,
          userId,
          workspaceId,
          directoryId,
        },
        6000,
      );

      const createdPr = await client.sendCommand({
        type: 'github.pr-create',
        directoryId,
        headBranch: branchName,
        baseBranch,
        title: 'PR: jm/encamp-scout',
      });
      assert.equal(createdPr['created'], true);

      const projectPr = await client.sendCommand({
        type: 'github.project-pr',
        directoryId,
      });
      const projectPrRecord =
        typeof projectPr['pr'] === 'object' && projectPr['pr'] !== null
          ? (projectPr['pr'] as Record<string, unknown>)
          : null;
      assert.equal(projectPrRecord?.['url'], prUrl);

      const configDirectory = join(workspaceXdgConfigHome(workspace), 'harness');
      mkdirSync(configDirectory, { recursive: true });
      writeFileSync(
        join(configDirectory, 'harness.config.jsonc'),
        JSON.stringify({
          configVersion: 1,
          mux: {
            keybindings: {
              'mux.command-menu.toggle': ['alt+z'],
            },
          },
        }),
        'utf8',
      );

      interactive = startInteractiveMuxSession(workspace, {
        controlPlaneHost: address.address,
        controlPlanePort: address.port,
        cols: 120,
        rows: 35,
        extraEnv: {
          HARNESS_TENANT_ID: tenantId,
          HARNESS_USER_ID: userId,
          HARNESS_WORKSPACE_ID: workspaceId,
          HARNESS_WORKTREE_ID: worktreeId,
        },
      });

      await waitForSnapshotLineContaining(interactive.oracle, 'ash-1', 12000);

      await openCommandMenuWithShortcut(interactive.session, interactive.oracle, 12000);

      interactive.session.write('show my open pull requests');
      await waitForSnapshotLineContaining(
        interactive.oracle,
        'Show My Open Pull Requests (git)',
        12000,
      );

      await closeCommandMenuWithEscape(interactive.session, interactive.oracle, 12000);
      await openCommandMenuWithShortcut(interactive.session, interactive.oracle, 12000);

      interactive.session.write('open github for this repo');
      await waitForSnapshotLineContaining(
        interactive.oracle,
        'Open GitHub for This Repo (git)',
        12000,
      );

      await closeCommandMenuWithEscape(interactive.session, interactive.oracle, 12000);
      await openCommandMenuWithShortcut(interactive.session, interactive.oracle, 12000);

      interactive.session.write('open pr');
      await waitForSnapshotLineContaining(interactive.oracle, 'Open PR (git)', 12000);
      await waitForSnapshotLineNotContaining(interactive.oracle, 'Create PR (git)', 12000);
    } finally {
      try {
        if (interactive !== null) {
          try {
            await closeCommandMenuWithEscape(interactive.session, interactive.oracle, 1000);
          } catch {
            // best-effort: menu may already be closed
          }
          interactive.session.close();
          const exit = await waitForExit(interactive.session, 8000);
          assert.equal(
            (exit.signal === null && (exit.code === 0 || exit.code === 129 || exit.code === 130)) ||
              (exit.signal === 'SIGTERM' && exit.code === null),
            true,
          );
        }
      } finally {
        client.close();
        await server.close();
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  },
  { timeout: 45000 },
);

