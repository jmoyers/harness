import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  runTerminalDifferentialCase,
  runTerminalDifferentialSuite,
  type TerminalDifferentialCase,
  type TerminalDifferentialCaseResult,
  type TerminalDifferentialCheckpointResult,
  type TerminalDifferentialSuiteResult,
} from '../../../src/terminal/differential-checkpoints.ts';
import { replayTerminalSteps } from '../../../src/terminal/snapshot-oracle.ts';

function firstFrameHash(
  scenario: Pick<TerminalDifferentialCase, 'steps' | 'cols' | 'rows'>,
): string {
  return replayTerminalSteps(scenario.steps, scenario.cols, scenario.rows)[0]!.frameHash;
}

void test('terminal differential case passes when harness hashes match checkpoints', () => {
  const scenario: TerminalDifferentialCase = {
    id: 'pass-basic',
    cols: 8,
    rows: 2,
    steps: [{ kind: 'output', chunk: 'abc' }],
    checkpoints: [
      {
        id: 'cp-1',
        stepIndex: 0,
        directFrameHash: '',
      },
    ],
  };

  const directFrameHash = firstFrameHash(scenario);
  const resolved: TerminalDifferentialCase = {
    ...scenario,
    checkpoints: [{ ...scenario.checkpoints[0]!, directFrameHash }],
  };

  const result: TerminalDifferentialCaseResult = runTerminalDifferentialCase(resolved);
  assert.equal(result.pass, true);
  assert.deepEqual(result.checkpointResults[0]?.reasons, []);
  assert.equal(result.checkpointResults[0]?.harnessFrameHash, directFrameHash);
});

void test('terminal differential case surfaces missing steps and hash/diff mismatches', () => {
  const scenario: TerminalDifferentialCase = {
    id: 'failing-case',
    cols: 8,
    rows: 2,
    steps: [{ kind: 'output', chunk: 'abc' }],
    checkpoints: [
      {
        id: 'cp-missing-step',
        stepIndex: 2,
        directFrameHash: 'missing',
      },
      {
        id: 'cp-hash-mismatch',
        stepIndex: 0,
        directFrameHash: 'wrong-hash',
      },
      {
        id: 'cp-frame-diff',
        stepIndex: 0,
        directFrameHash: '',
      },
    ],
  };

  const frame = replayTerminalSteps(scenario.steps, scenario.cols, scenario.rows)[0]!;
  const mismatchedDirectFrame = {
    ...frame,
    cursor: {
      ...frame.cursor,
      col: frame.cursor.col + 1,
    },
  };

  const resolved: TerminalDifferentialCase = {
    ...scenario,
    checkpoints: [
      scenario.checkpoints[0]!,
      scenario.checkpoints[1]!,
      {
        ...scenario.checkpoints[2]!,
        directFrameHash: frame.frameHash,
        directFrame: mismatchedDirectFrame,
      },
    ],
  };

  const result: TerminalDifferentialCaseResult = runTerminalDifferentialCase(resolved);
  assert.equal(result.pass, false);

  const byId = new Map<string, TerminalDifferentialCheckpointResult>(
    result.checkpointResults.map((checkpoint) => [checkpoint.id, checkpoint]),
  );

  assert.deepEqual(byId.get('cp-missing-step')?.reasons, ['checkpoint-step-missing']);
  assert.deepEqual(byId.get('cp-hash-mismatch')?.reasons, ['frame-hash-mismatch']);
  assert.equal(
    byId.get('cp-frame-diff')?.reasons.includes('frame-diff:cursor-position-mismatch'),
    true,
  );
});

void test('terminal differential suite summarizes case and checkpoint failures', () => {
  const passScenario: TerminalDifferentialCase = {
    id: 'suite-pass',
    cols: 8,
    rows: 2,
    steps: [{ kind: 'output', chunk: 'pass' }],
    checkpoints: [
      {
        id: 'cp-pass',
        stepIndex: 0,
        directFrameHash: '',
      },
    ],
  };
  const passHash = firstFrameHash(passScenario);

  const failScenario: TerminalDifferentialCase = {
    id: 'suite-fail',
    cols: 8,
    rows: 2,
    steps: [{ kind: 'output', chunk: 'fail' }],
    checkpoints: [
      {
        id: 'cp-fail',
        stepIndex: 0,
        directFrameHash: 'mismatch',
      },
    ],
  };

  const suiteResult: TerminalDifferentialSuiteResult = runTerminalDifferentialSuite([
    {
      ...passScenario,
      checkpoints: [{ ...passScenario.checkpoints[0]!, directFrameHash: passHash }],
    },
    failScenario,
  ]);

  assert.equal(suiteResult.pass, false);
  assert.equal(suiteResult.totalCases, 2);
  assert.equal(suiteResult.passedCases, 1);
  assert.equal(suiteResult.failedCases, 1);
  assert.equal(suiteResult.totalCheckpoints, 2);
  assert.equal(suiteResult.failedCheckpoints, 1);

  const emptySuite = runTerminalDifferentialSuite([]);
  assert.deepEqual(emptySuite, {
    pass: true,
    totalCases: 0,
    passedCases: 0,
    failedCases: 0,
    totalCheckpoints: 0,
    failedCheckpoints: 0,
    caseResults: [],
  });
});
