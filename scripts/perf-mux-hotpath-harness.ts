import { monitorEventLoopDelay } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  TerminalSnapshotOracle,
  renderSnapshotAnsiRow,
  type TerminalSnapshotFrame
} from '../src/terminal/snapshot-oracle.ts';
import {
  computeDualPaneLayout,
  diffRenderedRows,
  padOrTrimDisplay
} from '../src/mux/dual-pane-core.ts';

type Profile = 'line' | 'ansi' | 'mixed';

interface ParsedArgs {
  readonly durationMs: number;
  readonly cols: number;
  readonly rows: number;
  readonly outputHz: number;
  readonly chunksPerTick: number;
  readonly bytesPerChunk: number;
  readonly inputHz: number;
  readonly sessions: number;
  readonly activeShare: number;
  readonly parsePasses: number;
  readonly protocolRoundtrip: boolean;
  readonly snapshotHash: boolean;
  readonly recordingSnapshotPass: boolean;
  readonly profile: Profile;
  readonly fixtureFile: string | null;
  readonly seed: number;
  readonly matrix: boolean;
  readonly json: boolean;
}

interface Scenario {
  readonly name: string;
  readonly args: ParsedArgs;
}

interface SummaryStats {
  readonly count: number;
  readonly avgMs: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

interface HarnessSummary {
  readonly scenario: string;
  readonly config: {
    readonly durationMs: number;
    readonly cols: number;
    readonly rows: number;
    readonly outputHz: number;
    readonly chunksPerTick: number;
    readonly bytesPerChunk: number;
    readonly inputHz: number;
    readonly sessions: number;
    readonly activeShare: number;
    readonly parsePasses: number;
    readonly protocolRoundtrip: boolean;
    readonly snapshotHash: boolean;
    readonly recordingSnapshotPass: boolean;
    readonly profile: Profile;
    readonly fixtureFile: string | null;
  };
  readonly counters: {
    readonly chunks: number;
    readonly bytes: number;
    readonly activeChunks: number;
    readonly inactiveChunks: number;
    readonly renders: number;
    readonly changedRowsTotal: number;
    readonly changedRowsAvg: number;
    readonly renderOutputBytes: number;
    readonly fps: number;
  };
  readonly timings: {
    readonly outputHandle: SummaryStats;
    readonly protocolRoundtrip: SummaryStats;
    readonly oracleIngest: SummaryStats;
    readonly snapshot: SummaryStats;
    readonly rowRender: SummaryStats;
    readonly diff: SummaryStats;
    readonly renderTotal: SummaryStats;
    readonly recordingSnapshot: SummaryStats;
    readonly inputDelay: SummaryStats;
  };
  readonly eventLoopDelayMs: {
    readonly p95: number;
    readonly p99: number;
    readonly max: number;
  };
}

interface MutableCounters {
  chunks: number;
  bytes: number;
  activeChunks: number;
  inactiveChunks: number;
  renders: number;
  changedRowsTotal: number;
  renderOutputBytes: number;
}

function parseIntArg(value: string | undefined, fallback: number, min: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return parsed;
}

function parseFloatArg(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function parseProfile(value: string | undefined, fallback: Profile): Profile {
  if (value === 'line' || value === 'ansi' || value === 'mixed') {
    return value;
  }
  return fallback;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let durationMs = 5000;
  let cols = 160;
  let rows = 48;
  let outputHz = 120;
  let chunksPerTick = 1;
  let bytesPerChunk = 240;
  let inputHz = 60;
  let sessions = 2;
  let activeShare = 1;
  let parsePasses = 2;
  let protocolRoundtrip = false;
  let snapshotHash = false;
  let recordingSnapshotPass = false;
  let profile: Profile = 'mixed';
  let fixtureFile: string | null = null;
  let seed = 1;
  let matrix = false;
  let json = false;

  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx]!;
    if (arg === '--duration-ms') {
      durationMs = parseIntArg(argv[idx + 1], durationMs, 250);
      idx += 1;
      continue;
    }
    if (arg === '--cols') {
      cols = parseIntArg(argv[idx + 1], cols, 20);
      idx += 1;
      continue;
    }
    if (arg === '--rows') {
      rows = parseIntArg(argv[idx + 1], rows, 5);
      idx += 1;
      continue;
    }
    if (arg === '--output-hz') {
      outputHz = parseIntArg(argv[idx + 1], outputHz, 1);
      idx += 1;
      continue;
    }
    if (arg === '--chunks-per-tick') {
      chunksPerTick = parseIntArg(argv[idx + 1], chunksPerTick, 1);
      idx += 1;
      continue;
    }
    if (arg === '--bytes-per-chunk') {
      bytesPerChunk = parseIntArg(argv[idx + 1], bytesPerChunk, 8);
      idx += 1;
      continue;
    }
    if (arg === '--input-hz') {
      inputHz = parseIntArg(argv[idx + 1], inputHz, 1);
      idx += 1;
      continue;
    }
    if (arg === '--sessions') {
      sessions = parseIntArg(argv[idx + 1], sessions, 1);
      idx += 1;
      continue;
    }
    if (arg === '--active-share') {
      activeShare = parseFloatArg(argv[idx + 1], activeShare, 0, 1);
      idx += 1;
      continue;
    }
    if (arg === '--parse-passes') {
      parsePasses = parseIntArg(argv[idx + 1], parsePasses, 1);
      parsePasses = Math.min(4, parsePasses);
      idx += 1;
      continue;
    }
    if (arg === '--profile') {
      profile = parseProfile(argv[idx + 1], profile);
      idx += 1;
      continue;
    }
    if (arg === '--fixture-file') {
      const value = argv[idx + 1];
      if (value === undefined || value.trim().length === 0) {
        throw new Error('missing value for --fixture-file');
      }
      fixtureFile = value;
      idx += 1;
      continue;
    }
    if (arg === '--seed') {
      seed = parseIntArg(argv[idx + 1], seed, 0);
      idx += 1;
      continue;
    }
    if (arg === '--protocol-roundtrip') {
      protocolRoundtrip = true;
      continue;
    }
    if (arg === '--snapshot-hash') {
      snapshotHash = true;
      continue;
    }
    if (arg === '--recording-snapshot-pass') {
      recordingSnapshotPass = true;
      continue;
    }
    if (arg === '--matrix') {
      matrix = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
  }

  return {
    durationMs,
    cols,
    rows,
    outputHz,
    chunksPerTick,
    bytesPerChunk,
    inputHz,
    sessions,
    activeShare,
    parsePasses,
    protocolRoundtrip,
    snapshotHash,
    recordingSnapshotPass,
    profile,
    fixtureFile,
    seed,
    matrix,
    json
  };
}

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function nsToMs(value: bigint): number {
  return Number(value) / 1_000_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * fraction))
  );
  return sorted[index]!;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}

