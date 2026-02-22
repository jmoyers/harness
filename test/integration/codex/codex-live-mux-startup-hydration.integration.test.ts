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

import {
  StartupTestLiveSession,
  assertExpectedBootTeardownExit,
  delay,
  captureMuxBootOutput,
  closeCommandMenuWithEscape,
  createWorkspace,
  githubJsonResponse,
  normalizeTerminalOutput,
  openCommandMenuWithShortcut,
  requestMuxShutdown,
  runGit,
  startInteractiveMuxSession,
  waitForDirectoryConversationCountAtLeast,
  waitForDirectoryGitStatus,
  waitForExit,
  waitForPidExit,
  waitForProjectThreadButtonCell,
  waitForRepositoryRows,
  waitForSnapshotLineContaining,
  waitForSnapshotLineNotContaining,
  workspaceRuntimeRoot,
  workspaceXdgConfigHome,
  writeLeftMouseClick,
} from '../../helpers/codex-live-mux-startup-test-helpers.ts';

void test(
  'codex-live-mux default startup is home-first, stable, and avoids implicit conversation creation',
  async () => {
    const workspace = createWorkspace();

    try {
      const result = await captureMuxBootOutput(workspace, 1800);
      assertExpectedBootTeardownExit(result.exit);
      const output = result.output;
      assert.equal(output.includes('codex:live:mux fatal error'), false);
      assert.equal(output.includes('Cannot access'), false);
      assert.equal(output.includes('ReferenceError'), false);
      assert.equal(output.includes('🏠 home'), true);
      assert.equal(output.includes('repositories [-]'), false);
      assert.equal(output.includes('[ > add repository ]'), false);
      assert.equal(output.includes('[ > add project ]'), true);
      assert.equal(output.includes('[ + new thread ]'), false);
      assert.equal(output.includes('GSV Sleeper Service'), true);
      assert.equal(output.includes('○ codex'), false);

      const storePath = join(workspaceRuntimeRoot(workspace), 'control-plane.sqlite');
      assert.equal(existsSync(storePath), true);
      const store = new SqliteControlPlaneStore(storePath);
      try {
        assert.equal(store.listConversations({ includeArchived: true }).length, 0);
      } finally {
        store.close();
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
  { timeout: 20000 },
);

void test(
  'codex-live-mux startup hydrates tracked repository groups from gateway git cache',
  async () => {
    const workspace = createWorkspace();
    const repoRoot = join(workspace, 'repo-harness');
    mkdirSync(repoRoot, { recursive: true });
    runGit(repoRoot, ['init']);
    runGit(repoRoot, ['remote', 'add', 'origin', 'https://github.com/example/harness.git']);
    const projectAPath = join(repoRoot, 'project-a');
    const projectBPath = join(repoRoot, 'project-b');
    mkdirSync(projectAPath, { recursive: true });
    mkdirSync(projectBPath, { recursive: true });

    const tenantId = 'tenant-git-cache';
    const userId = 'user-git-cache';
    const workspaceId = 'workspace-git-cache';
    const worktreeId = 'worktree-git-cache';

    const server = await startControlPlaneStreamServer({
      stateStorePath: join(workspaceRuntimeRoot(workspace), 'control-plane.sqlite'),
      gitStatus: {
        enabled: true,
        pollMs: 60_000,
        maxConcurrency: 1,
        minDirectoryRefreshMs: 60_000,
      },
      startSession: (input) => new StartupTestLiveSession(input),
    });
    const address = server.address();
    const client = await connectControlPlaneStreamClient({
      host: address.address,
      port: address.port,
    });

    try {
      await client.sendCommand({
        type: 'directory.upsert',
        directoryId: 'directory-project-a',
        tenantId,
        userId,
        workspaceId,
        path: projectAPath,
      });
      await client.sendCommand({
        type: 'directory.upsert',
        directoryId: 'directory-project-b',
        tenantId,
        userId,
        workspaceId,
        path: projectBPath,
      });
      await client.sendCommand({
        type: 'conversation.create',
        conversationId: 'conversation-project-a',
        directoryId: 'directory-project-a',
        title: 'thread a',
        agentType: 'codex',
        adapterState: {},
      });
      await client.sendCommand({
        type: 'conversation.create',
        conversationId: 'conversation-project-b',
        directoryId: 'directory-project-b',
        title: 'thread b',
        agentType: 'codex',
        adapterState: {},
      });
      await delay(180);

      const result = await captureMuxBootOutput(workspace, 2200, {
        controlPlaneHost: address.address,
        controlPlanePort: address.port,
        extraEnv: {
          HARNESS_TENANT_ID: tenantId,
          HARNESS_USER_ID: userId,
          HARNESS_WORKSPACE_ID: workspaceId,
          HARNESS_WORKTREE_ID: worktreeId,
        },
      });
      assertExpectedBootTeardownExit(result.exit);
      assert.equal(result.output.includes('harness (2 projects'), true);
      assert.equal(result.output.includes('untracked (3 projects'), false);
      assert.equal(result.output.includes('thread a'), true);
      assert.equal(result.output.includes('thread b'), true);
    } finally {
      client.close();
      await server.close();
      rmSync(workspace, { recursive: true, force: true });
    }
  },
  { timeout: 30000 },
);

void test(
  'codex-live-mux startup does not resurrect archived project threads from stream replay',
  async () => {
    const workspace = createWorkspace();
    mkdirSync(join(workspace, 'project-a'), { recursive: true });
    mkdirSync(join(workspace, 'project-b'), { recursive: true });

    const tenantId = 'tenant-replay';
    const userId = 'user-replay';
    const workspaceId = 'workspace-replay';
    const worktreeId = 'worktree-replay';
    const startedSessionInputs: StartControlPlaneSessionInput[] = [];

    const server = await startControlPlaneStreamServer({
      stateStorePath: join(workspaceRuntimeRoot(workspace), 'control-plane.sqlite'),
      startSession: (input) => {
        startedSessionInputs.push(input);
        return new StartupTestLiveSession(input);
      },
    });
    const address = server.address();
    const client = await connectControlPlaneStreamClient({
      host: address.address,
      port: address.port,
    });

    try {
      await client.sendCommand({
        type: 'directory.upsert',
        directoryId: 'directory-project-a',
        tenantId,
        userId,
        workspaceId,
        path: join(workspace, 'project-a'),
      });
      await client.sendCommand({
        type: 'directory.upsert',
        directoryId: 'directory-project-b',
        tenantId,
        userId,
        workspaceId,
        path: join(workspace, 'project-b'),
      });

      for (const [conversationId, directoryId] of [
        ['conversation-project-a', 'directory-project-a'],
        ['conversation-project-b', 'directory-project-b'],
      ] as const) {
        await client.sendCommand({
          type: 'conversation.create',
          conversationId,
          directoryId,
          title: '',
          agentType: 'codex',
          adapterState: {},
        });
        await client.sendCommand({
          type: 'pty.start',
          sessionId: conversationId,
          args: ['resume', `thread-${conversationId}`],
          env: {
            TERM: 'xterm-256color',
          },
          initialCols: 80,
          initialRows: 24,
          tenantId,
          userId,
          workspaceId,
          worktreeId,
        });
        await client.sendCommand({
          type: 'session.remove',
          sessionId: conversationId,
        });
        await client.sendCommand({
          type: 'conversation.archive',
          conversationId,
        });
      }

      const startsBeforeMux = startedSessionInputs.length;
      const result = await captureMuxBootOutput(workspace, 1800, {
        controlPlaneHost: address.address,
        controlPlanePort: address.port,
        extraEnv: {
          HARNESS_TENANT_ID: tenantId,
          HARNESS_USER_ID: userId,
          HARNESS_WORKSPACE_ID: workspaceId,
          HARNESS_WORKTREE_ID: worktreeId,
          HARNESS_MUX_BACKGROUND_RESUME: '1',
        },
      });
      assertExpectedBootTeardownExit(result.exit);
      assert.equal(startedSessionInputs.length, startsBeforeMux);

      const listedSessions = await client.sendCommand({
        type: 'session.list',
        tenantId,
        userId,
        workspaceId,
        worktreeId,
      });
      const sessions = Array.isArray(listedSessions['sessions']) ? listedSessions['sessions'] : [];
      assert.equal(sessions.length, 0);
    } finally {
      client.close();
      await server.close();
      rmSync(workspace, { recursive: true, force: true });
    }
  },
  { timeout: 20000 },
);

void test(
  'codex-live-mux startup keeps clean repository projects out of the untracked group',
  async () => {
    const workspace = createWorkspace();
    const tenantId = 'tenant-clean-repo';
    const userId = 'user-clean-repo';
    const workspaceId = 'workspace-clean-repo';
    const worktreeId = 'worktree-clean-repo';
    const directoryId = `directory-${workspaceId}`;

    const server = await startControlPlaneStreamServer({
      stateStorePath: join(workspaceRuntimeRoot(workspace), 'control-plane.sqlite'),
      gitStatus: {
        enabled: true,
        pollMs: 100,
        maxConcurrency: 1,
        minDirectoryRefreshMs: 100,
      },
      readGitDirectorySnapshot: () =>
        Promise.resolve({
          summary: {
            branch: 'main',
            changedFiles: 0,
            additions: 0,
            deletions: 0,
          },
          repository: {
            normalizedRemoteUrl: 'https://github.com/example/tracked-repo',
            commitCount: 42,
            lastCommitAt: '2026-02-16T00:00:00.000Z',
            shortCommitHash: 'abc1234',
            inferredName: 'tracked-repo',
            defaultBranch: 'main',
          },
        }),
      startSession: (input) => new StartupTestLiveSession(input),
    });
    const address = server.address();
    const client = await connectControlPlaneStreamClient({
      host: address.address,
      port: address.port,
    });

    try {
      await client.sendCommand({
        type: 'directory.upsert',
        directoryId,
        tenantId,
        userId,
        workspaceId,
        path: workspace,
      });
      await waitForRepositoryRows(
        client,
        {
          tenantId,
          userId,
          workspaceId,
        },
        4000,
      );

      const result = await captureMuxBootOutput(workspace, 1800, {
        controlPlaneHost: address.address,
        controlPlanePort: address.port,
        extraEnv: {
          HARNESS_TENANT_ID: tenantId,
          HARNESS_USER_ID: userId,
          HARNESS_WORKSPACE_ID: workspaceId,
          HARNESS_WORKTREE_ID: worktreeId,
        },
      });
      assertExpectedBootTeardownExit(result.exit);
      assert.equal(result.output.includes('tracked-repo (1 projects, 0 ac'), true);
      assert.equal(result.output.includes('untracked (1 projects, 0 ac'), false);
    } finally {
      client.close();
      await server.close();
      rmSync(workspace, { recursive: true, force: true });
    }
  },
  { timeout: 20000 },
);
