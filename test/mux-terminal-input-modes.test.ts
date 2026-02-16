import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  DISABLE_MUX_INPUT_MODES,
  ENABLE_MUX_INPUT_MODES,
  createMuxInputModeManager
} from '../src/mux/terminal-input-modes.ts';

void test('mux input mode manager enables once and tracks state', () => {
  const writes: string[] = [];
  const manager = createMuxInputModeManager((sequence) => {
    writes.push(sequence);
  });

  assert.equal(manager.isEnabled(), false);
  manager.enable();
  assert.equal(manager.isEnabled(), true);
  assert.deepEqual(writes, [ENABLE_MUX_INPUT_MODES]);

  manager.enable();
  assert.equal(manager.isEnabled(), true);
  assert.deepEqual(writes, [ENABLE_MUX_INPUT_MODES]);
});

void test('mux input mode manager restore always emits disable sequence and resets state', () => {
  const writes: string[] = [];
  const manager = createMuxInputModeManager((sequence) => {
    writes.push(sequence);
  });

  manager.restore();
  assert.equal(manager.isEnabled(), false);
  manager.enable();
  assert.equal(manager.isEnabled(), true);
  manager.restore();
  assert.equal(manager.isEnabled(), false);
  manager.restore();

  assert.deepEqual(writes, [
    DISABLE_MUX_INPUT_MODES,
    ENABLE_MUX_INPUT_MODES,
    DISABLE_MUX_INPUT_MODES,
    DISABLE_MUX_INPUT_MODES
  ]);
});