function summarize(values: readonly number[]): SummaryStats {
  return {
    count: values.length,
    avgMs: average(values),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: percentile(values, 1)
  };
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function fitAsciiBytes(text: string, targetBytes: number): string {
  if (targetBytes <= 0) {
    return '';
  }
  if (text.length === targetBytes) {
    return text;
  }
  if (text.length > targetBytes) {
    return text.slice(0, targetBytes);
  }
  return `${text}${'x'.repeat(targetBytes - text.length)}`;
}

function makeSyntheticChunk(profile: Profile, sequence: number, bytesPerChunk: number): Buffer {
  if (profile === 'line') {
    const head = `line ${String(sequence).padStart(7, '0')} `;
    return Buffer.from(fitAsciiBytes(`${head}\n`, bytesPerChunk), 'utf8');
  }

  if (profile === 'ansi') {
    const color = 16 + (sequence % 180);
    const prefix = `\u001b[38;5;${String(color)}m\u001b[2K\r`;
    const body = `status ${String(sequence).padStart(7, '0')} `;
    const suffix = '\u001b[0m\n';
    return Buffer.from(fitAsciiBytes(`${prefix}${body}${suffix}`, bytesPerChunk), 'utf8');
  }

  if (sequence % 2 === 0) {
    const head = `chunk ${String(sequence).padStart(7, '0')} `;
    return Buffer.from(fitAsciiBytes(`${head}\n`, bytesPerChunk), 'utf8');
  }

  const color = 16 + (sequence % 160);
  const prefix = `\u001b[38;5;${String(color)}m\u001b[2K\r`;
  const body = `repaint ${String(sequence).padStart(7, '0')} `;
  const suffix = '\u001b[0m';
  return Buffer.from(fitAsciiBytes(`${prefix}${body}${suffix}`, bytesPerChunk), 'utf8');
}

function makeFixtureChunkPool(bytesPerChunk: number, fixtureFile: string): readonly Buffer[] {
  const filePath = resolve(process.cwd(), fixtureFile);
  const source = readFileSync(filePath);
  if (source.length === 0) {
    throw new Error(`fixture file is empty: ${filePath}`);
  }
  const pool: Buffer[] = [];
  let cursor = 0;
  for (let idx = 0; idx < 256; idx += 1) {
    const chunk = Buffer.alloc(bytesPerChunk);
    let written = 0;
    while (written < bytesPerChunk) {
      const remaining = bytesPerChunk - written;
      const sourceRemaining = source.length - cursor;
      const copyBytes = Math.min(remaining, sourceRemaining);
      source.copy(chunk, written, cursor, cursor + copyBytes);
      written += copyBytes;
      cursor += copyBytes;
      if (cursor >= source.length) {
        cursor = 0;
      }
    }
    pool.push(chunk);
  }
  return pool;
}

function makeSyntheticChunkPool(profile: Profile, bytesPerChunk: number): readonly Buffer[] {
  const pool: Buffer[] = [];
  for (let idx = 0; idx < 256; idx += 1) {
    pool.push(makeSyntheticChunk(profile, idx, bytesPerChunk));
  }
  return pool;
}

function buildRenderRows(
  layout: ReturnType<typeof computeDualPaneLayout>,
  frame: TerminalSnapshotFrame,
  activeSessionIndex: number
): readonly string[] {
  const rows: string[] = [];
  const left = ' '.repeat(layout.leftCols);
  for (let row = 0; row < layout.paneRows; row += 1) {
    const right = renderSnapshotAnsiRow(frame, row, layout.rightCols);
    rows.push(`${left}\u001b[0m│${right}`);
  }
  rows.push(
    padOrTrimDisplay(
      `[micro] active=session-${String(activeSessionIndex + 1)} pty=live`,
      layout.cols
    )
  );
  return rows;
}

function chooseSessionIndex(
  rng: () => number,
  sessionCount: number,
  activeSessionIndex: number,
  activeShare: number
): number {
  if (sessionCount <= 1) {
    return activeSessionIndex;
  }
  if (rng() <= activeShare) {
    return activeSessionIndex;
  }
  const candidate = 1 + Math.floor(rng() * (sessionCount - 1));
  return Math.max(0, Math.min(sessionCount - 1, candidate));
}

function simulateProtocolRoundtrip(
  chunk: Buffer,
  sessionId: string,
  cursor: number
): Buffer {
  const encoded = JSON.stringify({
    kind: 'pty.output',
    sessionId,
    cursor,
    chunkBase64: chunk.toString('base64')
  });

  const parsed = JSON.parse(encoded) as {
    kind?: unknown;
    sessionId?: unknown;
    cursor?: unknown;
    chunkBase64?: unknown;
  };
  const rawChunk = parsed.chunkBase64;
  if (typeof rawChunk !== 'string') {
    throw new Error('protocol roundtrip decode failed');
  }
  return Buffer.from(rawChunk, 'base64');
}

function formatMs(value: number): string {
  return `${value.toFixed(3)}ms`;
}

function formatStats(stats: SummaryStats): string {
  return `count=${String(stats.count)} avg=${formatMs(stats.avgMs)} p95=${formatMs(stats.p95Ms)} p99=${formatMs(stats.p99Ms)} max=${formatMs(stats.maxMs)}`;
}

async function runScenario(scenario: Scenario): Promise<HarnessSummary> {
  const args = scenario.args;
  const layout = computeDualPaneLayout(args.cols, args.rows);
  const parseLayers = Array.from({ length: args.parsePasses }, () =>
    Array.from(
      { length: args.sessions },
      () => new TerminalSnapshotOracle(layout.rightCols, layout.paneRows)
    )
  );
  const activeSessionIndex = 0;
  const outputCursorBySession = Array.from({ length: args.sessions }, () => 0);
  const chunkPool =
    args.fixtureFile === null
      ? makeSyntheticChunkPool(args.profile, args.bytesPerChunk)
      : makeFixtureChunkPool(args.bytesPerChunk, args.fixtureFile);
  let chunkPoolIndex = 0;
  const rng = createRng(args.seed);

  const counters: MutableCounters = {
    chunks: 0,
    bytes: 0,
    activeChunks: 0,
    inactiveChunks: 0,
    renders: 0,
    changedRowsTotal: 0,
    renderOutputBytes: 0
  };

  const outputHandleDurationsMs: number[] = [];
  const protocolDurationsMs: number[] = [];
  const ingestDurationsMs: number[] = [];
  const snapshotDurationsMs: number[] = [];
  const rowRenderDurationsMs: number[] = [];
  const diffDurationsMs: number[] = [];
  const renderDurationsMs: number[] = [];
  const recordingSnapshotDurationsMs: number[] = [];
  const inputDelayDurationsMs: number[] = [];

  let previousRows: readonly string[] = [];
  let dirty = false;
  let renderScheduled = false;
  let acceptingOutput = true;

  const eventLoopMonitor = monitorEventLoopDelay({
    resolution: 10
  });
  eventLoopMonitor.enable();

  const render = (): void => {
    if (!dirty) {
      return;
    }

    const renderStartedAtNs = nowNs();

    const snapshotStartedAtNs = nowNs();
    const frame = args.snapshotHash
      ? parseLayers[0]![activeSessionIndex]!.snapshot()
      : parseLayers[0]![activeSessionIndex]!.snapshotWithoutHash();
    snapshotDurationsMs.push(nsToMs(nowNs() - snapshotStartedAtNs));

    const rowRenderStartedAtNs = nowNs();
    const rows = buildRenderRows(layout, frame, activeSessionIndex);
    rowRenderDurationsMs.push(nsToMs(nowNs() - rowRenderStartedAtNs));

    const diffStartedAtNs = nowNs();
    const diff = diffRenderedRows(rows, previousRows);
    diffDurationsMs.push(nsToMs(nowNs() - diffStartedAtNs));

    previousRows = diff.nextRows;
    counters.changedRowsTotal += diff.changedRows.length;
    counters.renderOutputBytes += Buffer.byteLength(diff.output, 'utf8');

    if (args.recordingSnapshotPass && parseLayers.length > 2) {
      const recordingSnapshotStartedAtNs = nowNs();
      const recordingFrame = parseLayers[2]![activeSessionIndex]!.snapshot();
      if (recordingFrame.frameHash.length === 0) {
        throw new Error('recording snapshot produced empty frame hash');
      }
      recordingSnapshotDurationsMs.push(nsToMs(nowNs() - recordingSnapshotStartedAtNs));
    }

    counters.renders += 1;
    dirty = false;
    renderDurationsMs.push(nsToMs(nowNs() - renderStartedAtNs));
  };

  const scheduleRender = (): void => {
    if (renderScheduled) {
      return;
    }
    renderScheduled = true;
    setImmediate(() => {
      renderScheduled = false;
      render();
      if (dirty) {
        scheduleRender();
      }
    });
  };

  const markDirty = (): void => {
    dirty = true;
    scheduleRender();
  };

  const handleChunk = (): void => {
    if (!acceptingOutput) {
      return;
    }

    const sessionIndex = chooseSessionIndex(
      rng,
      args.sessions,
      activeSessionIndex,
      args.activeShare
    );
    const sessionId = `session-${String(sessionIndex + 1)}`;
    const chunk = chunkPool[chunkPoolIndex % chunkPool.length]!;
    chunkPoolIndex += 1;

    const outputStartedAtNs = nowNs();
    let ingestChunk = chunk;

    if (args.protocolRoundtrip) {
      const protocolStartedAtNs = nowNs();
      ingestChunk = simulateProtocolRoundtrip(
        chunk,
        sessionId,
        outputCursorBySession[sessionIndex] ?? 0
      );
      protocolDurationsMs.push(nsToMs(nowNs() - protocolStartedAtNs));
    }

    const ingestStartedAtNs = nowNs();
    for (const layer of parseLayers) {
      layer[sessionIndex]!.ingest(ingestChunk);
    }
    ingestDurationsMs.push(nsToMs(nowNs() - ingestStartedAtNs));
    outputHandleDurationsMs.push(nsToMs(nowNs() - outputStartedAtNs));

    outputCursorBySession[sessionIndex] =
      (outputCursorBySession[sessionIndex] ?? 0) + ingestChunk.length;
    counters.chunks += 1;
    counters.bytes += ingestChunk.length;
    if (sessionIndex === activeSessionIndex) {
      counters.activeChunks += 1;
      markDirty();
    } else {
      counters.inactiveChunks += 1;
    }
  };

  const outputIntervalMs = Math.max(1, Math.round(1000 / args.outputHz));
  const inputIntervalMs = Math.max(1, Math.round(1000 / args.inputHz));
  const startNs = nowNs();
  const inputIntervalNs = BigInt(inputIntervalMs) * BigInt(1_000_000);
  let lastInputTickAtNs: bigint | null = null;

  const outputTimer = setInterval(() => {
    for (let idx = 0; idx < args.chunksPerTick; idx += 1) {
      handleChunk();
    }
  }, outputIntervalMs);

  const inputTimer = setInterval(() => {
    const tickAtNs = nowNs();
    if (lastInputTickAtNs !== null) {
      const extraDelayNs = tickAtNs - lastInputTickAtNs - inputIntervalNs;
      inputDelayDurationsMs.push(extraDelayNs > 0 ? nsToMs(extraDelayNs) : 0);
    } else {
      inputDelayDurationsMs.push(0);
    }
    lastInputTickAtNs = tickAtNs;
  }, inputIntervalMs);

  await sleep(args.durationMs);
  acceptingOutput = false;
  clearInterval(outputTimer);
  clearInterval(inputTimer);

  if (dirty && !renderScheduled) {
    scheduleRender();
  }

  const drainDeadline = Date.now() + 750;
  while ((dirty || renderScheduled) && Date.now() < drainDeadline) {
    await sleep(5);
  }

  eventLoopMonitor.disable();
  const elapsedMs = nsToMs(nowNs() - startNs);

  return {
    scenario: scenario.name,
    config: {
      durationMs: args.durationMs,
      cols: layout.cols,
      rows: layout.rows,
      outputHz: args.outputHz,
      chunksPerTick: args.chunksPerTick,
      bytesPerChunk: args.bytesPerChunk,
      inputHz: args.inputHz,
      sessions: args.sessions,
      activeShare: args.activeShare,
      parsePasses: args.parsePasses,
      protocolRoundtrip: args.protocolRoundtrip,
      snapshotHash: args.snapshotHash,
      recordingSnapshotPass: args.recordingSnapshotPass,
      profile: args.profile,
      fixtureFile: args.fixtureFile
    },
    counters: {
      chunks: counters.chunks,
      bytes: counters.bytes,
      activeChunks: counters.activeChunks,
      inactiveChunks: counters.inactiveChunks,
      renders: counters.renders,
      changedRowsTotal: counters.changedRowsTotal,
      changedRowsAvg:
        counters.renders === 0 ? 0 : counters.changedRowsTotal / counters.renders,
      renderOutputBytes: counters.renderOutputBytes,
      fps: elapsedMs <= 0 ? 0 : counters.renders / (elapsedMs / 1000)
    },
    timings: {
      outputHandle: summarize(outputHandleDurationsMs),
      protocolRoundtrip: summarize(protocolDurationsMs),
      oracleIngest: summarize(ingestDurationsMs),
      snapshot: summarize(snapshotDurationsMs),
      rowRender: summarize(rowRenderDurationsMs),
      diff: summarize(diffDurationsMs),
      renderTotal: summarize(renderDurationsMs),
      recordingSnapshot: summarize(recordingSnapshotDurationsMs),
      inputDelay: summarize(inputDelayDurationsMs)
    },
    eventLoopDelayMs: {
      p95: Number(eventLoopMonitor.percentile(95)) / 1e6,
      p99: Number(eventLoopMonitor.percentile(99)) / 1e6,
      max: Number(eventLoopMonitor.max) / 1e6
    }
  };
}

function withOverrides(base: ParsedArgs, overrides: Partial<ParsedArgs>): ParsedArgs {
  return {
    ...base,
    ...overrides
  };
}

function buildMatrixScenarios(baseArgs: ParsedArgs): readonly Scenario[] {
  const normalizedBase = withOverrides(baseArgs, {
    durationMs: Math.max(1000, baseArgs.durationMs),
    parsePasses: 1,
    protocolRoundtrip: false,
    recordingSnapshotPass: false
  });

  return [
    {
      name: 'single-parse',
      args: withOverrides(normalizedBase, {
        parsePasses: 1,
        protocolRoundtrip: false,
        recordingSnapshotPass: false
      })
    },
    {
      name: 'double-parse',
      args: withOverrides(normalizedBase, {
        parsePasses: 2,
        protocolRoundtrip: false,
        recordingSnapshotPass: false
      })
    },
    {
      name: 'double-parse+protocol',
      args: withOverrides(normalizedBase, {
        parsePasses: 2,
        protocolRoundtrip: true,
        recordingSnapshotPass: false
      })
    },
    {
      name: 'triple-parse+recording-snapshot',
      args: withOverrides(normalizedBase, {
        parsePasses: 3,
        protocolRoundtrip: true,
        recordingSnapshotPass: true
      })
    }
  ];
}

function printSingleSummary(summary: HarnessSummary): void {
  process.stdout.write('Mux Hot-Path Micro Harness\n');
  process.stdout.write('--------------------------\n');
  process.stdout.write(
    ` scenario=${summary.scenario} duration=${String(summary.config.durationMs)}ms profile=${summary.config.profile} fixture=${summary.config.fixtureFile ?? 'none'}\n`
  );
  process.stdout.write(
    ` layout=${String(summary.config.cols)}x${String(summary.config.rows)} sessions=${String(summary.config.sessions)} activeShare=${summary.config.activeShare.toFixed(2)} parsePasses=${String(summary.config.parsePasses)} protocolRoundtrip=${summary.config.protocolRoundtrip ? 'on' : 'off'} snapshotHash=${summary.config.snapshotHash ? 'on' : 'off'} recordingSnapshotPass=${summary.config.recordingSnapshotPass ? 'on' : 'off'}\n`
  );
  process.stdout.write(
    ` output target: hz=${String(summary.config.outputHz)} chunksPerTick=${String(summary.config.chunksPerTick)} bytesPerChunk=${String(summary.config.bytesPerChunk)}\n`
  );
  process.stdout.write(` input target: hz=${String(summary.config.inputHz)}\n\n`);

  process.stdout.write('Counters\n');
  process.stdout.write('--------\n');
  process.stdout.write(
    ` chunks=${String(summary.counters.chunks)} bytes=${String(summary.counters.bytes)} activeChunks=${String(summary.counters.activeChunks)} inactiveChunks=${String(summary.counters.inactiveChunks)}\n`
  );
  process.stdout.write(
    ` renders=${String(summary.counters.renders)} fps=${summary.counters.fps.toFixed(2)} changedRows(total/avg)=${String(summary.counters.changedRowsTotal)}/${summary.counters.changedRowsAvg.toFixed(2)} renderOutputBytes=${String(summary.counters.renderOutputBytes)}\n\n`
  );

  process.stdout.write('Timings (ms)\n');
  process.stdout.write('------------\n');
  process.stdout.write(` output-handle           ${formatStats(summary.timings.outputHandle)}\n`);
  process.stdout.write(` protocol-roundtrip      ${formatStats(summary.timings.protocolRoundtrip)}\n`);
  process.stdout.write(` oracle-ingest           ${formatStats(summary.timings.oracleIngest)}\n`);
  process.stdout.write(` snapshot                ${formatStats(summary.timings.snapshot)}\n`);
  process.stdout.write(` row-render              ${formatStats(summary.timings.rowRender)}\n`);
  process.stdout.write(` diff                    ${formatStats(summary.timings.diff)}\n`);
  process.stdout.write(` render-total            ${formatStats(summary.timings.renderTotal)}\n`);
  process.stdout.write(` recording-snapshot      ${formatStats(summary.timings.recordingSnapshot)}\n`);
  process.stdout.write(` input-delay             ${formatStats(summary.timings.inputDelay)}\n`);
  process.stdout.write(
    ` event-loop delay        p95=${formatMs(summary.eventLoopDelayMs.p95)} p99=${formatMs(summary.eventLoopDelayMs.p99)} max=${formatMs(summary.eventLoopDelayMs.max)}\n`
  );
}

function printMatrixSummaries(summaries: readonly HarnessSummary[]): void {
  process.stdout.write('Mux Hot-Path Matrix\n');
  process.stdout.write('-------------------\n');
  process.stdout.write(
    'scenario                               fps    render.p95  ingest.p95  input.p95  loop.p95\n'
  );
  for (const summary of summaries) {
    const name = summary.scenario.padEnd(38, ' ');
    const fps = summary.counters.fps.toFixed(2).padStart(6, ' ');
    const renderP95 = formatMs(summary.timings.renderTotal.p95Ms).padStart(10, ' ');
    const ingestP95 = formatMs(summary.timings.oracleIngest.p95Ms).padStart(10, ' ');
    const inputP95 = formatMs(summary.timings.inputDelay.p95Ms).padStart(10, ' ');
    const loopP95 = formatMs(summary.eventLoopDelayMs.p95).padStart(8, ' ');
    process.stdout.write(`${name} ${fps} ${renderP95} ${ingestP95} ${inputP95} ${loopP95}\n`);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.matrix) {
    const scenarios = buildMatrixScenarios(args);
    const summaries: HarnessSummary[] = [];
    for (const scenario of scenarios) {
      summaries.push(await runScenario(scenario));
    }
    if (args.json) {
      process.stdout.write(`${JSON.stringify(summaries, null, 2)}\n`);
      return 0;
    }
    printMatrixSummaries(summaries);
    return 0;
  }

  const summary = await runScenario({
    name: 'single',
    args
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }
  printSingleSummary(summary);
  return 0;
}

void main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`perf-mux-hotpath-harness failed: ${message}\n`);
    process.exitCode = 1;
  }
);
