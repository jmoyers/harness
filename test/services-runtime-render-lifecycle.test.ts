import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createRuntimeRenderLifecycle } from '../src/services/runtime-render-lifecycle.ts';

void test('runtime render lifecycle marks dirty and schedules render until clean', () => {
  let shuttingDown = false;
  let stop = false;
  const calls: string[] = [];
  const immediateCallbacks: Array<() => void> = [];
  let dirty = false;
  let renderCount = 0;
  const lifecycle = createRuntimeRenderLifecycle({
    screen: {
      clearDirty: () => {
        dirty = false;
        calls.push('clearDirty');
      },
      isDirty: () => dirty,
      markDirty: () => {
        dirty = true;
        calls.push('markDirty');
      },
    },
    render: () => {
      renderCount += 1;
      calls.push(`render:${String(renderCount)}`);
      dirty = renderCount === 1;
    },
    isShuttingDown: () => shuttingDown,
    setShuttingDown: (next) => {
      shuttingDown = next;
    },
    setStop: (next) => {
      stop = next;
    },
    restoreTerminalState: () => {
      calls.push('restoreTerminalState');
    },
    formatErrorMessage: (error) => String(error),
    writeStderr: (text) => {
      calls.push(`stderr:${text.trim()}`);
    },
    exitProcess: (code) => {
      calls.push(`exit:${String(code)}`);
    },
    setImmediateFn: (callback) => {
      immediateCallbacks.push(callback);
    },
    setTimeoutFn: ((callback: () => void) => {
      callback();
      return {
        unref() {
          // no-op test timer
        },
      } as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
  });

  lifecycle.markDirty();
  assert.equal(calls[0], 'markDirty');
  assert.equal(immediateCallbacks.length, 1);

  immediateCallbacks.shift()?.();
  assert.equal(immediateCallbacks.length, 1);
  immediateCallbacks.shift()?.();

  assert.deepEqual(calls, ['markDirty', 'render:1', 'render:2']);
  assert.equal(stop, false);
  assert.equal(shuttingDown, false);
});

void test('runtime render lifecycle clearRenderScheduled resets pending render guard', () => {
  const immediateCallbacks: Array<() => void> = [];
  const lifecycle = createRuntimeRenderLifecycle({
    screen: {
      clearDirty: () => {},
      isDirty: () => false,
      markDirty: () => {},
    },
    render: () => {},
    isShuttingDown: () => false,
    setShuttingDown: () => {},
    setStop: () => {},
    restoreTerminalState: () => {},
    formatErrorMessage: (error) => String(error),
    writeStderr: () => {},
    exitProcess: () => {},
    setImmediateFn: (callback) => {
      immediateCallbacks.push(callback);
    },
  });

  lifecycle.markDirty();
  lifecycle.clearRenderScheduled();
  lifecycle.markDirty();

  assert.equal(immediateCallbacks.length, 2);
});

void test('runtime render lifecycle fatal path sets shutdown/stop and is idempotent', () => {
  let shuttingDown = false;
  let stop = false;
  const calls: string[] = [];
  let clearTimeoutCalls = 0;
  let timerUnrefCalls = 0;

  const lifecycle = createRuntimeRenderLifecycle({
    screen: {
      clearDirty: () => {
        calls.push('clearDirty');
      },
      isDirty: () => false,
      markDirty: () => {
        calls.push('markDirty');
      },
    },
    render: () => {
      throw new Error('render-boom');
    },
    isShuttingDown: () => shuttingDown,
    setShuttingDown: (next) => {
      shuttingDown = next;
      calls.push(`setShuttingDown:${String(next)}`);
    },
    setStop: (next) => {
      stop = next;
      calls.push(`setStop:${String(next)}`);
    },
    restoreTerminalState: () => {
      calls.push('restoreTerminalState');
    },
    formatErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
    writeStderr: (text) => {
      calls.push(`stderr:${text.trim()}`);
    },
    exitProcess: (code) => {
      calls.push(`exit:${String(code)}`);
    },
    setImmediateFn: (callback) => {
      callback();
    },
    setTimeoutFn: ((callback: () => void) => {
      callback();
      return {
        unref() {
          timerUnrefCalls += 1;
        },
      } as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {
      clearTimeoutCalls += 1;
    },
  });

  lifecycle.markDirty();
  lifecycle.handleRuntimeFatal('manual', new Error('ignored')); // ignored after first fatal

  assert.equal(lifecycle.hasFatal(), true);
  assert.equal(shuttingDown, true);
  assert.equal(stop, true);
  assert.equal(timerUnrefCalls, 1);

  lifecycle.clearRuntimeFatalExitTimer();

  assert.deepEqual(calls, [
    'markDirty',
    'setShuttingDown:true',
    'setStop:true',
    'clearDirty',
    'stderr:[mux] fatal runtime error (render): render-boom',
    'restoreTerminalState',
    'stderr:[mux] fatal runtime error forced exit',
    'exit:1',
  ]);
  assert.equal(clearTimeoutCalls, 1);
});
