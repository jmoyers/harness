import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  MuxUiStatePersistence,
  type MuxUiStateSnapshot,
} from '../../../src/services/mux-ui-state-persistence.ts';

const INITIAL_STATE: MuxUiStateSnapshot = {
  paneWidthPercent: 40,
  repositoriesCollapsed: false,
  shortcutsCollapsed: false,
  startupPane: 'home',
  showDebugBar: false,
};

void test('mux ui state persistence debounces queue and persists latest state', () => {
  const persisted: MuxUiStateSnapshot[] = [];
  const applied: MuxUiStateSnapshot[] = [];
  const cleared: number[] = [];
  let scheduledCallback: (() => void) | null = null;
  const muxUiStatePersistence = new MuxUiStatePersistence({
    enabled: true,
    initialState: INITIAL_STATE,
    debounceMs: 50,
    persistState: (pending) => {
      persisted.push(pending);
      return pending;
    },
    applyState: (state) => {
      applied.push(state);
    },
    writeStderr: () => {},
    setTimeoutFn: (callback) => {
      scheduledCallback = callback;
      return { id: 1 } as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: () => {
      cleared.push(1);
    },
  });

  muxUiStatePersistence.queue({
    paneWidthPercent: 41,
    repositoriesCollapsed: true,
    shortcutsCollapsed: false,
    startupPane: 'home',
    showDebugBar: false,
  });
  muxUiStatePersistence.queue({
    paneWidthPercent: 42,
    repositoriesCollapsed: true,
    shortcutsCollapsed: true,
    startupPane: 'nim',
    showDebugBar: true,
  });

  assert.deepEqual(cleared, [1]);
  if (scheduledCallback === null) {
    throw new Error('missing scheduled callback');
  }
  (scheduledCallback as () => void)();

  assert.deepEqual(persisted, [
    {
      paneWidthPercent: 42,
      repositoriesCollapsed: true,
      shortcutsCollapsed: true,
      startupPane: 'nim',
      showDebugBar: true,
    },
  ]);
  assert.deepEqual(applied, [
    {
      paneWidthPercent: 42,
      repositoriesCollapsed: true,
      shortcutsCollapsed: true,
      startupPane: 'nim',
      showDebugBar: true,
    },
  ]);
});

void test('mux ui state persistence skips unchanged state writes', () => {
  let persistedCalls = 0;
  let applyCalls = 0;
  const muxUiStatePersistence = new MuxUiStatePersistence({
    enabled: true,
    initialState: INITIAL_STATE,
    debounceMs: 10,
    persistState: (pending) => {
      persistedCalls += 1;
      return pending;
    },
    applyState: () => {
      applyCalls += 1;
    },
    writeStderr: () => {},
    setTimeoutFn: () => ({ id: 2 }) as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
  });

  muxUiStatePersistence.queue(INITIAL_STATE);
  muxUiStatePersistence.persistNow();

  assert.equal(persistedCalls, 0);
  assert.equal(applyCalls, 0);
});

void test('mux ui state persistence no-ops when disabled', () => {
  let persistedCalls = 0;
  let applyCalls = 0;
  let scheduledCalls = 0;
  const muxUiStatePersistence = new MuxUiStatePersistence({
    enabled: false,
    initialState: INITIAL_STATE,
    debounceMs: 10,
    persistState: (pending) => {
      persistedCalls += 1;
      return pending;
    },
    applyState: () => {
      applyCalls += 1;
    },
    writeStderr: () => {},
    setTimeoutFn: () => {
      scheduledCalls += 1;
      return { id: 3 } as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: () => {},
  });

  muxUiStatePersistence.queue({
    paneWidthPercent: 55,
    repositoriesCollapsed: true,
    shortcutsCollapsed: false,
    startupPane: 'home',
    showDebugBar: true,
  });
  muxUiStatePersistence.persistNow();

  assert.equal(persistedCalls, 0);
  assert.equal(applyCalls, 0);
  assert.equal(scheduledCalls, 0);
});

void test('mux ui state persistence reports persist failures', () => {
  const stderr: string[] = [];
  const muxUiStatePersistence = new MuxUiStatePersistence({
    enabled: true,
    initialState: INITIAL_STATE,
    debounceMs: 10,
    persistState: () => {
      throw new Error('write failed');
    },
    applyState: () => {},
    writeStderr: (text) => {
      stderr.push(text);
    },
    setTimeoutFn: () => ({ id: 4 }) as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
  });

  muxUiStatePersistence.queue({
    paneWidthPercent: 60,
    repositoriesCollapsed: true,
    shortcutsCollapsed: false,
    startupPane: 'nim',
    showDebugBar: true,
  });
  muxUiStatePersistence.persistNow();

  assert.deepEqual(stderr, ['[config] unable to persist mux ui state: write failed\n']);
});

void test('mux ui state persistence reports non-error failures', () => {
  const stderr: string[] = [];
  const muxUiStatePersistence = new MuxUiStatePersistence({
    enabled: true,
    initialState: INITIAL_STATE,
    debounceMs: 10,
    persistState: () => {
      throw 'bad write';
    },
    applyState: () => {},
    writeStderr: (text) => {
      stderr.push(text);
    },
    setTimeoutFn: () => ({ id: 5 }) as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
  });

  muxUiStatePersistence.queue({
    paneWidthPercent: 61,
    repositoriesCollapsed: false,
    shortcutsCollapsed: false,
    startupPane: 'home',
    showDebugBar: true,
  });
  muxUiStatePersistence.persistNow();

  assert.deepEqual(stderr, ['[config] unable to persist mux ui state: bad write\n']);
});
