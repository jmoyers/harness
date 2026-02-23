import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'bun:test';
import { createWorkspace } from '../../helpers/harness-cli-test-helpers.ts';
import { HarnessUiE2EDriver } from '../../support/harness-ui-e2e-driver.ts';

interface MatrixScenario {
  readonly name: string;
  readonly cols: number;
  readonly rows: number;
  readonly dismissMode: 'escape' | 'outside-click';
  readonly exerciseNimRun: boolean;
}

const SCENARIOS: readonly MatrixScenario[] = [
  {
    name: 'standard viewport keyboard dismissal',
    cols: 100,
    rows: 30,
    dismissMode: 'escape',
    exerciseNimRun: true,
  },
  {
    name: 'compact viewport pointer dismissal',
    cols: 52,
    rows: 12,
    dismissMode: 'outside-click',
    exerciseNimRun: false,
  },
];
const WAIT_MS = 12_000;

const MOCK_ENV = { ANTHROPIC_API_KEY: undefined } as const;

void test(
  'harness-ui v2 matrix keeps command menu and nim pane behavior stable across viewport and input modes',
  async () => {
    for (const scenario of SCENARIOS) {
      const workspace = createWorkspace();
      let driver: HarnessUiE2EDriver | null = null;
      try {
        driver = new HarnessUiE2EDriver({
          workspace,
          args: ['--session', `ui-v2-matrix-${scenario.cols}x${scenario.rows}`, 'client'],
          cols: scenario.cols,
          rows: scenario.rows,
          env: MOCK_ENV,
        });

        await driver.locator('🏠 home').waitFor(WAIT_MS);

        await driver.keyboard.openCommandMenu(WAIT_MS);
        await driver.waitForText('Command Menu', WAIT_MS);
        if (scenario.dismissMode === 'escape') {
          driver.keyboard.press('Escape');
        } else {
          driver.mouse.click(1, 1);
        }
        await driver.waitForTextGone('Command Menu', WAIT_MS);

        await driver.locator('🦎 nim').click(WAIT_MS);
        await driver.waitForText('nim>', WAIT_MS);
        if (scenario.exerciseNimRun) {
          await driver.waitForOutputText('nim subprocess ready', WAIT_MS);
          driver.keyboard.type(`matrix ${scenario.name}`);
          driver.keyboard.press('Enter');
          await driver.waitForOutputText('run started', WAIT_MS);
          await driver.waitForOutputText('run completed', WAIT_MS);
        }
      } finally {
        try {
          if (driver !== null) {
            const exit = await driver.close();
            assert.equal(exit.signal, null);
            assert.equal(exit.code === 0 || exit.code === 130, true);
          }
        } finally {
          rmSync(workspace, { recursive: true, force: true });
        }
      }
    }
  },
  { timeout: 90_000 },
);
