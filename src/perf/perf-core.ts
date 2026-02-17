import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type PerfAttrValue = boolean | number | string;
type PerfAttrs = Readonly<Record<string, PerfAttrValue>>;

interface PerfCoreConfig {
  enabled: boolean;
  filePath?: string;
}

interface PerfEventRecord {
  type: 'event';
  name: string;
  'ts-ns': string;
  'ts-ms': number;
  attrs?: PerfAttrs;
}

interface PerfSpanRecord {
  type: 'span';
  name: string;
  'start-ns': string;
  'duration-ns': string;
  'end-ms': number;
  'trace-id': string;
  'span-id': string;
  'parent-span-id'?: string;
  attrs?: PerfAttrs;
}

type PerfRecord = PerfEventRecord | PerfSpanRecord;

const DEFAULT_FILE_PATH = '.harness/perf.jsonl';
const DEFAULT_MAX_PENDING_RECORDS = 4096;
const DEFAULT_EVENT_SAMPLE_RATES: Readonly<Record<string, number>> = {
  'pty.stdout.chunk': 0.1,
};

const state: {
  enabled: boolean;
  filePath: string;
  fd: number | null;
  nextTraceId: number;
  nextSpanId: number;
  flushTimer: NodeJS.Timeout | null;
  pendingRecords: string[];
  maxPendingRecords: number;
  sampleRates: Readonly<Record<string, number>>;
  sampleCounters: Map<string, number>;
} = {
  enabled: false,
  filePath: DEFAULT_FILE_PATH,
  fd: null,
  nextTraceId: 1,
  nextSpanId: 1,
  flushTimer: null,
  pendingRecords: [],
  maxPendingRecords: DEFAULT_MAX_PENDING_RECORDS,
  sampleRates: DEFAULT_EVENT_SAMPLE_RATES,
  sampleCounters: new Map(),
};

function ensureWriter(): void {
  if (!state.enabled || state.fd !== null) {
    return;
  }

  const resolvedPath = resolve(state.filePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  state.fd = openSync(resolvedPath, 'a');
}

function closeWriter(): void {
  flushPendingRecords();
  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  if (state.fd === null) {
    return;
  }

  closeSync(state.fd);
  state.fd = null;
}

function scheduleFlush(): void {
  if (!state.enabled || state.fd === null || state.flushTimer !== null) {
    return;
  }
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    flushPendingRecords();
  }, 0);
  state.flushTimer.unref();
}

function flushPendingRecords(): void {
  if (state.fd === null || state.pendingRecords.length === 0) {
    return;
  }
  const chunk = state.pendingRecords.join('');
  state.pendingRecords.length = 0;
  writeSync(state.fd, chunk);
}

function writeRecord(record: PerfRecord): void {
  ensureWriter();
  if (state.fd === null) {
    return;
  }
  if (state.pendingRecords.length >= state.maxPendingRecords) {
    state.pendingRecords.shift();
  }
  state.pendingRecords.push(`${JSON.stringify(record)}\n`);
  scheduleFlush();
}

function shouldRecordEvent(name: string): boolean {
  const sampleRate = state.sampleRates[name];
  if (sampleRate === undefined) {
    return true;
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return false;
  }
  if (sampleRate >= 1) {
    return true;
  }
  const sampleEvery = Math.max(1, Math.floor(1 / sampleRate));
  const previous = state.sampleCounters.get(name) ?? 0;
  const next = previous + 1;
  state.sampleCounters.set(name, next);
  return next % sampleEvery === 0;
}

function nextTraceId(): string {
  const traceId = `trace-${state.nextTraceId}`;
  state.nextTraceId += 1;
  return traceId;
}

function nextSpanId(): string {
  const spanId = `span-${state.nextSpanId}`;
  state.nextSpanId += 1;
  return spanId;
}

