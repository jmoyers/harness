import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPtySession, type PtyExit } from '../src/pty/pty_host.ts';

const OPCODE_DATA = 0x01;
const OPCODE_CLOSE = 0x03;
const DEFAULT_SAMPLE_COUNT = 400;
const DEFAULT_TIMEOUT_MS = 3000;

interface PercentilesMs {
  p50: number;
  p95: number;
  p99: number;
}

interface BenchmarkSample {
  label: string;
  percentilesMs: PercentilesMs;
}

function getEnvNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid numeric env value for ${name}: ${value}`);
  }
  return parsed;
}

function percentile(values: readonly number[], quantile: number): number {
  assert.ok(values.length > 0, 'percentile requires at least one value');
  const sorted = [...values].sort((a, b) => a - b);
  const rawIndex = Math.ceil((quantile / 100) * sorted.length) - 1;
  const clampedIndex = Math.min(Math.max(rawIndex, 0), sorted.length - 1);
  const value = sorted[clampedIndex];
  assert.notEqual(value, undefined);
  return value;
}

function computePercentiles(valuesMs: readonly number[]): PercentilesMs {
  return {
    p50: percentile(valuesMs, 50),
    p95: percentile(valuesMs, 95),
    p99: percentile(valuesMs, 99)
  };
}

function formatMs(valueMs: number): string {
  return valueMs.toFixed(3);
}

class OutputBuffer {
  private window = Buffer.alloc(0);
  private waiters: Array<{
    matchPayloads: Buffer[];
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  append(chunk: Buffer): void {
    this.window = this.window.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([this.window, chunk]);
    if (this.window.length > 65_536) {
      this.window = this.window.subarray(this.window.length - 65_536);
    }

    for (let idx = 0; idx < this.waiters.length; idx += 1) {
      const waiter = this.waiters[idx];
      if (waiter === undefined) {
        break;
      }
      if (!waiter.matchPayloads.some((payload) => this.window.includes(payload))) {
        continue;
      }
      clearTimeout(waiter.timer);
      this.waiters.splice(idx, 1);
      idx -= 1;
      waiter.resolve();
    }
  }

  waitForAny(matchPayloads: Buffer[], timeoutMs: number): Promise<void> {
    if (matchPayloads.some((payload) => this.window.includes(payload))) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.timer !== timer);
        reject(new Error('timed out waiting for benchmark echo payload'));
      }, timeoutMs);
      this.waiters.push({
        matchPayloads,
        resolve,
        reject,
        timer
      });
    });
  }

  failAll(error: Error): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters = [];
  }
}

function buildMatchPayloads(payload: Buffer): Buffer[] {
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

function frameData(payload: Buffer): Buffer {
  const frame = Buffer.alloc(1 + 4 + payload.length);
  frame[0] = OPCODE_DATA;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

function frameClose(): Buffer {
  return Buffer.from([OPCODE_CLOSE]);
}

async function measureHarness(sampleCount: number, timeoutMs: number): Promise<BenchmarkSample> {
  const session = startPtySession({
    command: '/bin/cat',
    commandArgs: []
  });
  const output = new OutputBuffer();
  const timingsMs: number[] = [];

  session.on('data', (chunk: Buffer) => {
    output.append(chunk);
  });
  session.on('error', (error: Error) => {
    output.failAll(error);
  });

  for (let idx = 0; idx < sampleCount; idx += 1) {
    const marker = `h-${idx}-${randomUUID()}\n`;
    const payload = Buffer.from(marker, 'utf8');
    const startedAtNs = process.hrtime.bigint();
    session.write(payload);
    await output.waitForAny(buildMatchPayloads(payload), timeoutMs);
    const elapsedMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
    timingsMs.push(elapsedMs);
  }

  const exit = await new Promise<PtyExit>((resolve) => {
    session.once('exit', (value: unknown) => {
      resolve(value as PtyExit);
    });
    session.write(new Uint8Array([0x04]));
  });
  assert.equal(exit.code, 0);

  return {
    label: 'harness',
    percentilesMs: computePercentiles(timingsMs)
  };
}

function getHelperPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../bin/ptyd');
}

async function measureFramedDirect(sampleCount: number, timeoutMs: number): Promise<BenchmarkSample> {
  const helperPath = getHelperPath();
  const child = spawn(helperPath, ['/bin/cat'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const output = new OutputBuffer();
  const timingsMs: number[] = [];

  child.stdout.on('data', (chunk: Buffer) => {
    output.append(chunk);
  });
  child.on('error', (error: Error) => {
    output.failAll(error);
  });
  child.stderr.on('data', () => {
    // Benchmark path is output-only; stderr is ignored for latency measurement.
  });

  for (let idx = 0; idx < sampleCount; idx += 1) {
    const marker = `d-${idx}-${randomUUID()}\n`;
    const payload = Buffer.from(marker, 'utf8');
    const startedAtNs = process.hrtime.bigint();
    child.stdin.write(frameData(payload));
    await output.waitForAny(buildMatchPayloads(payload), timeoutMs);
    const elapsedMs = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000;
    timingsMs.push(elapsedMs);
  }

  const exitCode = await new Promise<number | null>((resolve) => {
    child.once('exit', (code: number | null) => {
      resolve(code);
    });
    child.stdin.write(frameClose());
  });
  assert.notEqual(exitCode, null);

  return {
    label: 'direct-framed',
    percentilesMs: computePercentiles(timingsMs)
  };
}

function printReport(direct: BenchmarkSample, harness: BenchmarkSample): PercentilesMs {
  const overhead: PercentilesMs = {
    p50: harness.percentilesMs.p50 - direct.percentilesMs.p50,
    p95: harness.percentilesMs.p95 - direct.percentilesMs.p95,
    p99: harness.percentilesMs.p99 - direct.percentilesMs.p99
  };

  process.stdout.write(
    [
      `direct p50=${formatMs(direct.percentilesMs.p50)}ms p95=${formatMs(direct.percentilesMs.p95)}ms p99=${formatMs(direct.percentilesMs.p99)}ms`,
      `harness p50=${formatMs(harness.percentilesMs.p50)}ms p95=${formatMs(harness.percentilesMs.p95)}ms p99=${formatMs(harness.percentilesMs.p99)}ms`,
      `overhead p50=${formatMs(overhead.p50)}ms p95=${formatMs(overhead.p95)}ms p99=${formatMs(overhead.p99)}ms`
    ].join('\n') + '\n'
  );

  return overhead;
}

async function main(): Promise<number> {
  const sampleCount = Math.trunc(getEnvNumber('HARNESS_LATENCY_SAMPLES', DEFAULT_SAMPLE_COUNT));
  const timeoutMs = Math.trunc(getEnvNumber('HARNESS_LATENCY_TIMEOUT_MS', DEFAULT_TIMEOUT_MS));
  const maxP50Ms = getEnvNumber('HARNESS_LATENCY_MAX_P50_MS', 1);
  const maxP95Ms = getEnvNumber('HARNESS_LATENCY_MAX_P95_MS', 3);
  const maxP99Ms = getEnvNumber('HARNESS_LATENCY_MAX_P99_MS', 5);

  if (sampleCount <= 0) {
    throw new Error('HARNESS_LATENCY_SAMPLES must be > 0');
  }
  if (timeoutMs <= 0) {
    throw new Error('HARNESS_LATENCY_TIMEOUT_MS must be > 0');
  }

  const direct = await measureFramedDirect(sampleCount, timeoutMs);
  const harness = await measureHarness(sampleCount, timeoutMs);
  const overhead = printReport(direct, harness);

  if (overhead.p50 > maxP50Ms || overhead.p95 > maxP95Ms || overhead.p99 > maxP99Ms) {
    process.stderr.write(
      [
        'latency gate failed',
        `required overhead: p50<=${formatMs(maxP50Ms)}ms p95<=${formatMs(maxP95Ms)}ms p99<=${formatMs(maxP99Ms)}ms`,
        `actual overhead: p50=${formatMs(overhead.p50)}ms p95=${formatMs(overhead.p95)}ms p99=${formatMs(overhead.p99)}ms`
      ].join('\n') + '\n'
    );
    return 1;
  }

  process.stdout.write('latency gate passed\n');
  return 0;
}

const code = await main();
process.exitCode = code;
