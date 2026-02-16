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

const state: {
  enabled: boolean;
  filePath: string;
  fd: number | null;
  nextTraceId: number;
  nextSpanId: number;
} = {
  enabled: false,
  filePath: DEFAULT_FILE_PATH,
  fd: null,
  nextTraceId: 1,
  nextSpanId: 1
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
  if (state.fd === null) {
    return;
  }

  closeSync(state.fd);
  state.fd = null;
}

function writeRecord(record: PerfRecord): void {
  ensureWriter();
  writeSync(state.fd as number, `${JSON.stringify(record)}\n`);
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
  if (!state.enabled) {
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
