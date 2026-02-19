import { createHash } from 'node:crypto';

export type CodexTelemetrySource = 'otlp-log' | 'otlp-metric' | 'otlp-trace' | 'history';
export type CodexStatusHint = 'running' | 'completed' | 'needs-input';

export interface ParsedCodexTelemetryEvent {
  readonly source: CodexTelemetrySource;
  readonly observedAt: string;
  readonly eventName: string | null;
  readonly severity: string | null;
  readonly summary: string | null;
  readonly providerThreadId: string | null;
  readonly statusHint: CodexStatusHint | null;
  readonly payload: Record<string, unknown>;
}

export interface CodexTelemetryConfigArgsInput {
  readonly endpointBaseUrl: string;
  readonly token: string;
  readonly logUserPrompt: boolean;
  readonly captureLogs: boolean;
  readonly captureMetrics: boolean;
  readonly captureTraces: boolean;
  readonly historyPersistence: 'save-all' | 'none';
}

interface OtlpAttribute {
  key: string;
  value: unknown;
}

function normalizeLookupKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value;
}

function readStringTrimmed(value: unknown): string | null {
  const parsed = readString(value);
  if (parsed === null) {
    return null;
  }
  const trimmed = parsed.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

function normalizeEpochTimestamp(input: number, fallback: string): string {
  if (!Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  const abs = Math.abs(input);
  let epochMs: number;
  if (abs >= 1e18) {
    epochMs = Math.floor(input / 1_000_000);
  } else if (abs >= 1e15) {
    epochMs = Math.floor(input / 1_000);
  } else if (abs >= 1e12) {
    epochMs = Math.floor(input);
  } else {
    epochMs = Math.floor(input * 1_000);
  }
  if (!Number.isFinite(epochMs) || epochMs <= 0) {
    return fallback;
  }
  const parsed = new Date(epochMs);
  if (!Number.isFinite(parsed.getTime())) {
    return fallback;
  }
  return parsed.toISOString();
}

function normalizeIso(ts: unknown, fallback: string): string {
  if (typeof ts === 'string') {
    const trimmed = ts.trim();
    if (trimmed.length === 0) {
      return fallback;
    }
    if (/^-?\d+(\.\d+)?$/u.test(trimmed)) {
      const numeric = Number(trimmed);
      return normalizeEpochTimestamp(numeric, fallback);
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    return normalizeEpochTimestamp(ts, fallback);
  }
  return fallback;
}

export function normalizeNanoTimestamp(nanoValue: unknown, fallback: string): string {
  let numericNano: number | null = null;
  if (typeof nanoValue === 'number' && Number.isFinite(nanoValue)) {
    numericNano = nanoValue;
  } else if (typeof nanoValue === 'string' && /^\d+$/u.test(nanoValue)) {
    const parsed = Number.parseInt(nanoValue, 10);
    if (Number.isFinite(parsed)) {
      numericNano = parsed;
    }
  }
  if (numericNano === null || numericNano <= 0) {
    return fallback;
  }
  const epochMs = Math.floor(numericNano / 1_000_000);
  if (!Number.isFinite(epochMs) || epochMs <= 0) {
    return fallback;
  }
  const parsed = new Date(epochMs);
  if (!Number.isFinite(parsed.getTime())) {
    return fallback;
  }
  return parsed.toISOString();
}

function parseAnyValue(value: unknown): unknown {
  const record = asRecord(value);
  if (record === null) {
    return value;
  }
  if (record['stringValue'] !== undefined) {
    return record['stringValue'];
  }
  if (record['boolValue'] !== undefined) {
    return record['boolValue'];
  }
  if (record['intValue'] !== undefined) {
    const intValue = record['intValue'];
    let parsedIntValue: number | string | null = null;
    if (typeof intValue === 'number') {
      parsedIntValue = intValue;
    } else if (typeof intValue === 'string') {
      const parsed = Number.parseInt(intValue, 10);
      parsedIntValue = Number.isFinite(parsed) ? parsed : intValue;
    }
    if (parsedIntValue !== null) {
      return parsedIntValue;
    }
  }
  if (record['doubleValue'] !== undefined) {
    return record['doubleValue'];
  }
  if (record['bytesValue'] !== undefined) {
    return record['bytesValue'];
  }
  const arrayValue = asRecord(record['arrayValue']);
  if (arrayValue !== null && Array.isArray(arrayValue['values'])) {
    return arrayValue['values'].map((entry) => parseAnyValue(entry));
  }
  const kvlistValue = asRecord(record['kvlistValue']);
  if (kvlistValue !== null && Array.isArray(kvlistValue['values'])) {
    const out: Record<string, unknown> = {};
    for (const kvEntry of kvlistValue['values']) {
      const kvRecord = asRecord(kvEntry);
      if (kvRecord === null) {
        continue;
      }
      const key = readString(kvRecord['key']);
      if (key === null) {
        continue;
      }
      out[key] = parseAnyValue(kvRecord['value']);
    }
    return out;
  }
  return record;
}

function parseOtlpAttributes(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const entry of value) {
    const item = asRecord(entry) as OtlpAttribute | null;
    if (item === null || typeof item.key !== 'string') {
      continue;
    }
    out[item.key] = parseAnyValue(item.value);
  }
  return out;
}

function asSummaryText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    return null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function compactSummaryText(value: string | null, maxLength = 72): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function findNestedFieldByKey(
  value: unknown,
  targetKeys: ReadonlySet<string>,
  depth = 0,
  maxDepth = 4,
  budget: { remaining: number } = { remaining: 160 },
): unknown {
  if (budget.remaining <= 0 || depth > maxDepth) {
    return undefined;
  }
  budget.remaining -= 1;
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findNestedFieldByKey(entry, targetKeys, depth + 1, maxDepth, budget);
      if (nested !== undefined) {
        return nested;
      }
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    if (targetKeys.has(normalizeLookupKey(key))) {
      return entry;
    }
  }
  for (const entry of Object.values(record)) {
    const nested = findNestedFieldByKey(entry, targetKeys, depth + 1, maxDepth, budget);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function pickFieldValue(
  attributes: Record<string, unknown>,
  body: unknown,
  keys: readonly string[],
): unknown {
  const normalizedKeys = new Set(keys.map((key) => normalizeLookupKey(key)));
  for (const [key, value] of Object.entries(attributes)) {
    if (normalizedKeys.has(normalizeLookupKey(key))) {
      return value;
    }
  }
  return findNestedFieldByKey(body, normalizedKeys);
}

function pickFieldText(
  attributes: Record<string, unknown>,
  body: unknown,
  keys: readonly string[],
): string | null {
  return asSummaryText(pickFieldValue(attributes, body, keys));
}

function pickFieldNumber(
  attributes: Record<string, unknown>,
  body: unknown,
  keys: readonly string[],
): number | null {
  return readFiniteNumber(pickFieldValue(attributes, body, keys));
}

function includesAnySubstring(input: string, candidates: readonly string[]): boolean {
  for (const candidate of candidates) {
    if (input.includes(candidate)) {
      return true;
    }
  }
  return false;
}

const NEEDS_INPUT_HINT_TOKENS = [
  'needs-input',
  'needs_input',
  'attention-required',
  'attention_required',
  'input-required',
  'approval-required',
  'approval_required',
] as const;

const COMPLETED_HINT_TOKENS = [
  'interrupted',
  'interrupt',
  'aborted',
  'abort',
  'cancelled',
  'canceled',
  'cancel',
  'response.interrupted',
  'response.aborted',
  'response.cancelled',
  'response.canceled',
  'response.incomplete',
  'turn_aborted',
  'turn-aborted',
] as const;

const LIFECYCLE_TELEMETRY_EVENT_NAMES = new Set([
  'codex.user_prompt',
  'codex.turn.e2e_duration_ms',
  'codex.conversation_starts',
]);

function isLifecycleTelemetryEventName(eventName: string | null): boolean {
  const normalized = eventName?.trim().toLowerCase() ?? '';
  if (normalized.length === 0) {
    return false;
  }
  return LIFECYCLE_TELEMETRY_EVENT_NAMES.has(normalized);
}

function statusFromOutcomeText(value: string | null): CodexStatusHint | null {
  const normalized = value?.toLowerCase().trim() ?? '';
  if (normalized.length === 0) {
    return null;
  }
  if (includesAnySubstring(normalized, NEEDS_INPUT_HINT_TOKENS)) {
    return 'needs-input';
  }
  return null;
}

function statusFromStructuredOutcome(value: string | null): CodexStatusHint | null {
  const normalized = value?.toLowerCase().trim() ?? '';
  if (normalized.length === 0) {
    return null;
  }
  if (includesAnySubstring(normalized, NEEDS_INPUT_HINT_TOKENS)) {
    return 'needs-input';
  }
  if (includesAnySubstring(normalized, COMPLETED_HINT_TOKENS)) {
    return 'completed';
  }
  return null;
}

function completedHintFromEventName(value: string | null): CodexStatusHint | null {
  const normalized = value?.toLowerCase().trim() ?? '';
  if (!normalized.startsWith('codex.')) {
    return null;
  }
  if (
    normalized.includes('interrupt') ||
    normalized.includes('abort') ||
    normalized.includes('cancel') ||
    normalized.includes('incomplete')
  ) {
    return 'completed';
  }
  return null;
}

function pickEventName(
  explicit: unknown,
  attributes: Record<string, unknown>,
  body: unknown,
): string | null {
  const candidates = [
    explicit,
    attributes['event.name'],
    attributes['name'],
    attributes['codex.event'],
    attributes['event'],
    asRecord(body)?.['event'],
    asRecord(body)?.['name'],
    asRecord(body)?.['type'],
    body,
  ];
  for (const candidate of candidates) {
    const value = asSummaryText(candidate);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function collectThreadIdCandidates(
  value: unknown,
  output: string[],
  directMatch: boolean,
  depth: number,
  maxDepth: number,
  maxValues: number,
): void {
  if (depth > maxDepth) {
    return;
  }
  if (typeof value === 'string') {
    if (directMatch && value.trim().length > 0) {
      output.push(value.trim());
    }
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectThreadIdCandidates(entry, output, directMatch, depth + 1, maxDepth, maxValues);
      if (output.length >= maxValues) {
        return;
      }
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === 'threadid' ||
      normalizedKey === 'thread_id' ||
      normalizedKey === 'thread-id' ||
      normalizedKey === 'sessionid' ||
      normalizedKey === 'session_id' ||
      normalizedKey === 'session-id' ||
      normalizedKey === 'conversationid' ||
      normalizedKey === 'conversation_id' ||
      normalizedKey === 'conversation-id'
    ) {
      collectThreadIdCandidates(nested, output, true, depth + 1, maxDepth, maxValues);
    } else if (
      normalizedKey === 'attributes' ||
      normalizedKey === 'payload' ||
      normalizedKey === 'body' ||
      normalizedKey === 'metadata' ||
      normalizedKey === 'context' ||
      normalizedKey === 'data' ||
      normalizedKey === 'resource' ||
      normalizedKey === 'metric' ||
      normalizedKey === 'span' ||
      normalizedKey === 'entry'
    ) {
      collectThreadIdCandidates(nested, output, directMatch, depth + 1, maxDepth, maxValues);
    }
    if (output.length >= maxValues) {
      return;
    }
  }
}

export function extractCodexThreadId(payload: unknown): string | null {
  const candidates: string[] = [];
  collectThreadIdCandidates(payload, candidates, false, 0, 4, 16);
  if (candidates.length === 0) {
    return null;
  }
  return candidates[0] as string;
}

function deriveStatusHint(
  eventName: string | null,
  severity: string | null,
  summary: string | null,
  payload: Record<string, unknown>,
): CodexStatusHint | null {
  const normalizedEventName = eventName?.toLowerCase().trim() ?? '';
  if (normalizedEventName === 'codex.user_prompt') {
    return 'running';
  }
  if (normalizedEventName === 'codex.turn.e2e_duration_ms') {
    return 'completed';
  }

  const payloadAttributes = asRecord(payload['attributes']) ?? {};
  const payloadBody = payload['body'];
  const outcomeHint = statusFromStructuredOutcome(
    pickFieldText(payloadAttributes, payloadBody, [
      'status',
      'result',
      'outcome',
      'decision',
      'kind',
      'event.kind',
      'event_type',
      'event.type',
      'type',
    ]),
  );
  if (outcomeHint !== null) {
    return outcomeHint;
  }
  if (summary !== null) {
    const fromSummary = statusFromOutcomeText(summary);
    if (fromSummary !== null) {
      return fromSummary;
    }
  }
  return completedHintFromEventName(eventName);
}

function buildLogSummary(
  eventName: string | null,
  body: unknown,
  attributes: Record<string, unknown>,
): string | null {
  const normalizedEventName = eventName?.toLowerCase().trim() ?? '';
  const bodyText = asSummaryText(body);
  const eventText = eventName?.trim() ?? null;
  const statusText =
    pickFieldText(attributes, body, ['status', 'result', 'outcome', 'decision']) ??
    asSummaryText(attributes['status']) ??
    asSummaryText(attributes['result']);
  const kindText = pickFieldText(attributes, body, [
    'kind',
    'event.kind',
    'event_type',
    'event.type',
    'type',
  ]);
  const toolText = pickFieldText(attributes, body, [
    'tool.name',
    'tool_name',
    'toolName',
    'tool',
    'name',
  ]);
  const modelText = pickFieldText(attributes, body, ['model', 'model_name', 'modelName']);
  const durationMs = pickFieldNumber(attributes, body, [
    'duration_ms',
    'durationMs',
    'latency_ms',
    'elapsed_ms',
  ]);

  if (normalizedEventName === 'codex.user_prompt') {
    const promptText = compactSummaryText(bodyText);
    return promptText === null ? 'prompt submitted' : `prompt: ${promptText}`;
  }
  if (normalizedEventName === 'codex.conversation_starts') {
    const model = compactSummaryText(modelText);
    return model === null ? 'conversation started' : `conversation started (${model})`;
  }
  if (normalizedEventName === 'codex.api_request') {
    const outcome = compactSummaryText(statusText);
    if (outcome !== null && durationMs !== null) {
      return `model request ${outcome} (${durationMs.toFixed(0)}ms)`;
    }
    if (outcome !== null) {
      return `model request ${outcome}`;
    }
    if (durationMs !== null) {
      return `model request (${durationMs.toFixed(0)}ms)`;
    }
    return 'model request';
  }
  if (normalizedEventName === 'codex.sse_event') {
    const kind = compactSummaryText(kindText ?? bodyText);
    return kind === null ? 'stream event' : `stream ${kind}`;
  }
  if (normalizedEventName === 'codex.tool_decision') {
    const decision = compactSummaryText(statusText);
    const tool = compactSummaryText(toolText);
    if (decision !== null && tool !== null) {
      return `approval ${decision} (${tool})`;
    }
    if (decision !== null) {
      return `approval ${decision}`;
    }
    if (tool !== null) {
      return `approval (${tool})`;
    }
    return 'approval decision';
  }
  if (normalizedEventName === 'codex.tool_result') {
    const tool = compactSummaryText(toolText);
    const outcome = compactSummaryText(statusText);
    if (tool !== null && outcome !== null && durationMs !== null) {
      return `tool ${tool} ${outcome} (${durationMs.toFixed(0)}ms)`;
    }
    if (tool !== null && outcome !== null) {
      return `tool ${tool} ${outcome}`;
    }
    if (tool !== null && durationMs !== null) {
      return `tool ${tool} (${durationMs.toFixed(0)}ms)`;
    }
    if (tool !== null) {
      return `tool ${tool}`;
    }
    if (outcome !== null) {
      return `tool result ${outcome}`;
    }
    return 'tool result';
  }
  if (normalizedEventName === 'codex.websocket_request') {
    if (durationMs !== null) {
      return `realtime request (${durationMs.toFixed(0)}ms)`;
    }
    return 'realtime request';
  }
  if (normalizedEventName === 'codex.websocket_event') {
    const kind = compactSummaryText(kindText ?? bodyText);
    const outcome = compactSummaryText(statusText);
    if (kind !== null && outcome !== null) {
      return `realtime ${kind} (${outcome})`;
    }
    if (kind !== null) {
      return `realtime ${kind}`;
    }
    if (outcome !== null) {
      return `realtime event (${outcome})`;
    }
    return 'realtime event';
  }
  if (eventText !== null && statusText !== null) {
    return `${eventText} (${statusText})`;
  }
  if (eventText !== null && bodyText !== null && bodyText !== eventText) {
    return `${eventText}: ${bodyText}`;
  }
  return eventText ?? bodyText;
}

export function parseOtlpLogEvents(
  payload: unknown,
  observedAtFallback: string,
): readonly ParsedCodexTelemetryEvent[] {
  const root = asRecord(payload);
  if (root === null || !Array.isArray(root['resourceLogs'])) {
    return [];
  }
  const events: ParsedCodexTelemetryEvent[] = [];

  for (const resourceLog of root['resourceLogs']) {
    const resourceLogRecord = asRecord(resourceLog);
    if (resourceLogRecord === null) {
      continue;
    }
    const resourceRecord = asRecord(resourceLogRecord['resource']);
    const resourceAttributes = parseOtlpAttributes(resourceRecord?.['attributes']);
    const scopeLogs = resourceLogRecord['scopeLogs'];
    if (!Array.isArray(scopeLogs)) {
      continue;
    }
    for (const scopeLog of scopeLogs) {
      const scopeLogRecord = asRecord(scopeLog);
      if (scopeLogRecord === null || !Array.isArray(scopeLogRecord['logRecords'])) {
        continue;
      }
      const scopeRecord = asRecord(scopeLogRecord['scope']);
      const scopeAttributes = parseOtlpAttributes(scopeRecord?.['attributes']);

      for (const logRecord of scopeLogRecord['logRecords']) {
        const item = asRecord(logRecord);
        if (item === null) {
          continue;
        }
        const attributes = parseOtlpAttributes(item['attributes']);
        const body = parseAnyValue(item['body']);
        const observedAt = normalizeNanoTimestamp(
          item['timeUnixNano'],
          normalizeNanoTimestamp(item['observedTimeUnixNano'], observedAtFallback),
        );
        const eventName = pickEventName(attributes['event.name'], attributes, body);
        const severity = readStringTrimmed(item['severityText']);
        const payloadRecord: Record<string, unknown> = {
          resource: resourceAttributes,
          scope: scopeAttributes,
          attributes,
          body,
        };
        const summary = buildLogSummary(eventName, body, attributes);
        events.push({
          source: 'otlp-log',
          observedAt,
          eventName,
          severity,
          summary,
          providerThreadId: extractCodexThreadId(payloadRecord),
          statusHint: deriveStatusHint(eventName, severity, summary, payloadRecord),
          payload: payloadRecord,
        });
      }
    }
  }

  return events;
}

function metricDataPoints(metric: Record<string, unknown>): readonly Record<string, unknown>[] {
  const candidates = [
    asRecord(metric['sum'])?.['dataPoints'],
    asRecord(metric['gauge'])?.['dataPoints'],
    asRecord(metric['histogram'])?.['dataPoints'],
    asRecord(metric['exponentialHistogram'])?.['dataPoints'],
    asRecord(metric['summary'])?.['dataPoints'],
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    return candidate.flatMap((entry) => {
      const record = asRecord(entry);
      return record === null ? [] : [record];
    });
  }
  return [];
}

function readMetricPointValue(point: Record<string, unknown>): number | null {
  const direct = readFiniteNumber(point['asDouble']) ?? readFiniteNumber(point['asInt']);
  if (direct !== null) {
    return direct;
  }
  const sum = readFiniteNumber(point['sum']);
  if (sum !== null) {
    return sum;
  }
  return null;
}

export function parseOtlpMetricEvents(
  payload: unknown,
  observedAtFallback: string,
): readonly ParsedCodexTelemetryEvent[] {
  const root = asRecord(payload);
  if (root === null || !Array.isArray(root['resourceMetrics'])) {
    return [];
  }
  const events: ParsedCodexTelemetryEvent[] = [];
  for (const resourceMetric of root['resourceMetrics']) {
    const resourceMetricRecord = asRecord(resourceMetric);
    if (resourceMetricRecord === null || !Array.isArray(resourceMetricRecord['scopeMetrics'])) {
      continue;
    }
    const resourceRecord = asRecord(resourceMetricRecord['resource']);
    const resourceAttributes = parseOtlpAttributes(resourceRecord?.['attributes']);
    for (const scopeMetric of resourceMetricRecord['scopeMetrics']) {
      const scopeMetricRecord = asRecord(scopeMetric);
      if (scopeMetricRecord === null || !Array.isArray(scopeMetricRecord['metrics'])) {
        continue;
      }
      for (const metricValue of scopeMetricRecord['metrics']) {
        const metric = asRecord(metricValue);
        if (metric === null) {
          continue;
        }
        const metricName = readStringTrimmed(metric['name']);
        const points = metricDataPoints(metric);
        const pointCount = points.length;
        const firstPointValue = points.length > 0 ? readMetricPointValue(points[0]!) : null;
        const payloadRecord: Record<string, unknown> = {
          resource: resourceAttributes,
          metric,
        };
        let summary: string;
        if (metricName === 'codex.turn.e2e_duration_ms' && firstPointValue !== null) {
          summary = `turn complete (${firstPointValue.toFixed(0)}ms)`;
        } else if (metricName === 'codex.conversation.turn.count' && firstPointValue !== null) {
          summary = `turn count ${String(Math.max(0, Math.round(firstPointValue)))}`;
        } else {
          summary =
            metricName === null
              ? `metric points=${String(pointCount)}`
              : `${metricName} points=${String(pointCount)}`;
        }
        const statusHint = metricName === 'codex.turn.e2e_duration_ms' ? 'completed' : null;
        events.push({
          source: 'otlp-metric',
          observedAt: observedAtFallback,
          eventName: metricName,
          severity: null,
          summary,
          providerThreadId: extractCodexThreadId(payloadRecord),
          statusHint,
          payload: payloadRecord,
        });
      }
    }
  }
  return events;
}

export function parseOtlpTraceEvents(
  payload: unknown,
  observedAtFallback: string,
): readonly ParsedCodexTelemetryEvent[] {
  const root = asRecord(payload);
  if (root === null || !Array.isArray(root['resourceSpans'])) {
    return [];
  }
  const events: ParsedCodexTelemetryEvent[] = [];
  for (const resourceSpan of root['resourceSpans']) {
    const resourceSpanRecord = asRecord(resourceSpan);
    if (resourceSpanRecord === null || !Array.isArray(resourceSpanRecord['scopeSpans'])) {
      continue;
    }
    const resourceRecord = asRecord(resourceSpanRecord['resource']);
    const resourceAttributes = parseOtlpAttributes(resourceRecord?.['attributes']);
    for (const scopeSpan of resourceSpanRecord['scopeSpans']) {
      const scopeSpanRecord = asRecord(scopeSpan);
      if (scopeSpanRecord === null || !Array.isArray(scopeSpanRecord['spans'])) {
        continue;
      }
      for (const spanValue of scopeSpanRecord['spans']) {
        const span = asRecord(spanValue);
        if (span === null) {
          continue;
        }
        const attributes = parseOtlpAttributes(span['attributes']);
        const spanName = readStringTrimmed(span['name']);
        const observedAt = normalizeNanoTimestamp(span['endTimeUnixNano'], observedAtFallback);
        const kind = pickFieldText(attributes, span, [
          'kind',
          'event.kind',
          'event_type',
          'event.type',
          'type',
        ]);
        const status = pickFieldText(attributes, span, ['status', 'result', 'outcome']);
        const summary =
          spanName === null
            ? (compactSummaryText(kind) ?? compactSummaryText(status) ?? 'span')
            : (compactSummaryText(
                kind === null
                  ? status === null
                    ? spanName
                    : `${spanName} (${status})`
                  : `${spanName}: ${kind}`,
              ) as string);
        const payloadRecord: Record<string, unknown> = {
          resource: resourceAttributes,
          attributes,
          span,
        };
        events.push({
          source: 'otlp-trace',
          observedAt,
          eventName: spanName,
          severity: null,
          summary,
          providerThreadId: extractCodexThreadId(payloadRecord),
          statusHint: null,
          payload: payloadRecord,
        });
      }
    }
  }
  return events;
}

function readOtlpTextValue(value: unknown): string | null {
  const record = asRecord(value);
  if (record === null) {
    return asSummaryText(value);
  }
  if (record['stringValue'] !== undefined) {
    return asSummaryText(record['stringValue']);
  }
  if (record['boolValue'] !== undefined) {
    return asSummaryText(record['boolValue']);
  }
  if (record['intValue'] !== undefined) {
    return asSummaryText(record['intValue']);
  }
  if (record['doubleValue'] !== undefined) {
    return asSummaryText(record['doubleValue']);
  }
  return null;
}

function parseOtlpAttributeTextMap(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const entry of value) {
    const record = asRecord(entry);
    if (record === null) {
      continue;
    }
    const key = readStringTrimmed(record['key']);
    if (key === null) {
      continue;
    }
    const parsedValue = readOtlpTextValue(record['value']);
    if (parsedValue === null) {
      continue;
    }
    out[key] = parsedValue;
  }
  return out;
}

function pickAttributeText(
  attributes: Record<string, string>,
  keys: readonly string[],
): string | null {
  const normalizedKeys = new Set(keys.map((key) => normalizeLookupKey(key)));
  for (const [key, value] of Object.entries(attributes)) {
    if (normalizedKeys.has(normalizeLookupKey(key))) {
      return value;
    }
  }
  return null;
}

function lifecycleSummaryFromEventName(
  eventName: string | null,
  statusHint: CodexStatusHint | null,
  attributes: Record<string, string>,
): string | null {
  const normalizedEventName = eventName?.trim().toLowerCase() ?? '';
  if (normalizedEventName === 'codex.user_prompt') {
    return 'prompt submitted';
  }
  if (normalizedEventName === 'codex.conversation_starts') {
    const model = pickAttributeText(attributes, ['model', 'model_name', 'modelName']);
    if (model !== null) {
      return `conversation started (${compactSummaryText(model)})`;
    }
    return 'conversation started';
  }
  if (normalizedEventName === 'codex.turn.e2e_duration_ms') {
    return 'turn complete';
  }
  if (normalizedEventName === 'codex.sse_event') {
    const kind = pickAttributeText(attributes, [
      'kind',
      'event.kind',
      'event_type',
      'event.type',
      'type',
    ]);
    return kind === null ? 'stream event' : `stream ${compactSummaryText(kind)}`;
  }
  return statusHint === 'needs-input' ? 'needs-input' : null;
}

function lifecycleEventNameFromAttributes(
  attributes: Record<string, string>,
  bodyText: string | null,
): string | null {
  return (
    pickAttributeText(attributes, ['event.name', 'name', 'codex.event', 'event', 'type']) ??
    compactSummaryText(bodyText)
  );
}

function lifecycleThreadIdFromAttributes(attributes: Record<string, string>): string | null {
  return pickAttributeText(attributes, [
    'thread-id',
    'thread_id',
    'threadid',
    'session-id',
    'session_id',
    'sessionid',
    'conversation-id',
    'conversation_id',
    'conversationid',
  ]);
}

function lifecycleStatusHintFromAttributes(
  eventName: string | null,
  attributes: Record<string, string>,
  bodyText: string | null,
): CodexStatusHint | null {
  const normalizedEventName = eventName?.toLowerCase().trim() ?? '';
  if (normalizedEventName === 'codex.user_prompt') {
    return 'running';
  }
  if (normalizedEventName === 'codex.turn.e2e_duration_ms') {
    return 'completed';
  }
  const statusToken = pickAttributeText(attributes, [
    'status',
    'result',
    'outcome',
    'decision',
    'kind',
    'event.kind',
    'event_type',
    'event.type',
    'type',
  ]);
  const statusHint = statusFromStructuredOutcome(statusToken);
  if (statusHint !== null) {
    return statusHint;
  }
  const bodyHint = statusFromOutcomeText(bodyText);
  if (bodyHint !== null) {
    return bodyHint;
  }
  return completedHintFromEventName(eventName) ?? statusFromOutcomeText(eventName);
}

function shouldRetainLifecycleEvent(
  eventName: string | null,
  statusHint: CodexStatusHint | null,
): boolean {
  return isLifecycleTelemetryEventName(eventName) || statusHint !== null;
}

export function parseOtlpLifecycleLogEvents(
  payload: unknown,
  observedAtFallback: string,
): readonly ParsedCodexTelemetryEvent[] {
  const root = asRecord(payload);
  if (root === null || !Array.isArray(root['resourceLogs'])) {
    return [];
  }
  const events: ParsedCodexTelemetryEvent[] = [];
  for (const resourceLog of root['resourceLogs']) {
    const resourceLogRecord = asRecord(resourceLog);
    if (resourceLogRecord === null) {
      continue;
    }
    const scopeLogs = resourceLogRecord['scopeLogs'];
    if (!Array.isArray(scopeLogs)) {
      continue;
    }
    for (const scopeLog of scopeLogs) {
      const scopeLogRecord = asRecord(scopeLog);
      if (scopeLogRecord === null || !Array.isArray(scopeLogRecord['logRecords'])) {
        continue;
      }
      for (const logRecord of scopeLogRecord['logRecords']) {
        const item = asRecord(logRecord);
        if (item === null) {
          continue;
        }
        const attributes = parseOtlpAttributeTextMap(item['attributes']);
        const bodyText = readOtlpTextValue(item['body']);
        const eventName = lifecycleEventNameFromAttributes(attributes, bodyText);
        const statusHint = lifecycleStatusHintFromAttributes(eventName, attributes, bodyText);
        if (!shouldRetainLifecycleEvent(eventName, statusHint)) {
          continue;
        }
        const observedAt = normalizeNanoTimestamp(
          item['timeUnixNano'],
          normalizeNanoTimestamp(item['observedTimeUnixNano'], observedAtFallback),
        );
        const severity = readStringTrimmed(item['severityText']);
        const providerThreadId = lifecycleThreadIdFromAttributes(attributes);
        const summary = lifecycleSummaryFromEventName(eventName, statusHint, attributes);
        events.push({
          source: 'otlp-log',
          observedAt,
          eventName,
          severity,
          summary,
          providerThreadId,
          statusHint,
          payload: {
            attributes,
            body: bodyText,
          },
        });
      }
    }
  }
  return events;
}

function metricDataPointsShallow(
  metric: Record<string, unknown>,
): readonly Record<string, unknown>[] {
  const candidates = [
    asRecord(metric['sum'])?.['dataPoints'],
    asRecord(metric['gauge'])?.['dataPoints'],
    asRecord(metric['histogram'])?.['dataPoints'],
    asRecord(metric['exponentialHistogram'])?.['dataPoints'],
    asRecord(metric['summary'])?.['dataPoints'],
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    return candidate.flatMap((entry) => {
      const record = asRecord(entry);
      return record === null ? [] : [record];
    });
  }
  return [];
}

function readMetricPointValueShallow(point: Record<string, unknown>): number | null {
  return (
    readFiniteNumber(point['asDouble']) ??
    readFiniteNumber(point['asInt']) ??
    readFiniteNumber(point['sum'])
  );
}

export function parseOtlpLifecycleMetricEvents(
  payload: unknown,
  observedAtFallback: string,
): readonly ParsedCodexTelemetryEvent[] {
  const root = asRecord(payload);
  if (root === null || !Array.isArray(root['resourceMetrics'])) {
    return [];
  }
  const events: ParsedCodexTelemetryEvent[] = [];
  for (const resourceMetric of root['resourceMetrics']) {
    const resourceMetricRecord = asRecord(resourceMetric);
    if (resourceMetricRecord === null || !Array.isArray(resourceMetricRecord['scopeMetrics'])) {
      continue;
    }
    const resourceAttributes = parseOtlpAttributeTextMap(
      asRecord(resourceMetricRecord['resource'])?.['attributes'],
    );
    for (const scopeMetric of resourceMetricRecord['scopeMetrics']) {
      const scopeMetricRecord = asRecord(scopeMetric);
      if (scopeMetricRecord === null || !Array.isArray(scopeMetricRecord['metrics'])) {
        continue;
      }
      for (const metricValue of scopeMetricRecord['metrics']) {
        const metric = asRecord(metricValue);
        if (metric === null) {
          continue;
        }
        const eventName = readStringTrimmed(metric['name']);
        const statusHint = eventName === 'codex.turn.e2e_duration_ms' ? 'completed' : null;
        if (!shouldRetainLifecycleEvent(eventName, statusHint)) {
          continue;
        }
        const dataPoints = metricDataPointsShallow(metric);
        const firstPoint = dataPoints[0];
        const pointAttributes =
          firstPoint === undefined ? {} : parseOtlpAttributeTextMap(firstPoint['attributes']);
        const providerThreadId =
          lifecycleThreadIdFromAttributes(pointAttributes) ??
          lifecycleThreadIdFromAttributes(resourceAttributes);
        const firstValue =
          firstPoint === undefined ? null : readMetricPointValueShallow(firstPoint);
        const summary =
          eventName === 'codex.turn.e2e_duration_ms' && firstValue !== null
            ? `turn complete (${firstValue.toFixed(0)}ms)`
            : (compactSummaryText(eventName) ?? 'metric');
        const observedAt =
          firstPoint === undefined
            ? observedAtFallback
            : normalizeNanoTimestamp(firstPoint['timeUnixNano'], observedAtFallback);
        events.push({
          source: 'otlp-metric',
          observedAt,
          eventName,
          severity: null,
          summary,
          providerThreadId,
          statusHint,
          payload: {
            metricName: eventName,
            pointCount: dataPoints.length,
            firstPointValue: firstValue,
          },
        });
      }
    }
  }
  return events;
}

export function parseOtlpLifecycleTraceEvents(
  payload: unknown,
  observedAtFallback: string,
): readonly ParsedCodexTelemetryEvent[] {
  const root = asRecord(payload);
  if (root === null || !Array.isArray(root['resourceSpans'])) {
    return [];
  }
  const events: ParsedCodexTelemetryEvent[] = [];
  for (const resourceSpan of root['resourceSpans']) {
    const resourceSpanRecord = asRecord(resourceSpan);
    if (resourceSpanRecord === null || !Array.isArray(resourceSpanRecord['scopeSpans'])) {
      continue;
    }
    for (const scopeSpan of resourceSpanRecord['scopeSpans']) {
      const scopeSpanRecord = asRecord(scopeSpan);
      if (scopeSpanRecord === null || !Array.isArray(scopeSpanRecord['spans'])) {
        continue;
      }
      for (const spanValue of scopeSpanRecord['spans']) {
        const span = asRecord(spanValue);
        if (span === null) {
          continue;
        }
        const attributes = parseOtlpAttributeTextMap(span['attributes']);
        const eventName = readStringTrimmed(span['name']);
        const statusHint = lifecycleStatusHintFromAttributes(eventName, attributes, null);
        if (!shouldRetainLifecycleEvent(eventName, statusHint)) {
          continue;
        }
        const providerThreadId = lifecycleThreadIdFromAttributes(attributes);
        const observedAt = normalizeNanoTimestamp(span['endTimeUnixNano'], observedAtFallback);
        events.push({
          source: 'otlp-trace',
          observedAt,
          eventName,
          severity: null,
          summary: compactSummaryText(eventName) ?? 'span',
          providerThreadId,
          statusHint,
          payload: {
            attributes,
            spanName: eventName,
          },
        });
      }
    }
  }
  return events;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function tomlString(value: string): string {
  const escaped = value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
  return `"${escaped}"`;
}

export function buildCodexTelemetryConfigArgs(
  input: CodexTelemetryConfigArgsInput,
): readonly string[] {
  const baseEndpoint = trimTrailingSlash(input.endpointBaseUrl);
  const args: string[] = ['-c', `otel.log_user_prompt=${input.logUserPrompt ? 'true' : 'false'}`];
  if (input.captureLogs) {
    const endpoint = `${baseEndpoint}/v1/logs/${encodeURIComponent(input.token)}`;
    args.push('-c', `otel.exporter={otlp-http={endpoint=${tomlString(endpoint)},protocol="json"}}`);
  }
  if (input.captureMetrics) {
    const endpoint = `${baseEndpoint}/v1/metrics/${encodeURIComponent(input.token)}`;
    args.push(
      '-c',
      `otel.metrics_exporter={otlp-http={endpoint=${tomlString(endpoint)},protocol="json"}}`,
    );
  }
  if (input.captureTraces) {
    const endpoint = `${baseEndpoint}/v1/traces/${encodeURIComponent(input.token)}`;
    args.push(
      '-c',
      `otel.trace_exporter={otlp-http={endpoint=${tomlString(endpoint)},protocol="json"}}`,
    );
  }
  args.push('-c', `history.persistence=${tomlString(input.historyPersistence)}`);
  return args;
}

function pickHistoryEventName(record: Record<string, unknown>): string | null {
  const candidates = [record['type'], record['event'], record['name'], record['kind']];
  for (const candidate of candidates) {
    const parsed = readStringTrimmed(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return 'history.entry';
}

function pickHistoryObservedAt(record: Record<string, unknown>, fallback: string): string {
  const candidates = [record['timestamp'], record['ts'], record['time'], record['created_at']];
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }
    const normalized = normalizeIso(candidate, fallback);
    if (normalized !== fallback) {
      return normalized;
    }
  }
  return fallback;
}

function pickHistorySummary(record: Record<string, unknown>): string | null {
  const candidates = [
    record['summary'],
    record['message'],
    record['text'],
    asRecord(record['entry'])?.['text'],
  ];
  for (const candidate of candidates) {
    const parsed = asSummaryText(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

export function parseCodexHistoryLine(
  line: string,
  observedAtFallback: string,
): ParsedCodexTelemetryEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (record === null) {
    return null;
  }
  const observedAt = pickHistoryObservedAt(record, observedAtFallback);
  const eventName = pickHistoryEventName(record);
  const summary = pickHistorySummary(record);
  return {
    source: 'history',
    observedAt,
    eventName,
    severity: null,
    summary,
    providerThreadId: extractCodexThreadId(record),
    statusHint: deriveStatusHint(eventName, null, summary, record),
    payload: record,
  };
}

export function telemetryFingerprint(event: {
  source: CodexTelemetrySource;
  sessionId: string | null;
  providerThreadId: string | null;
  eventName: string | null;
  observedAt: string;
  payload: Record<string, unknown>;
}): string {
  const hash = createHash('sha1');
  hash.update(event.source);
  hash.update('\n');
  hash.update(event.sessionId ?? '');
  hash.update('\n');
  hash.update(event.providerThreadId ?? '');
  hash.update('\n');
  hash.update(event.eventName ?? '');
  hash.update('\n');
  hash.update(event.observedAt);
  hash.update('\n');
  hash.update(JSON.stringify(event.payload));
  return hash.digest('hex');
}
