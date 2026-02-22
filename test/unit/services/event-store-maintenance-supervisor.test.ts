import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'bun:test';
import { EventStoreMaintenanceSupervisor } from '../../../src/services/event-store-maintenance-supervisor.ts';
import type { EventStoreMaintenanceDaemonMessage } from '../../../src/storage/event-store-maintenance-daemon.ts';

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killedSignals: NodeJS.Signals[] = [];
  exitOnSigterm = true;

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killedSignals.push(signal);
    if (signal === 'SIGKILL' || this.exitOnSigterm) {
      this.emit('exit', 0, signal);
    }
    return true;
  }
}

void test('event-store maintenance supervisor spawns daemon and parses streamed messages', async () => {
  const fakeChild = new FakeChildProcess();
  const parsedMessages: EventStoreMaintenanceDaemonMessage[] = [];
  const stderrMessages: string[] = [];
  let spawnCount = 0;
  let spawnedCommand = '';
  let spawnedArgs: readonly string[] = [];
  const supervisor = new EventStoreMaintenanceSupervisor({
    daemonScriptPath: '/tmp/event-store-maintenance-daemon.ts',
    daemonOptions: {
      storePath: '/tmp/events.sqlite',
      policy: {
        maintenanceIntervalMs: 5_000,
      },
    },
    onMessage: (message) => {
      parsedMessages.push(message);
    },
    writeStderr: (text) => {
      stderrMessages.push(text);
    },
    spawnFn: (command, args) => {
      spawnCount += 1;
      spawnedCommand = command;
      spawnedArgs = args;
      return fakeChild as unknown as ChildProcess;
    },
    commandPath: '/usr/local/bin/bun',
  });

  supervisor.start();
  supervisor.start();
  assert.equal(spawnCount, 1);
  assert.equal(spawnedCommand, '/usr/local/bin/bun');
  assert.equal(spawnedArgs[0], '/tmp/event-store-maintenance-daemon.ts');
  assert.ok(spawnedArgs.includes('--parent-pid'));

  fakeChild.stdout.write(
    `${JSON.stringify({ type: 'daemon.started', ts: '2026-02-22T21:00:00.000Z', maintenanceIntervalMs: 5000 })}\n`,
  );
  fakeChild.stdout.write('not-json\n');
  fakeChild.stderr.write('worker stderr line\n');
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(parsedMessages.length, 1);
  assert.equal(parsedMessages[0]?.type, 'daemon.started');
  assert.ok(stderrMessages.some((text) => text.includes('ignoring malformed daemon message')));
  assert.ok(stderrMessages.some((text) => text.includes('worker stderr line')));

  supervisor.stop();
  assert.equal(fakeChild.killedSignals[0], 'SIGTERM');
});

void test('event-store maintenance supervisor force-kills stuck daemon on stop', async () => {
  const fakeChild = new FakeChildProcess();
  fakeChild.exitOnSigterm = false;
  const supervisor = new EventStoreMaintenanceSupervisor({
    daemonScriptPath: '/tmp/event-store-maintenance-daemon.ts',
    daemonOptions: {
      storePath: '/tmp/events.sqlite',
      policy: {},
    },
    onMessage: () => {},
    writeStderr: () => {},
    spawnFn: () => fakeChild as unknown as ChildProcess,
    forceKillAfterMs: 1,
  });

  supervisor.start();
  supervisor.stop();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(fakeChild.killedSignals, ['SIGTERM', 'SIGKILL']);
});
