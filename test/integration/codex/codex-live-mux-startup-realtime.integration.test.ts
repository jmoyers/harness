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
  'codex-live-mux starts a thread in the clicked project from left-rail [+ thread]',
  async () => {
    const workspace = createWorkspace();
    const projectAlphaPath = join(workspace, 'alpha');
    const projectBetaPath = join(workspace, 'beta');
    mkdirSync(projectAlphaPath, { recursive: true });
    mkdirSync(projectBetaPath, { recursive: true });

    const tenantId = 'tenant-thread-scope';
    const userId = 'user-thread-scope';
    const workspaceId = 'workspace-thread-scope';
    const worktreeId = 'worktree-thread-scope';
    const server = await startControlPlaneStreamServer({
      stateStorePath: join(workspaceRuntimeRoot(workspace), 'control-plane.sqlite'),
      startSession: (input) => new StartupTestLiveSession(input),
    });
    const address = server.address();
    const client = await connectControlPlaneStreamClient({
      host: address.address,
      port: address.port,
    });

    const interactive = startInteractiveMuxSession(workspace, {
      controlPlaneHost: address.address,
      controlPlanePort: address.port,
      cols: 100,
      rows: 30,
      extraEnv: {
        HARNESS_TENANT_ID: tenantId,
        HARNESS_USER_ID: userId,
        HARNESS_WORKSPACE_ID: workspaceId,
        HARNESS_WORKTREE_ID: worktreeId,
      },
    });

    try {
      await client.sendCommand({
        type: 'directory.upsert',
        directoryId: 'directory-alpha',
        tenantId,
        userId,
        workspaceId,
        path: projectAlphaPath,
      });
      await client.sendCommand({
        type: 'directory.upsert',
        directoryId: 'directory-beta',
        tenantId,
        userId,
        workspaceId,
        path: projectBetaPath,
      });

      const alphaProjectCell = await waitForSnapshotLineContaining(
        interactive.oracle,
        'alpha',
        12000,
      );
      writeLeftMouseClick(interactive.session, alphaProjectCell.col, alphaProjectCell.row);
      await delay(150);

      const betaThreadButtonCell = await waitForProjectThreadButtonCell(
        interactive.oracle,
        'beta',
        12000,
      );
      writeLeftMouseClick(interactive.session, betaThreadButtonCell.col, betaThreadButtonCell.row);
      await waitForSnapshotLineContaining(interactive.oracle, 'Start Codex thread', 12000);

      interactive.session.write('\r');

      const betaConversations = await waitForDirectoryConversationCountAtLeast(
        client,
        {
          tenantId,
          userId,
          workspaceId,
          directoryId: 'directory-beta',
        },
        1,
        12000,
      );
      assert.equal(betaConversations.length >= 1, true);

      const alphaConversations = await client.sendCommand({
        type: 'conversation.list',
        directoryId: 'directory-alpha',
        tenantId,
        userId,
        workspaceId,
      });
      const alphaRows = Array.isArray(alphaConversations['conversations'])
        ? alphaConversations['conversations']
        : [];
      assert.equal(alphaRows.length, 0);
    } finally {
      try {
        await requestMuxShutdown(interactive.session);
        const exit = await interactive.waitForExit;
        assert.equal(exit.signal, null);
        assert.equal(exit.code === 0 || exit.code === 130, true);
      } finally {
        client.close();
        await server.close();
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  },
  { timeout: 30000 },
);

void test(
  'codex-live-mux renders split pane with repository rail and thread rows',
  async () => {
    const workspace = createWorkspace();
    const projectPath = join(workspace, 'project-split');
    mkdirSync(projectPath, { recursive: true });

    const tenantId = 'tenant-split-pane';
    const userId = 'user-split-pane';
    const workspaceId = 'workspace-split-pane';
    const worktreeId = 'worktree-split-pane';
    const directoryId = 'directory-split-pane';
    const conversationId = 'conversation-split-pane';

    const server = await startControlPlaneStreamServer({
      stateStorePath: join(workspaceRuntimeRoot(workspace), 'control-plane.sqlite'),
      startSession: (input) => new StartupTestLiveSession(input),
    });
    const address = server.address();
    const client = await connectControlPlaneStreamClient({
      host: address.address,
      port: address.port,
    });

    const interactive = startInteractiveMuxSession(workspace, {
      controlPlaneHost: address.address,
      controlPlanePort: address.port,
      cols: 120,
      rows: 30,
      extraEnv: {
        HARNESS_TENANT_ID: tenantId,
        HARNESS_USER_ID: userId,
        HARNESS_WORKSPACE_ID: workspaceId,
        HARNESS_WORKTREE_ID: worktreeId,
        HARNESS_CONVERSATION_ID: conversationId,
      },
    });

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
        title: 'split-pane-thread',
        agentType: 'terminal',
        adapterState: {},
      });
      await client.sendCommand({
        type: 'pty.start',
        sessionId: conversationId,
        args: [],
        initialCols: 80,
        initialRows: 24,
        tenantId,
        userId,
        workspaceId,
        worktreeId,
      });

      await waitForSnapshotLineContaining(interactive.oracle, '│', 8000);
      await waitForSnapshotLineContaining(interactive.oracle, 'split-pane-thr', 8000);
    } finally {
      try {
        await requestMuxShutdown(interactive.session);
        const exit = await interactive.waitForExit;
        assert.equal(exit.signal, null);
        assert.equal(exit.code === 0 || exit.code === 130, true);
      } finally {
        client.close();
        await server.close();
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  },
  { timeout: 30000 },
);

