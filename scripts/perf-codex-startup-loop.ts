import process from 'node:process';
import { startCodexLiveSession } from '../src/codex/live-session.ts';

interface RunMetrics {
  readonly run: number;
  readonly firstOutputMs: number | null;
  readonly firstVisibleMs: number | null;
  readonly readyPatternMs: number | null;
  readonly settledMs: number | null;
  readonly timedOut: boolean;
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

function parseArgs(argv: readonly string[]): {
  readonly iterations: number;
  readonly cols: number;
  readonly rows: number;
  readonly settleMs: number;
  readonly timeoutMs: number;
  readonly readyPattern: string | null;
  readonly json: boolean;
  readonly codexArgs: readonly string[];
} {
  let iterations = 5;
  let cols = 100;
  let rows = 30;
  let settleMs = 300;
  let timeoutMs = 15_000;
  let readyPattern: string | null = null;
  let json = false;
  const codexArgs: string[] = [];

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx]!;
    if (arg === '--iterations') {
      iterations = Math.max(1, parseIntArg(argv[idx + 1], iterations));
      idx += 1;
      continue;
    }
    if (arg === '--cols') {
      cols = Math.max(20, parseIntArg(argv[idx + 1], cols));
      idx += 1;
      continue;
    }
    if (arg === '--rows') {
      rows = Math.max(5, parseIntArg(argv[idx + 1], rows));
      idx += 1;
      continue;
    }
    if (arg === '--settle-ms') {
      settleMs = Math.max(50, parseIntArg(argv[idx + 1], settleMs));
      idx += 1;
      continue;
    }
    if (arg === '--timeout-ms') {
      timeoutMs = Math.max(1000, parseIntArg(argv[idx + 1], timeoutMs));
      idx += 1;
      continue;
    }
    if (arg === '--ready-pattern') {
      const value = argv[idx + 1];
      if (value !== undefined && value.trim().length > 0) {
        readyPattern = value;
      }
      idx += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    codexArgs.push(arg);
  }

  return {
    iterations,
    cols,
    rows,
    settleMs,
    timeoutMs,
    readyPattern,
    json,
    codexArgs
  };
}

function nsToMs(value: bigint): number {
  return Number(value) / 1_000_000;
}

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function countVisibleGlyphCells(frame: ReturnType<ReturnType<typeof startCodexLiveSession>['snapshot']>): number {
  let count = 0;
  for (const line of frame.richLines) {
    for (const cell of line.cells) {
      if (!cell.continued && cell.glyph.trim().length > 0) {
        count += 1;
      }
    }
  }
  return count;
}

function snapshotVisibleText(frame: ReturnType<ReturnType<typeof startCodexLiveSession>['snapshot']>): string {
  const rows: string[] = [];
  for (const line of frame.richLines) {
    let row = '';
    for (const cell of line.cells) {
      if (cell.continued) {
        continue;
      }
      row += cell.glyph;
    }
    rows.push(row);
  }
  return rows.join('\n');
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index]!;
}

