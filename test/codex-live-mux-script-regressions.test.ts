import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

void test('codex-live-mux script no longer references removed inline control-plane queue bindings', () => {
  const scriptPath = resolve(process.cwd(), 'scripts/codex-live-mux.ts');
  const source = readFileSync(scriptPath, 'utf8');

  assert.equal(source.includes('interactiveControlPlaneQueue.length'), false);
  assert.equal(source.includes('backgroundControlPlaneQueue.length'), false);
  assert.equal(source.includes('controlPlaneOpRunning ? 1 : 0'), false);
  assert.equal(source.includes('controlPlaneQueue.metrics()'), true);
});
