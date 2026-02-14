import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPerfCoreEnabled,
  perfNowNs,
  recordPerfDuration,
  recordPerfEvent,
  startPerfSpan
} from '../perf/perf-core.ts';

const OPCODE_DATA = 0x01;
const OPCODE_RESIZE = 0x02;
const OPCODE_CLOSE = 0x03;

const DEFAULT_COMMAND = '/bin/sh';
const DEFAULT_COMMAND_ARGS = ['-i'];
const DEFAULT_HELPER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../native/ptyd/target/release/ptyd'
);

interface StartPtySessionOptions {
  command?: string;
  commandArgs?: string[];
  env?: NodeJS.ProcessEnv;
  helperPath?: string;
}

export interface PtyExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

class PtySession extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pendingRoundtripProbes: Array<{
    probeId: number;
    payloadLength: number;
    matchPayloads: Buffer[];
    startedAtNs: bigint;
  }> = [];
  private nextProbeId = 1;
  private outputWindow = Buffer.alloc(0);
  private static readonly MAX_OUTPUT_WINDOW_BYTES = 8192;

  constructor(child: ChildProcessWithoutNullStreams) {
    super();
    this.child = child;

    child.stdout.on('data', (chunk: Buffer) => {
      this.emit('data', chunk);
      this.trackRoundtrip(chunk);
    });

    child.on('error', (error: Error) => {
      this.emit('error', error);
    });

    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.emit('exit', { code, signal } satisfies PtyExit);
    });
  }

  write(data: string | Uint8Array): void {
    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const frame = Buffer.alloc(1 + 4 + payload.length);
    frame[0] = OPCODE_DATA;
    frame.writeUInt32BE(payload.length, 1);
    payload.copy(frame, 5);

    if (isPerfCoreEnabled() && payload.length > 0 && payload.length <= 256) {
      this.pendingRoundtripProbes.push({
        probeId: this.nextProbeId,
        payloadLength: payload.length,
        matchPayloads: PtySession.buildMatchPayloads(payload),
        startedAtNs: perfNowNs()
      });
      this.nextProbeId += 1;
    }

    const span = startPerfSpan('pty.stdin.write', { bytes: payload.length });
    this.child.stdin.write(frame, () => {
      span.end();
    });
  }

  resize(cols: number, rows: number): void {
    const frame = Buffer.alloc(1 + 2 + 2);
    frame[0] = OPCODE_RESIZE;
    frame.writeUInt16BE(cols, 1);
    frame.writeUInt16BE(rows, 3);
    this.child.stdin.write(frame);
  }

  close(): void {
    const frame = Buffer.from([OPCODE_CLOSE]);
    this.child.stdin.write(frame);
  }

  private trackRoundtrip(chunk: Buffer): void {
    if (!isPerfCoreEnabled()) {
      return;
    }

    recordPerfEvent('pty.stdout.chunk', { bytes: chunk.length });

    if (this.pendingRoundtripProbes.length === 0) {
      return;
    }

    this.outputWindow = this.outputWindow.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([this.outputWindow, chunk]);
    if (this.outputWindow.length > PtySession.MAX_OUTPUT_WINDOW_BYTES) {
      this.outputWindow = this.outputWindow.subarray(
        this.outputWindow.length - PtySession.MAX_OUTPUT_WINDOW_BYTES
      );
    }

    let idx = 0;
    while (idx < this.pendingRoundtripProbes.length) {
      const probe = this.pendingRoundtripProbes[idx];
      if (
        probe !== undefined &&
        probe.matchPayloads.some((matchPayload) => this.outputWindow.includes(matchPayload))
      ) {
        recordPerfDuration('pty.keystroke.roundtrip', probe.startedAtNs, {
          'probe-id': probe.probeId,
          bytes: probe.payloadLength
        });
        this.pendingRoundtripProbes.splice(idx, 1);
        continue;
      }
      idx += 1;
    }
  }

  private static buildMatchPayloads(payload: Buffer): Buffer[] {
    if (!payload.includes(0x0a)) {
      return [payload];
    }

    const crlfPayload = Buffer.alloc(payload.length + payload.filter((byte) => byte === 0x0a).length);
    let writeIdx = 0;
    for (const byte of payload.values()) {
      if (byte === 0x0a) {
        crlfPayload[writeIdx] = 0x0d;
        writeIdx += 1;
      }
      crlfPayload[writeIdx] = byte;
      writeIdx += 1;
    }

    return [payload, crlfPayload];
  }
}

export function startPtySession(options: StartPtySessionOptions = {}): PtySession {
  const command = options.command ?? DEFAULT_COMMAND;
  const commandArgs = options.commandArgs ?? DEFAULT_COMMAND_ARGS;
  const env = options.env ?? process.env;
  const helperPath = options.helperPath ?? DEFAULT_HELPER_PATH;

  const child = spawn(
    helperPath,
    [command, ...commandArgs],
    {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );

  return new PtySession(child);
}