void test(
  'codex-live-mux applies realtime conversation lifecycle events from another client without creating default gateway state',
  async () => {
    const workspace = createWorkspace();
    const projectPath = join(workspace, 'project-realtime');
    const defaultGatewayRecordPath = join(workspaceRuntimeRoot(workspace), 'gateway.json');
    mkdirSync(projectPath, { recursive: true });

    const tenantId = 'tenant-realtime';
    const userId = 'user-realtime';
    const workspaceId = 'workspace-realtime';
    const worktreeId = 'worktree-realtime';
    const directoryId = 'directory-realtime';
    const conversationId = 'conversation-realtime';

    const server = await startControlPlaneStreamServer({
      stateStorePath: join(workspaceRuntimeRoot(workspace), 'control-plane.sqlite'),
      startSession: (input) => new StartupTestLiveSession(input),
    });
    const address = server.address();
    const publisherClient = await connectControlPlaneStreamClient({
      host: address.address,
      port: address.port,
    });

    const interactive = startInteractiveMuxSession(workspace, {
      controlPlaneHost: address.address,
      controlPlanePort: address.port,
      cols: 120,
      rows: 30,
      extraEnv: {
        HARNESS_TENANT_ID: tenantId,
        HARNESS_USER_ID: userId,
        HARNESS_WORKSPACE_ID: workspaceId,
        HARNESS_WORKTREE_ID: worktreeId,
      },
    });
    const muxPid = interactive.session.processId();

    try {
      assert.equal(existsSync(defaultGatewayRecordPath), false);
      await waitForSnapshotLineContaining(interactive.oracle, '🏠 home', 12000);

      await publisherClient.sendCommand({
        type: 'directory.upsert',
        directoryId,
        tenantId,
        userId,
        workspaceId,
        path: projectPath,
      });
      await publisherClient.sendCommand({
        type: 'conversation.create',
        conversationId,
        directoryId,
        title: 'rt-thread-a',
        agentType: 'terminal',
        adapterState: {},
      });
      await waitForSnapshotLineContaining(interactive.oracle, 'rt-thread-a', 8000);

      await publisherClient.sendCommand({
        type: 'conversation.update',
        conversationId,
        title: 'rt-thread-b',
      });
      await waitForSnapshotLineContaining(interactive.oracle, 'rt-thread-b', 8000);

      await publisherClient.sendCommand({
        type: 'conversation.archive',
        conversationId,
      });
      await waitForSnapshotLineNotContaining(interactive.oracle, 'rt-thread-b', 8000);

      assert.equal(existsSync(defaultGatewayRecordPath), false);
    } finally {
      try {
        await requestMuxShutdown(interactive.session);
        const exit = await interactive.waitForExit;
        assert.equal(exit.signal, null);
        assert.equal(exit.code === 0 || exit.code === 130, true);
        if (muxPid !== null) {
          assert.equal(await waitForPidExit(muxPid, 5000), true);
        }
      } finally {
        publisherClient.close();
        await server.close();
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  },
  { timeout: 30000 },
);
