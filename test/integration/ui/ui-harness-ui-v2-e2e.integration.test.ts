import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'bun:test';
import { createWorkspace } from '../../helpers/harness-cli-test-helpers.ts';
import { HarnessUiE2EDriver } from '../../support/harness-ui-e2e-driver.ts';

void test(
  'harness-ui v2 e2e driver exercises locator keyboard and mouse flows across nim + command menu',
  async () => {
    const workspace = createWorkspace();
    let driver: HarnessUiE2EDriver | null = null;
    try {
      driver = new HarnessUiE2EDriver({
        workspace,
        args: ['--session', 'ui-v2-e2e', 'client'],
        cols: 100,
        rows: 30,
      });

      await driver.locator('🏠 home').waitFor(45_000);
      await driver.locator('🦎 nim').click(30_000);
      await driver.waitForText('nim>', 30_000);
      await driver.waitForText('queued:0', 30_000);
      await driver.waitForText('nim subprocess ready', 30_000);
      driver.keyboard.type('hello from mux nim');
      driver.keyboard.press('Enter');
      await driver.waitForText('run started', 30_000);
      await driver.waitForText('run completed', 30_000);
      driver.keyboard.type('queued from nim tab');
      driver.keyboard.type('\t');
      await driver.waitForText('queued:1', 30_000);

      await driver.keyboard.openCommandMenu(30_000);
      await driver.waitForText('Command Menu', 30_000);
      driver.mouse.click(2, 2);
      await driver.waitForTextGone('Command Menu', 30_000);

      await driver.keyboard.openCommandMenu(30_000);
      await driver.waitForText('Command Menu', 30_000);
      driver.keyboard.press('Escape');
      await driver.waitForTextGone('Command Menu', 30_000);
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
  },
  { timeout: 90_000 },
);

void test(
  'harness-ui v2 e2e keeps command menu usable in constrained viewport and dismisses on outside click',
  async () => {
    const workspace = createWorkspace();
    let driver: HarnessUiE2EDriver | null = null;
    try {
      driver = new HarnessUiE2EDriver({
        workspace,
        args: ['--session', 'ui-v2-e2e-small', 'client'],
        cols: 52,
        rows: 12,
      });

      await driver.locator('🏠 home').waitFor(45_000);
      await driver.keyboard.openCommandMenu(30_000);
      await driver.waitForText('Command Menu', 30_000);
      driver.mouse.click(1, 1);
      await driver.waitForTextGone('Command Menu', 30_000);
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
  },
  { timeout: 60_000 },
);
