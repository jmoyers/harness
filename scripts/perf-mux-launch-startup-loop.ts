import process from 'node:process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startPtySession } from '../src/pty/pty_host.ts';

interface ParsedArgs {
  readonly iterations: number;
  readonly timeoutMs: number;
  readonly json: boolean;
  readonly keepPerf: boolean;
  readonly codexArgs: readonly string[];
}

interface PtyRunMetrics {
  readonly firstOutputMs: number | null;
  readonly timedOut: boolean;
}

interface PerfEventRecord {
  readonly type: 'event';
  readonly name: string;
  readonly 'ts-ms': number;
}

interface RunMetrics {
  readonly run: number;
  readonly directFirstOutputMs: number | null;
  readonly muxFirstOutputMs: number | null;
  readonly deltaMs: number | null;
  readonly daemonReadyMs: number | null;
  readonly muxReadyMs: number | null;
  readonly muxFirstPaintMs: number | null;
  readonly muxSettledMs: number | null;
  readonly timedOutDirect: boolean;
  readonly timedOutMux: boolean;
  readonly perfPath: string;
}

function parseIntArg(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let iterations = 5;
  let timeoutMs = 15_000;
  let json = false;
  let keepPerf = false;
  const codexArgs: string[] = [];

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx]!;
    if (arg === '--iterations' || arg === '--runs') {
      iterations = Math.max(1, parseIntArg(argv[idx + 1], iterations));
      idx += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      timeoutMs = Math.max(1000, parseIntArg(argv[idx + 1], timeoutMs));
      idx += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--keep-perf') {
      keepPerf = true;
      continue;
    }
    codexArgs.push(arg);
  }

  return {
    iterations,
    timeoutMs,
    json,
    keepPerf,
    codexArgs
  };
}

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function nsToMs(value: bigint): number {
  return Number(value) / 1_000_000;
}

function tsRuntimeArgs(scriptPath: string, args: readonly string[] = []): string[] {
  return [scriptPath, ...args];
}

function readPerfEvents(filePath: string): readonly PerfEventRecord[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const records: PerfEventRecord[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      continue;
    }
    const value = parsed as Record<string, unknown>;
    if (value.type !== 'event') {
      continue;
    }
    if (typeof value.name !== 'string' || typeof value['ts-ms'] !== 'number') {
      continue;
    }
    records.push({
      type: 'event',
      name: value.name,
      'ts-ms': value['ts-ms']
    });
  }

  return records;
}

function eventTimeMs(records: readonly PerfEventRecord[], eventName: string): number | null {
  for (const record of records) {
    if (record.name === eventName) {
      return record['ts-ms'];
    }
  }
  return null;
}

function traceDeltaMs(
  records: readonly PerfEventRecord[],
  baseEvent: string,
  targetEvent: string
): number | null {
  const base = eventTimeMs(records, baseEvent);
  const target = eventTimeMs(records, targetEvent);
  if (base === null || target === null || target < base) {
    return null;
  }
  return target - base;
}

async function measureFirstOutput(
  command: string,
  commandArgs: readonly string[],
  timeoutMs: number,
  envOverrides: NodeJS.ProcessEnv = {},
  closeDelayMs = 75
): Promise<PtyRunMetrics> {
  const startedNs = nowNs();
  const session = startPtySession({
    command,
    commandArgs: [...commandArgs],
    env: {
      ...process.env,
      TERM: process.env.TERM ?? 'xterm-256color',
      NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS ?? '1',
      ...envOverrides
    },
    initialCols: 120,
    initialRows: 40
  });

  let firstOutputNs: bigint | null = null;
  let timedOut = false;
  let resolved = false;

  const completion = new Promise<void>((resolveCompletion) => {
    const resolveOnce = (): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolveCompletion();
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      session.close();
      resolveOnce();
    }, timeoutMs);

    session.on('data', (chunk: Buffer) => {
      if (firstOutputNs === null && chunk.length > 0) {
        firstOutputNs = nowNs();
        setTimeout(() => {
          session.close();
        }, closeDelayMs);
      }
    });

    session.on('error', () => {
      clearTimeout(timeoutHandle);
      resolveOnce();
    });

    session.on('exit', () => {
      clearTimeout(timeoutHandle);
      resolveOnce();
    });
  });

  await completion;

  return {
    firstOutputMs: firstOutputNs === null ? null : nsToMs(firstOutputNs - startedNs),
    timedOut
  };
}

async function measureMuxLaunchToSettled(
  launchScriptPath: string,
  codexArgs: readonly string[],
  timeoutMs: number,
  perfPath: string
): Promise<{ firstOutputMs: number | null; timedOut: boolean; perfEvents: readonly PerfEventRecord[] }> {
  const startedNs = nowNs();
  const session = startPtySession({
    command: process.execPath,
    commandArgs: tsRuntimeArgs(launchScriptPath, codexArgs),
    env: {
      ...process.env,
      TERM: process.env.TERM ?? 'xterm-256color',
      NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS ?? '1',
      HARNESS_PERF_ENABLED: '1',
      HARNESS_PERF_FILE_PATH: perfPath,
      HARNESS_PERF_TRUNCATE_ON_START: '1'
    },
    initialCols: 120,
    initialRows: 40
  });

  let firstOutputNs: bigint | null = null;
  let timedOut = false;
  let exited = false;

  const exitedPromise = new Promise<void>((resolveExited) => {
    session.on('exit', () => {
      exited = true;
      resolveExited();
    });
    session.on('error', () => {
      exited = true;
      resolveExited();
    });
  });

  session.on('data', (chunk: Buffer) => {
    if (firstOutputNs === null && chunk.length > 0) {
      firstOutputNs = nowNs();
    }
  });

  let events: readonly PerfEventRecord[] = [];
  while (true) {
    events = readPerfEvents(perfPath);
    const settledAtMs = eventTimeMs(events, 'mux.startup.active-settled');
    if (settledAtMs !== null) {
      break;
    }
    if (exited) {
      break;
    }
    const elapsedMs = nsToMs(nowNs() - startedNs);
    if (elapsedMs >= timeoutMs) {
      timedOut = true;
      break;
    }
    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 25);
    });
  }

  session.close();
  await Promise.race([
    exitedPromise,
    new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 350);
    })
  ]);

  events = readPerfEvents(perfPath);
  return {
    firstOutputMs: firstOutputNs === null ? null : nsToMs(firstOutputNs - startedNs),
    timedOut,
    perfEvents: events
  };
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index]!;
}

