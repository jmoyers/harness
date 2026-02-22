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
