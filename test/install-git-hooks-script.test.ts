import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const INSTALL_HOOKS_SCRIPT_PATH = resolve(process.cwd(), 'scripts/install-git-hooks.sh');
const PRE_COMMIT_TEMPLATE_PATH = resolve(process.cwd(), '.githooks/pre-commit');

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runInstallHookScript(cwd: string, scriptPath: string): RunResult {
  const result = spawnSync('/bin/bash', [scriptPath], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function createWorkspace(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeInstallerScript(workspace: string): string {
  const scriptDirPath = join(workspace, 'scripts');
  mkdirSync(scriptDirPath, { recursive: true });
  const scriptPath = join(scriptDirPath, 'install-git-hooks.sh');
  writeFileSync(scriptPath, readFileSync(INSTALL_HOOKS_SCRIPT_PATH, 'utf8'), 'utf8');
  return scriptPath;
}

test('install-git-hooks.sh is a no-op outside git work trees', () => {
  const workspace = createWorkspace('harness-install-hooks-no-git-');
  try {
    const scriptPath = writeInstallerScript(workspace);
    const result = runInstallHookScript(workspace, scriptPath);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('install-git-hooks.sh configures local hooks path and sets pre-commit executable', () => {
  const workspace = createWorkspace('harness-install-hooks-configure-');
  try {
    execFileSync('git', ['init', '-q'], { cwd: workspace });
    mkdirSync(join(workspace, '.githooks'), { recursive: true });
    const preCommitPath = join(workspace, '.githooks/pre-commit');
    writeFileSync(preCommitPath, readFileSync(PRE_COMMIT_TEMPLATE_PATH, 'utf8'), 'utf8');
    chmodSync(preCommitPath, 0o644);
    const scriptPath = writeInstallerScript(workspace);

    const result = runInstallHookScript(workspace, scriptPath);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');

    const hooksPath = execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
      cwd: workspace,
      encoding: 'utf8',
    }).trim();
    assert.equal(hooksPath, '.githooks');
    assert.notEqual(statSync(preCommitPath).mode & 0o111, 0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('install-git-hooks.sh fails closed when pre-commit hook is missing', () => {
  const workspace = createWorkspace('harness-install-hooks-missing-hook-');
  try {
    execFileSync('git', ['init', '-q'], { cwd: workspace });
    mkdirSync(join(workspace, '.githooks'), { recursive: true });
    const scriptPath = writeInstallerScript(workspace);

    const result = runInstallHookScript(workspace, scriptPath);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\[hooks\] missing pre-commit hook/u);

    const hooksPathResult = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env },
    });
    assert.notEqual(hooksPathResult.status, 0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