function formatMs(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }
  return `${value.toFixed(2)}ms`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const launchScriptPath = resolve(process.cwd(), 'scripts/codex-live-mux-launch.ts');
  const runs: RunMetrics[] = [];

  for (let run = 1; run <= args.iterations; run += 1) {
    const direct = await measureFirstOutput('codex', args.codexArgs, args.timeoutMs);

    const perfPath = resolve(
      process.cwd(),
      '.harness',
      `perf-mux-launch-startup-${randomUUID()}-${String(run)}.jsonl`
    );
    mkdirSync(dirname(perfPath), { recursive: true });
    rmSync(perfPath, { force: true });

    const mux = await measureMuxLaunchToSettled(
      launchScriptPath,
      args.codexArgs,
      args.timeoutMs,
      perfPath
    );

    const deltaMs =
      direct.firstOutputMs === null || mux.firstOutputMs === null
        ? null
        : mux.firstOutputMs - direct.firstOutputMs;

    runs.push({
      run,
      directFirstOutputMs: direct.firstOutputMs,
      muxFirstOutputMs: mux.firstOutputMs,
      deltaMs,
      daemonReadyMs: traceDeltaMs(mux.perfEvents, 'launch.startup.begin', 'launch.startup.daemon-ready'),
      muxReadyMs: traceDeltaMs(mux.perfEvents, 'launch.startup.begin', 'mux.startup.ready'),
      muxFirstPaintMs: traceDeltaMs(
        mux.perfEvents,
        'launch.startup.begin',
        'mux.startup.active-first-visible-paint'
      ),
      muxSettledMs: traceDeltaMs(mux.perfEvents, 'launch.startup.begin', 'mux.startup.active-settled'),
      timedOutDirect: direct.timedOut,
      timedOutMux: mux.timedOut,
      perfPath
    });

    if (!args.keepPerf) {
      rmSync(perfPath, { force: true });
    }
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ runs })}\n`);
    return 0;
  }

  for (const run of runs) {
    process.stdout.write(
      `run ${String(run.run).padStart(2, ' ')}: direct-first-output=${formatMs(run.directFirstOutputMs)} mux-first-output=${formatMs(run.muxFirstOutputMs)} delta=${formatMs(run.deltaMs)} launch->daemon-ready=${formatMs(run.daemonReadyMs)} launch->mux-ready=${formatMs(run.muxReadyMs)} launch->first-paint=${formatMs(run.muxFirstPaintMs)} launch->settled=${formatMs(run.muxSettledMs)} timeout={direct:${String(run.timedOutDirect)},mux:${String(run.timedOutMux)}}\n`
    );
    if (args.keepPerf) {
      process.stdout.write(`         perf=${run.perfPath}\n`);
    }
  }

  const deltas = runs.flatMap((run) => (run.deltaMs === null ? [] : [run.deltaMs]));
  const daemonReady = runs.flatMap((run) => (run.daemonReadyMs === null ? [] : [run.daemonReadyMs]));
  const muxReady = runs.flatMap((run) => (run.muxReadyMs === null ? [] : [run.muxReadyMs]));
  const muxSettled = runs.flatMap((run) => (run.muxSettledMs === null ? [] : [run.muxSettledMs]));

  if (deltas.length > 0) {
    process.stdout.write(
      `delta p50=${formatMs(percentile(deltas, 0.5))} p95=${formatMs(percentile(deltas, 0.95))} min=${formatMs(Math.min(...deltas))} max=${formatMs(Math.max(...deltas))}\n`
    );
  }
  if (daemonReady.length > 0) {
    process.stdout.write(
      `launch->daemon-ready p50=${formatMs(percentile(daemonReady, 0.5))} p95=${formatMs(percentile(daemonReady, 0.95))} min=${formatMs(Math.min(...daemonReady))} max=${formatMs(Math.max(...daemonReady))}\n`
    );
  }
  if (muxReady.length > 0) {
    process.stdout.write(
      `launch->mux-ready   p50=${formatMs(percentile(muxReady, 0.5))} p95=${formatMs(percentile(muxReady, 0.95))} min=${formatMs(Math.min(...muxReady))} max=${formatMs(Math.max(...muxReady))}\n`
    );
  }
  if (muxSettled.length > 0) {
    process.stdout.write(
      `launch->settled     p50=${formatMs(percentile(muxSettled, 0.5))} p95=${formatMs(percentile(muxSettled, 0.95))} min=${formatMs(Math.min(...muxSettled))} max=${formatMs(Math.max(...muxSettled))}\n`
    );
  }

  return 0;
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  process.stderr.write(
    `perf mux launch startup loop failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