function mergeAttrs(base?: PerfAttrs, extra?: PerfAttrs): PerfAttrs | undefined {
  if (base === undefined && extra === undefined) {
    return undefined;
  }

  if (base === undefined) {
    return extra;
  }

  if (extra === undefined) {
    return base;
  }

  return { ...base, ...extra };
}

function writeDurationRecord(
  name: string,
  startedAtNs: bigint,
  attrs?: PerfAttrs,
  traceId?: string,
  spanId?: string,
  parentSpanId?: string
): void {
  if (!state.enabled) {
    return;
  }

  const endedAtNs = perfNowNs();
  const endedAtMs = Date.now();
  const record: PerfSpanRecord = {
    type: 'span',
    name,
    'start-ns': startedAtNs.toString(),
    'duration-ns': (endedAtNs - startedAtNs).toString(),
    'end-ms': endedAtMs,
    'trace-id': traceId ?? nextTraceId(),
    'span-id': spanId ?? nextSpanId()
  };

  if (parentSpanId !== undefined) {
    record['parent-span-id'] = parentSpanId;
  }
  if (attrs !== undefined) {
    record.attrs = attrs;
  }

  writeRecord(record);
}

class ActivePerfSpan {
  private ended = false;
  private readonly name: string;
  private readonly startedAtNs: bigint;
  private readonly attrs: PerfAttrs | undefined;
  private readonly traceId: string;
  private readonly spanId: string;
  private readonly parentSpanId: string | undefined;

  constructor(
    name: string,
    startedAtNs: bigint,
    attrs: PerfAttrs | undefined,
    traceId: string,
    spanId: string,
    parentSpanId: string | undefined
  ) {
    this.name = name;
    this.startedAtNs = startedAtNs;
    this.attrs = attrs;
    this.traceId = traceId;
    this.spanId = spanId;
    this.parentSpanId = parentSpanId;
  }

  end(extraAttrs?: PerfAttrs): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    writeDurationRecord(
      this.name,
      this.startedAtNs,
      mergeAttrs(this.attrs, extraAttrs),
      this.traceId,
      this.spanId,
      this.parentSpanId
    );
  }
}

interface PerfSpan {
  end(extraAttrs?: PerfAttrs): void;
}

const NOOP_PERF_SPAN: PerfSpan = {
  end(): void {
    return;
  }
};

export function configurePerfCore(config: PerfCoreConfig): void {
  const nextFilePath = config.filePath ?? state.filePath;
  const pathChanged = resolve(nextFilePath) !== resolve(state.filePath);

  if (pathChanged || (!config.enabled && state.enabled)) {
    closeWriter();
  }

  state.enabled = config.enabled;
  state.filePath = nextFilePath;
  state.sampleCounters.clear();

  if (state.enabled) {
    ensureWriter();
  }
}

export function isPerfCoreEnabled(): boolean {
  return state.enabled;
}

export function perfNowNs(): bigint {
  return process.hrtime.bigint();
}

export function startPerfSpan(
  name: string,
  attrs?: PerfAttrs,
  parentSpanId?: string
): PerfSpan {
  if (!state.enabled) {
    return NOOP_PERF_SPAN;
  }

  return new ActivePerfSpan(
    name,
    perfNowNs(),
    attrs,
    nextTraceId(),
    nextSpanId(),
    parentSpanId
  );
}

export function recordPerfDuration(name: string, startedAtNs: bigint, attrs?: PerfAttrs): void {
  writeDurationRecord(name, startedAtNs, attrs);
}

export function recordPerfEvent(name: string, attrs?: PerfAttrs): void {
  if (!state.enabled || !shouldRecordEvent(name)) {
    return;
  }

  const record: PerfEventRecord = {
    type: 'event',
    name,
    'ts-ns': perfNowNs().toString(),
    'ts-ms': Date.now()
  };
  if (attrs !== undefined) {
    record.attrs = attrs;
  }
  writeRecord(record);
}

export function shutdownPerfCore(): void {
  closeWriter();
}
