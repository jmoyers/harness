import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { InputPreflight } from '../packages/harness-ui/src/interaction/input-preflight.ts';
import { extractFocusEvents } from '../src/mux/live-mux/startup-utils.ts';

void test('input preflight returns null while shutting down', () => {
  const calls: string[] = [];
  const preflight = new InputPreflight(
    {
      isShuttingDown: () => true,
      routeModalInput: () => {
        calls.push('modal');
        return false;
      },
      handleEscapeInput: () => {
        calls.push('escape');
      },
      onFocusIn: () => {
        calls.push('focus-in');
      },
      onFocusOut: () => {
        calls.push('focus-out');
      },
      handleRepositoryFoldInput: () => {
        calls.push('repo');
        return false;
      },
      handleGlobalShortcutInput: () => {
        calls.push('global');
        return false;
      },
      handleTaskPaneShortcutInput: () => {
        calls.push('task');
        return false;
      },
      handleCopyShortcutInput: () => {
        calls.push('copy');
        return false;
      },
    },
    { extractFocusEvents },
  );

  assert.equal(preflight.nextInput(Buffer.from('a')), null);
  assert.deepEqual(calls, []);
});

void test('input preflight handles modal and escape short-circuiting', () => {
  const calls: string[] = [];
  const preflight = new InputPreflight(
    {
      isShuttingDown: () => false,
      routeModalInput: (input) => {
        calls.push(`modal:${input.toString('utf8')}`);
        return input.toString('utf8') === 'm';
      },
      handleEscapeInput: () => {
        calls.push('escape');
      },
      onFocusIn: () => {},
      onFocusOut: () => {},
      handleRepositoryFoldInput: () => false,
      handleGlobalShortcutInput: () => false,
      handleTaskPaneShortcutInput: () => false,
      handleCopyShortcutInput: () => false,
    },
    { extractFocusEvents },
  );

  assert.equal(preflight.nextInput(Buffer.from('m')), null);
  assert.equal(preflight.nextInput(Buffer.from([0x1b])), null);
  assert.deepEqual(calls, ['modal:m', 'modal:\u001b', 'escape']);
});

void test('input preflight routes focus, shortcut handlers, and passthrough sanitized input', () => {
  const calls: string[] = [];
  const preflight = new InputPreflight(
    {
      isShuttingDown: () => false,
      routeModalInput: () => false,
      handleEscapeInput: () => {},
      onFocusIn: () => {
        calls.push('focus-in');
      },
      onFocusOut: () => {
        calls.push('focus-out');
      },
      handleRepositoryFoldInput: (input) => {
        calls.push(`repo:${input.toString('utf8')}`);
        return input.toString('utf8') === 'repo';
      },
      handleGlobalShortcutInput: (input) => {
        calls.push(`global:${input.toString('utf8')}`);
        return input.toString('utf8') === 'global';
      },
      handleTaskPaneShortcutInput: (input) => {
        calls.push(`task:${input.toString('utf8')}`);
        return input.toString('utf8') === 'task';
      },
      handleCopyShortcutInput: (input) => {
        calls.push(`copy:${input.toString('utf8')}`);
        return input.toString('utf8') === 'copy';
      },
    },
    {
      extractFocusEvents: (input) => {
        const text = input.toString('utf8');
        if (text === 'empty') {
          return {
            sanitized: Buffer.alloc(0),
            focusInCount: 0,
            focusOutCount: 0,
          };
        }
        if (text === 'focus') {
          return {
            sanitized: Buffer.from('pass'),
            focusInCount: 1,
            focusOutCount: 1,
          };
        }
        return {
          sanitized: Buffer.from(text),
          focusInCount: 0,
          focusOutCount: 0,
        };
      },
    },
  );

  assert.equal(preflight.nextInput(Buffer.from('empty')), null);
  assert.equal(preflight.nextInput(Buffer.from('repo')), null);
  assert.equal(preflight.nextInput(Buffer.from('global')), null);
  assert.equal(preflight.nextInput(Buffer.from('task')), null);
  assert.equal(preflight.nextInput(Buffer.from('copy')), null);
  assert.equal(preflight.nextInput(Buffer.from('focus'))?.toString('utf8'), 'pass');
  assert.equal(preflight.nextInput(Buffer.from('pass'))?.toString('utf8'), 'pass');
  assert.deepEqual(calls, [
    'repo:repo',
    'repo:global',
    'global:global',
    'repo:task',
    'global:task',
    'task:task',
    'repo:copy',
    'global:copy',
    'task:copy',
    'copy:copy',
    'focus-in',
    'focus-out',
    'repo:pass',
    'global:pass',
    'task:pass',
    'copy:pass',
    'repo:pass',
    'global:pass',
    'task:pass',
    'copy:pass',
  ]);
});

void test('input preflight default focus extraction strips focus markers', () => {
  let focusInCount = 0;
  let focusOutCount = 0;
  const preflight = new InputPreflight(
    {
      isShuttingDown: () => false,
      routeModalInput: () => false,
      handleEscapeInput: () => {},
      onFocusIn: () => {
        focusInCount += 1;
      },
      onFocusOut: () => {
        focusOutCount += 1;
      },
      handleRepositoryFoldInput: () => false,
      handleGlobalShortcutInput: () => false,
      handleTaskPaneShortcutInput: () => false,
      handleCopyShortcutInput: () => false,
    },
    { extractFocusEvents },
  );

  const sanitized = preflight.nextInput(Buffer.from('\u001b[Ia\u001b[O', 'utf8'));
  assert.equal(sanitized?.toString('utf8'), 'a');
  assert.equal(focusInCount, 1);
  assert.equal(focusOutCount, 1);
});
