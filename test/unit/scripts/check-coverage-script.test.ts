import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'bun:test';

function createCoverageWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-check-coverage-'));
  mkdirSync(resolve(root, 'src', 'example'), { recursive: true });
  writeFileSync(resolve(root, 'src', 'example', 'target.ts'), 'export const target = 1;\n', 'utf8');
  writeFileSync(
    resolve(root, 'coverage.jsonc'),
    JSON.stringify(
      {
        include: ['src/**/*.ts'],
        global: {
          lines: 100,
          functions: 100,
          branches: 100,
        },
        perFileDefault: {
          lines: 0,
          functions: 0,
          branches: 0,
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  return root;
}

function runCoverageCheck(cwd: string): { exitCode: number; stdout: string; stderr: string } {
  const scriptPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../scripts/check-coverage.ts',
  );
  const result = spawnSync(
    process.execPath,
    [scriptPath, '--lcov', resolve(cwd, 'lcov.info'), '--config', resolve(cwd, 'coverage.jsonc')],
    {
      cwd,
      encoding: 'utf8',
    },
  );
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

test('check-coverage ignores aggregate function counts when LCOV omits FN/FNDA details', () => {
  const cwd = createCoverageWorkspace();
  writeFileSync(
    resolve(cwd, 'lcov.info'),
    [
      'SF:src/example/target.ts',
      'FNF:1',
      'FNH:0',
      'LF:1',
      'LH:1',
      'BRF:0',
      'BRH:0',
      'DA:1,1',
      'end_of_record',
      '',
    ].join('\n'),
    'utf8',
  );

  const result = runCoverageCheck(cwd);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.includes('coverage check passed'), true);
});

test('check-coverage fails function gate when FN/FNDA details show misses', () => {
  const cwd = createCoverageWorkspace();
  writeFileSync(
    resolve(cwd, 'lcov.info'),
    [
      'SF:src/example/target.ts',
      'FN:1,targetFn',
      'FNDA:0,targetFn',
      'FNF:1',
      'FNH:0',
      'LF:1',
      'LH:1',
      'BRF:0',
      'BRH:0',
      'DA:1,1',
      'end_of_record',
      '',
    ].join('\n'),
    'utf8',
  );

  const result = runCoverageCheck(cwd);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.includes('global functions 0.00 < 100.00'), true);
});
