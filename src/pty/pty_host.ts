import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPerfCoreEnabled,
  perfNowNs,
  recordPerfDuration,
  recordPerfEvent,
  startPerfSpan,
} from '../perf/perf-core.ts';

const OPCODE_DATA = 0x01;
const OPCODE_RESIZE = 0x02;
const OPCODE_CLOSE = 0x03;

const DEFAULT_COMMAND = '/bin/sh';
const DEFAULT_COMMAND_ARGS = ['-i'];
const DEFAULT_HELPER_PATH_CANDIDATES = [
  join(dirname(fileURLToPath(import.meta.url)), '../../native/ptyd/target/release/ptyd'),
  join(dirname(fileURLToPath(import.meta.url)), '../../bin/ptyd'),
] as const;

interface StartPtySessionOptions {
  command?: string;
  commandArgs?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  helperPath?: string;
  initialCols?: number;
  initialRows?: number;
}

export interface PtyExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export function resolvePtyHelperPath(
  helperPath: string | undefined,
  helperPathCandidates: readonly string[] = DEFAULT_HELPER_PATH_CANDIDATES,
  pathExists: (path: string) => boolean = existsSync,
): string {
  if (typeof helperPath === 'string' && helperPath.length > 0) {
    return helperPath;
  }
  for (const candidate of helperPathCandidates) {
    if (pathExists(candidate)) {
      return candidate;
    }
  }
  const fallback = helperPathCandidates[0];
  if (fallback === undefined) {
    throw new Error('pty helper path candidates must include at least one path');
  }
  return fallback;
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
  private static readonly MAX_PENDING_ROUNDTRIP_PROBES = 64;
  private static readonly ROUNDTRIP_PROBE_MAX_AGE_NS = 5_000_000_000n;

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
        startedAtNs: perfNowNs(),
      });
      if (this.pendingRoundtripProbes.length > PtySession.MAX_PENDING_ROUNDTRIP_PROBES) {
        this.pendingRoundtripProbes.splice(
          0,
          this.pendingRoundtripProbes.length - PtySession.MAX_PENDING_ROUNDTRIP_PROBES,
        );
      }
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

  processId(): number | null {
    return typeof this.child.pid === 'number' ? this.child.pid : null;
  }

  private trackRoundtrip(chunk: Buffer): void {
    if (!isPerfCoreEnabled()) {
      return;
    }

    recordPerfEvent('pty.stdout.chunk', { bytes: chunk.length });

    if (this.pendingRoundtripProbes.length === 0) {
      return;
    }

    this.outputWindow =
      this.outputWindow.length === 0
        ? Buffer.from(chunk)
        : Buffer.concat([this.outputWindow, chunk]);
    if (this.outputWindow.length > PtySession.MAX_OUTPUT_WINDOW_BYTES) {
      this.outputWindow = this.outputWindow.subarray(
        this.outputWindow.length - PtySession.MAX_OUTPUT_WINDOW_BYTES,
      );
    }

    const maxMatchPayloadLength = this.compactPendingRoundtripProbes(perfNowNs());
    if (this.pendingRoundtripProbes.length === 0) {
      return;
    }
    const searchWindowLength = Math.max(
      1,
      Math.min(this.outputWindow.length, chunk.length + Math.max(1, maxMatchPayloadLength) - 1),
    );
    const searchWindow = this.outputWindow.subarray(this.outputWindow.length - searchWindowLength);

    let idx = 0;
    while (idx < this.pendingRoundtripProbes.length) {
      const probe = this.pendingRoundtripProbes[idx];
      if (
        probe !== undefined &&
        probe.matchPayloads.some((matchPayload) => searchWindow.includes(matchPayload))
      ) {
        recordPerfDuration('pty.keystroke.roundtrip', probe.startedAtNs, {
          'probe-id': probe.probeId,
          bytes: probe.payloadLength,
        });
        this.pendingRoundtripProbes.splice(idx, 1);
        continue;
      }
      idx += 1;
    }
  }

  private compactPendingRoundtripProbes(nowNs: bigint): number {
    if (this.pendingRoundtripProbes.length > PtySession.MAX_PENDING_ROUNDTRIP_PROBES) {
      this.pendingRoundtripProbes.splice(
        0,
        this.pendingRoundtripProbes.length - PtySession.MAX_PENDING_ROUNDTRIP_PROBES,
      );
    }
    let maxMatchPayloadLength = 1;
    let idx = 0;
    while (idx < this.pendingRoundtripProbes.length) {
      const probe = this.pendingRoundtripProbes[idx];
      if (probe === undefined) {
        idx += 1;
        continue;
      }
      if (nowNs - probe.startedAtNs > PtySession.ROUNDTRIP_PROBE_MAX_AGE_NS) {
        this.pendingRoundtripProbes.splice(idx, 1);
        continue;
      }
      for (const matchPayload of probe.matchPayloads) {
        maxMatchPayloadLength = Math.max(maxMatchPayloadLength, matchPayload.length);
      }
      idx += 1;
    }
    return maxMatchPayloadLength;
  }

  private static buildMatchPayloads(payload: Buffer): Buffer[] {
    if (!payload.includes(0x0a)) {
      return [payload];
    }

    const crlfPayload = Buffer.alloc(
      payload.length + payload.filter((byte) => byte === 0x0a).length,
    );
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
  const cwd = options.cwd;
  const helperPath = resolvePtyHelperPath(options.helperPath);

  const child = spawn(helperPath, [command, ...commandArgs], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const session = new PtySession(child);
  if (
    typeof options.initialCols === 'number' &&
    Number.isFinite(options.initialCols) &&
    options.initialCols > 0 &&
    typeof options.initialRows === 'number' &&
    Number.isFinite(options.initialRows) &&
    options.initialRows > 0
  ) {
    session.resize(Math.floor(options.initialCols), Math.floor(options.initialRows));
  }

  return session;
}
