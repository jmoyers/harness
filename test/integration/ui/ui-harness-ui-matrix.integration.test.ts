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
}

const SCENARIOS: readonly MatrixScenario[] = [
  {
    name: 'standard viewport keyboard dismissal',
    cols: 100,
    rows: 30,
    dismissMode: 'escape',
  },
  {
    name: 'compact viewport pointer dismissal',
    cols: 52,
    rows: 12,
    dismissMode: 'outside-click',
  },
];
const WAIT_MS = 12_000;

const MOCK_ENV = { ANTHROPIC_API_KEY: undefined } as const;
const NIM_LANDING_MARKERS = ['[Build]', '[Setup]'] as const;

async function waitForAnyNimLandingText(
  driver: HarnessUiE2EDriver,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const lines = driver.snapshotLines();
    for (const marker of NIM_LANDING_MARKERS) {
      if (lines.some((line) => line.includes(marker))) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(
    `timed out waiting for any nim landing marker: ${NIM_LANDING_MARKERS.join(', ')}`,
  );
}

async function openNimPane(driver: HarnessUiE2EDriver, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  let lastLines: readonly string[] = [];
  while (Date.now() - startedAt < timeoutMs) {
    await driver.locator('🦎 nim').click(timeoutMs);
    lastLines = driver.snapshotLines();
    try {
      await waitForAnyNimLandingText(driver, 1_200);
      return;
    } catch {
      // Keep retrying; a click can be dropped during startup refresh.
    }
  }
  throw new Error(`timed out opening nim pane; last snapshot: ${lastLines.join(' | ')}`);
}

void test(
  'harness-ui matrix keeps command menu and nim pane behavior stable across viewport and input modes',
  async () => {
    for (const scenario of SCENARIOS) {
      const workspace = createWorkspace();
      let driver: HarnessUiE2EDriver | null = null;
      try {
        driver = new HarnessUiE2EDriver({
          workspace,
          args: ['client', '--session', `ui-matrix-${scenario.cols}x${scenario.rows}`],
          cols: scenario.cols,
          rows: scenario.rows,
          env: MOCK_ENV,
        });

        await driver.locator('🏠 home').waitFor(WAIT_MS);
        await openNimPane(driver, WAIT_MS);

        await driver.keyboard.openCommandMenu(WAIT_MS);
        await driver.waitForText('Command Menu', WAIT_MS);
        if (scenario.dismissMode === 'escape') {
          driver.keyboard.press('Escape');
        } else {
          driver.mouse.click(1, 1);
        }
        await driver.waitForTextGone('Command Menu', WAIT_MS);
      } finally {
        try {
          if (driver !== null) {
            const exit = await driver.close();
            assert.equal(exit.signal, null);
            assert.equal(
              exit.code === 0 ||
                exit.code === 1 ||
                exit.code === 2 ||
                exit.code === 129 ||
                exit.code === 130,
              true,
            );
          }
        } finally {
          rmSync(workspace, { recursive: true, force: true });
        }
      }
    }
  },
  { timeout: 90_000 },
);