async function runOne(
  run: number,
  codexArgs: readonly string[],
  cols: number,
  rows: number,
  settleMs: number,
  timeoutMs: number,
  readyPattern: string | null
): Promise<RunMetrics> {
  const startedNs = nowNs();
  const session = startCodexLiveSession({
    args: [...codexArgs],
    useNotifyHook: false,
    initialCols: cols,
    initialRows: rows
  });

  let firstOutputNs: bigint | null = null;
  let firstVisibleNs: bigint | null = null;
  let readyPatternNs: bigint | null = null;
  let settledNs: bigint | null = null;
  let timedOut = false;
  let lastOutputNs: bigint | null = null;

  const onEvent = session.onEvent((event) => {
    if (event.type !== 'terminal-output') {
      return;
    }
    const now = nowNs();
    if (firstOutputNs === null) {
      firstOutputNs = now;
    }
    lastOutputNs = now;
    const visibleCells = countVisibleGlyphCells(session.snapshot());
    if (firstVisibleNs === null && visibleCells > 0) {
      firstVisibleNs = now;
    }
    if (readyPatternNs === null && readyPattern !== null) {
      const text = snapshotVisibleText(session.snapshot());
      if (text.includes(readyPattern)) {
        readyPatternNs = now;
      }
    }
  });

  const settleNs = BigInt(settleMs) * BigInt(1_000_000);
  const timeoutNs = BigInt(timeoutMs) * BigInt(1_000_000);

  try {
    while (settledNs === null) {
      const now = nowNs();
      if (now - startedNs >= timeoutNs) {
        timedOut = true;
        break;
      }
      if (
        firstOutputNs !== null &&
        lastOutputNs !== null &&
        now - lastOutputNs >= settleNs &&
        countVisibleGlyphCells(session.snapshot()) > 0
      ) {
        settledNs = now;
        break;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    }
  } finally {
    onEvent();
    session.close();
  }

  return {
    run,
    firstOutputMs: firstOutputNs === null ? null : nsToMs(firstOutputNs - startedNs),
    firstVisibleMs: firstVisibleNs === null ? null : nsToMs(firstVisibleNs - startedNs),
    readyPatternMs: readyPatternNs === null ? null : nsToMs(readyPatternNs - startedNs),
    settledMs: settledNs === null ? null : nsToMs(settledNs - startedNs),
    timedOut
  };
}

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const runs: RunMetrics[] = [];
  for (let run = 1; run <= args.iterations; run += 1) {
    const metrics = await runOne(
      run,
      args.codexArgs,
      args.cols,
      args.rows,
      args.settleMs,
      args.timeoutMs,
      args.readyPattern
    );
    runs.push(metrics);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ runs })}\n`);
    return 0;
  }

  for (const run of runs) {
    process.stdout.write(
      `run ${String(run.run).padStart(2, ' ')}: first-output=${run.firstOutputMs === null ? 'n/a' : formatMs(run.firstOutputMs)} first-visible=${run.firstVisibleMs === null ? 'n/a' : formatMs(run.firstVisibleMs)} ready-pattern=${run.readyPatternMs === null ? 'n/a' : formatMs(run.readyPatternMs)} settled=${run.settledMs === null ? 'n/a' : formatMs(run.settledMs)} timeout=${run.timedOut}\n`
    );
  }

  const firstVisibleValues = runs.flatMap((run) =>
    run.firstVisibleMs === null ? [] : [run.firstVisibleMs]
  );
  const settledValues = runs.flatMap((run) => (run.settledMs === null ? [] : [run.settledMs]));
  const readyPatternValues = runs.flatMap((run) =>
    run.readyPatternMs === null ? [] : [run.readyPatternMs]
  );
  if (firstVisibleValues.length > 0) {
    process.stdout.write(
      `first-visible p50=${formatMs(percentile(firstVisibleValues, 0.5))} p95=${formatMs(percentile(firstVisibleValues, 0.95))} min=${formatMs(Math.min(...firstVisibleValues))} max=${formatMs(Math.max(...firstVisibleValues))}\n`
    );
  }
  if (settledValues.length > 0) {
    process.stdout.write(
      `settled      p50=${formatMs(percentile(settledValues, 0.5))} p95=${formatMs(percentile(settledValues, 0.95))} min=${formatMs(Math.min(...settledValues))} max=${formatMs(Math.max(...settledValues))}\n`
    );
  }
  if (readyPatternValues.length > 0) {
    process.stdout.write(
      `ready-pattern p50=${formatMs(percentile(readyPatternValues, 0.5))} p95=${formatMs(percentile(readyPatternValues, 0.95))} min=${formatMs(Math.min(...readyPatternValues))} max=${formatMs(Math.max(...readyPatternValues))}\n`
    );
  }
  return 0;
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  process.stderr.write(
    `perf codex startup loop failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
