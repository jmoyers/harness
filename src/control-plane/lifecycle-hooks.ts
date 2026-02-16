import { randomUUID } from 'node:crypto';
import type {
  HarnessLifecycleEventType,
  HarnessLifecycleHooksConfig,
  HarnessLifecycleWebhookConfig
} from '../config/config-core.ts';
import { recordPerfEvent } from '../perf/perf-core.ts';
import type {
  StreamObservedEvent,
  StreamSessionRuntimeStatus,
  StreamTelemetrySource
} from './stream-protocol.ts';

type HarnessLifecycleProvider = 'codex' | 'claude' | 'control-plane' | 'unknown';

interface LifecycleObservedScope {
  tenantId: string;
  userId: string;
  workspaceId: string;
  directoryId: string | null;
  conversationId: string | null;
}

interface HarnessLifecycleEventEnvelope {
  readonly schemaVersion: '1';
  readonly eventId: string;
  readonly eventType: HarnessLifecycleEventType;
  readonly provider: HarnessLifecycleProvider;
  readonly observedType: StreamObservedEvent['type'];
  readonly ts: string;
  readonly cursor: number;
  readonly summary: string;
  readonly context: {
    tenantId: string;
    userId: string;
    workspaceId: string;
    directoryId: string | null;
    conversationId: string | null;
    sessionId: string | null;
  };
  readonly attributes: Readonly<Record<string, unknown>>;
}

interface LifecycleConnector {
  readonly id: string;
  dispatch(event: HarnessLifecycleEventEnvelope): Promise<void>;
  close?(): Promise<void>;
}

interface SessionStatusSnapshot {
  status: StreamSessionRuntimeStatus;
  live: boolean;
}

const SESSION_DEDUP_WINDOW_MS = 250;
const MAX_PENDING_EVENTS = 2048;
const OTLP_SOURCES = new Set<StreamTelemetrySource>(['history', 'otlp-log', 'otlp-metric', 'otlp-trace']);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTimestamp(candidate: string | null): string {
  if (candidate === null) {
    return new Date().toISOString();
  }
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) {
    return new Date().toISOString();
  }
  return new Date(parsed).toISOString();
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.endsWith('/')) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (timeoutMs <= 0) {
    return await fetch(url, init);
  }
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`request timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    timeout.unref();
  });
  try {
    return await Promise.race([
      fetch(url, {
        ...init,
        signal: controller.signal
      }),
      timeoutPromise
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}

class PeonPingLifecycleConnector implements LifecycleConnector {
  readonly id = 'peon-ping';
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly categoryByEvent: Readonly<Partial<Record<HarnessLifecycleEventType, string>>>;

  constructor(config: HarnessLifecycleHooksConfig['peonPing']) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.timeoutMs = config.timeoutMs;
    this.categoryByEvent = config.eventCategoryMap;
  }

  async dispatch(event: HarnessLifecycleEventEnvelope): Promise<void> {
    const category = this.categoryByEvent[event.eventType];
    if (category === undefined) {
      return;
    }
    const endpoint = new URL('/play', this.baseUrl);
    endpoint.searchParams.set('category', category);
    const response = await fetchWithTimeout(endpoint.toString(), { method: 'GET' }, this.timeoutMs);
    if (!response.ok) {
      throw new Error(`peon-ping connector failed status=${String(response.status)}`);
    }
  }
}

class WebhookLifecycleConnector implements LifecycleConnector {
  readonly id: string;
  private readonly url: string;
  private readonly method: string;
  private readonly timeoutMs: number;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly eventTypes: ReadonlySet<HarnessLifecycleEventType>;
  private readonly matchAllEventTypes: boolean;

  constructor(config: HarnessLifecycleWebhookConfig) {
    this.id = `webhook:${config.name}`;
    this.url = config.url;
    this.method = config.method;
    this.timeoutMs = config.timeoutMs;
    this.headers = config.headers;
    this.eventTypes = new Set(config.eventTypes);
    this.matchAllEventTypes = this.eventTypes.size === 0;
  }

  async dispatch(event: HarnessLifecycleEventEnvelope): Promise<void> {
    if (!this.matchAllEventTypes && !this.eventTypes.has(event.eventType)) {
      return;
    }
    const hasBody = this.method !== 'GET' && this.method !== 'HEAD';
    const headers: Record<string, string> = {
      ...this.headers
    };
    const init: RequestInit = {
      method: this.method,
      headers
    };
    if (hasBody) {
      if (headers['content-type'] === undefined) {
        headers['content-type'] = 'application/json';
      }
      init.body = JSON.stringify(event);
    }
    const response = await fetchWithTimeout(this.url, init, this.timeoutMs);
    if (!response.ok) {
      throw new Error(`${this.id} failed status=${String(response.status)}`);
    }
  }
}

function providerFromSessionKeyEvent(event: Extract<StreamObservedEvent, { type: 'session-key-event' }>): HarnessLifecycleProvider {
  const source = event.keyEvent.source;
  if (OTLP_SOURCES.has(source)) {
    return 'codex';
  }
  const eventName = event.keyEvent.eventName?.toLowerCase() ?? '';
  if (eventName.startsWith('codex.')) {
    return 'codex';
  }
  if (
    eventName.startsWith('claude.') ||
    eventName.includes('pretooluse') ||
    eventName.includes('posttooluse') ||
    eventName.includes('userpromptsubmit')
  ) {
    return 'claude';
  }
  return 'unknown';
}

function providerFromObservedEvent(event: StreamObservedEvent): HarnessLifecycleProvider {
  if (event.type === 'session-key-event') {
    return providerFromSessionKeyEvent(event);
  }
  return 'control-plane';
}

function conversationIdFromConversationRecord(event: {
  conversation: Record<string, unknown>;
}): string | null {
  const direct = readTrimmedString(event.conversation['conversationId']);
  if (direct !== null) {
    return direct;
  }
  return null;
}

function maybeToolFailure(summary: string | null, severity: string | null): boolean {
  const normalizedSummary = summary?.toLowerCase() ?? '';
  if (
    normalizedSummary.includes('error') ||
    normalizedSummary.includes('failed') ||
    normalizedSummary.includes('denied') ||
    normalizedSummary.includes('abort')
  ) {
    return true;
  }
  const normalizedSeverity = severity?.toLowerCase() ?? '';
  return normalizedSeverity === 'error' || normalizedSeverity === 'fatal';
}

export class LifecycleHooksRuntime {
  private readonly enabled: boolean;
  private readonly providers: HarnessLifecycleHooksConfig['providers'];
  private readonly connectors: readonly LifecycleConnector[];
  private readonly sessionStatusById = new Map<string, SessionStatusSnapshot>();
  private readonly lastEmitMsBySessionAndType = new Map<string, number>();
  private readonly pendingEvents: HarnessLifecycleEventEnvelope[] = [];
  private drainPromise: Promise<void> | null = null;
  private closing = false;

  constructor(config: HarnessLifecycleHooksConfig) {
    this.enabled = config.enabled;
    this.providers = config.providers;
    this.connectors = this.buildConnectors(config);
  }

  publish(scope: LifecycleObservedScope, event: StreamObservedEvent, cursor: number): void {
    if (!this.enabled || this.closing || this.connectors.length === 0) {
      return;
    }
    const normalizedEvents = this.normalizeObservedEvent(scope, event, cursor);
    if (normalizedEvents.length === 0) {
      return;
    }
    for (const normalizedEvent of normalizedEvents) {
      if (this.pendingEvents.length >= MAX_PENDING_EVENTS) {
        this.pendingEvents.shift();
      }
      this.pendingEvents.push(normalizedEvent);
    }
    this.startDrainIfNeeded();
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.drainPromise !== null) {
      await this.drainPromise;
    }
    for (const connector of this.connectors) {
      if (connector.close === undefined) {
        continue;
      }
      await connector.close();
    }
  }

  private buildConnectors(config: HarnessLifecycleHooksConfig): readonly LifecycleConnector[] {
    const connectors: LifecycleConnector[] = [];
    if (config.peonPing.enabled) {
      connectors.push(new PeonPingLifecycleConnector(config.peonPing));
    }
    for (const webhook of config.webhooks) {
      if (!webhook.enabled) {
        continue;
      }
      connectors.push(new WebhookLifecycleConnector(webhook));
    }
    return connectors;
  }

  private startDrainIfNeeded(): void {
    if (this.drainPromise !== null) {
      return;
    }
    this.drainPromise = this.drainPendingEvents().finally(() => {
      this.drainPromise = null;
      if (this.pendingEvents.length > 0 && !this.closing) {
        this.startDrainIfNeeded();
      }
    });
  }

  private async drainPendingEvents(): Promise<void> {
    while (this.pendingEvents.length > 0) {
      const event = this.pendingEvents.shift();
      if (event === undefined) {
        continue;
      }
      for (const connector of this.connectors) {
        try {
          await connector.dispatch(event);
          recordPerfEvent('control-plane.lifecycle-hooks.dispatch.completed', {
            connector: connector.id,
            eventType: event.eventType,
            provider: event.provider,
            sessionId: event.context.sessionId ?? ''
          });
        } catch (error: unknown) {
          recordPerfEvent('control-plane.lifecycle-hooks.dispatch.failed', {
            connector: connector.id,
            eventType: event.eventType,
            provider: event.provider,
            sessionId: event.context.sessionId ?? '',
            error: String(error)
          });
        }
      }
    }
  }

  private normalizeObservedEvent(
    scope: LifecycleObservedScope,
    event: StreamObservedEvent,
    cursor: number
  ): readonly HarnessLifecycleEventEnvelope[] {
    const provider = providerFromObservedEvent(event);
    if (!this.isProviderEnabled(provider)) {
      return [];
    }

    if (event.type === 'conversation-created') {
      return [
        this.buildLifecycleEvent(scope, event, cursor, provider, 'thread.created', {
          sessionId: conversationIdFromConversationRecord(event),
          summary: 'thread created',
          attributes: {
            conversationId: conversationIdFromConversationRecord(event)
          }
        })
      ];
    }
    if (event.type === 'conversation-updated') {
      return [
        this.buildLifecycleEvent(scope, event, cursor, provider, 'thread.updated', {
          sessionId: conversationIdFromConversationRecord(event),
          summary: 'thread updated',
          attributes: {
            conversationId: conversationIdFromConversationRecord(event)
          }
        })
      ];
    }
    if (event.type === 'conversation-archived') {
      return [
        this.buildLifecycleEvent(scope, event, cursor, provider, 'thread.archived', {
          sessionId: event.conversationId,
          summary: 'thread archived',
          attributes: {
            conversationId: event.conversationId
          }
        })
      ];
    }
    if (event.type === 'conversation-deleted') {
      return [
        this.buildLifecycleEvent(scope, event, cursor, provider, 'thread.deleted', {
          sessionId: event.conversationId,
          summary: 'thread deleted',
          attributes: {
            conversationId: event.conversationId
          }
        })
      ];
    }
    if (event.type === 'session-status') {
      return this.normalizeSessionStatusEvent(scope, event, cursor, provider);
    }
    if (event.type === 'session-event' && event.event.type === 'session-exit') {
      const events: HarnessLifecycleEventEnvelope[] = [
        this.buildLifecycleEvent(scope, event, cursor, provider, 'session.exited', {
          sessionId: event.sessionId,
          summary: 'session exited',
          attributes: {
            exitCode: event.event.exit.code,
            exitSignal: event.event.exit.signal
          }
        })
      ];
      if (event.event.exit.code !== 0 || event.event.exit.signal !== null) {
        events.push(
          this.buildLifecycleEvent(scope, event, cursor, provider, 'turn.failed', {
            sessionId: event.sessionId,
            summary: 'turn failed',
            attributes: {
              exitCode: event.event.exit.code,
              exitSignal: event.event.exit.signal
            }
          })
        );
      }
      return this.dedupeSessionEvents(events);
    }
    if (event.type === 'session-event' && event.event.type === 'notify') {
      return [];
    }
    if (event.type === 'session-key-event') {
      return this.normalizeSessionKeyEvent(scope, event, cursor, provider);
    }
    return [];
  }

  private normalizeSessionStatusEvent(
    scope: LifecycleObservedScope,
    event: Extract<StreamObservedEvent, { type: 'session-status' }>,
    cursor: number,
    provider: HarnessLifecycleProvider
  ): readonly HarnessLifecycleEventEnvelope[] {
    const previous = this.sessionStatusById.get(event.sessionId);
    this.sessionStatusById.set(event.sessionId, {
      status: event.status,
      live: event.live
    });
    const lifecycleEvents: HarnessLifecycleEventEnvelope[] = [];
    if (event.live && (previous === undefined || !previous.live || previous.status === 'exited')) {
      lifecycleEvents.push(
        this.buildLifecycleEvent(scope, event, cursor, provider, 'session.started', {
          sessionId: event.sessionId,
          summary: 'session started',
          attributes: {
            status: event.status
          }
        })
      );
    }
    if (previous?.status !== event.status) {
      if (event.status === 'running') {
        lifecycleEvents.push(
          this.buildLifecycleEvent(scope, event, cursor, provider, 'turn.started', {
            sessionId: event.sessionId,
            summary: 'turn started',
            attributes: {
              status: event.status
            }
          })
        );
      } else if (event.status === 'completed') {
        lifecycleEvents.push(
          this.buildLifecycleEvent(scope, event, cursor, provider, 'turn.completed', {
            sessionId: event.sessionId,
            summary: 'turn completed',
            attributes: {
              status: event.status
            }
          })
        );
      } else if (event.status === 'needs-input') {
        lifecycleEvents.push(
          this.buildLifecycleEvent(scope, event, cursor, provider, 'input.required', {
            sessionId: event.sessionId,
            summary: 'input required',
            attributes: {
              attentionReason: event.attentionReason
            }
          })
        );
      } else if (event.status === 'exited') {
        lifecycleEvents.push(
          this.buildLifecycleEvent(scope, event, cursor, provider, 'session.exited', {
            sessionId: event.sessionId,
            summary: 'session exited',
            attributes: {
              status: event.status
            }
          })
        );
      }
    }
    return this.dedupeSessionEvents(lifecycleEvents);
  }

  private normalizeSessionKeyEvent(
    scope: LifecycleObservedScope,
    event: Extract<StreamObservedEvent, { type: 'session-key-event' }>,
    cursor: number,
    provider: HarnessLifecycleProvider
  ): readonly HarnessLifecycleEventEnvelope[] {
    const lifecycleEvents: HarnessLifecycleEventEnvelope[] = [];
    const eventName = event.keyEvent.eventName?.toLowerCase() ?? '';
    const summary = event.keyEvent.summary?.toLowerCase() ?? '';

    if (eventName.includes('tool_call') || eventName.includes('pretooluse')) {
      lifecycleEvents.push(
        this.buildLifecycleEvent(scope, event, cursor, provider, 'tool.started', {
          sessionId: event.sessionId,
          summary: event.keyEvent.summary ?? 'tool started',
          attributes: {
            eventName: event.keyEvent.eventName,
            source: event.keyEvent.source
          }
        })
      );
    }
    if (eventName.includes('tool_result') || eventName.includes('posttooluse')) {
      const toolFailed = maybeToolFailure(event.keyEvent.summary, event.keyEvent.severity);
      lifecycleEvents.push(
        this.buildLifecycleEvent(
          scope,
          event,
          cursor,
          provider,
          toolFailed ? 'tool.failed' : 'tool.completed',
          {
            sessionId: event.sessionId,
            summary: event.keyEvent.summary ?? (toolFailed ? 'tool failed' : 'tool completed'),
            attributes: {
              eventName: event.keyEvent.eventName,
              source: event.keyEvent.source,
              severity: event.keyEvent.severity
            }
          }
        )
      );
    }
    if (eventName.includes('user_prompt') || eventName.includes('userpromptsubmit')) {
      lifecycleEvents.push(
        this.buildLifecycleEvent(scope, event, cursor, provider, 'turn.started', {
          sessionId: event.sessionId,
          summary: event.keyEvent.summary ?? 'turn started',
          attributes: {
            eventName: event.keyEvent.eventName,
            source: event.keyEvent.source
          }
        })
      );
    }
    if (
      eventName === 'codex.turn.e2e_duration_ms' ||
      summary.includes('turn complete')
    ) {
      lifecycleEvents.push(
        this.buildLifecycleEvent(scope, event, cursor, provider, 'turn.completed', {
          sessionId: event.sessionId,
          summary: event.keyEvent.summary ?? 'turn completed',
          attributes: {
            eventName: event.keyEvent.eventName,
            source: event.keyEvent.source
          }
        })
      );
    }
    if (
      event.keyEvent.statusHint === 'needs-input' ||
      eventName.includes('attention-required') ||
      eventName.includes('notification')
    ) {
      lifecycleEvents.push(
        this.buildLifecycleEvent(scope, event, cursor, provider, 'input.required', {
          sessionId: event.sessionId,
          summary: event.keyEvent.summary ?? 'input required',
          attributes: {
            eventName: event.keyEvent.eventName,
            source: event.keyEvent.source
          }
        })
      );
    }
    if (maybeToolFailure(event.keyEvent.summary, event.keyEvent.severity) && eventName.includes('api_request')) {
      lifecycleEvents.push(
        this.buildLifecycleEvent(scope, event, cursor, provider, 'turn.failed', {
          sessionId: event.sessionId,
          summary: event.keyEvent.summary ?? 'turn failed',
          attributes: {
            eventName: event.keyEvent.eventName,
            source: event.keyEvent.source,
            severity: event.keyEvent.severity
          }
        })
      );
    }

    return this.dedupeSessionEvents(lifecycleEvents);
  }

  private dedupeSessionEvents(
    events: readonly HarnessLifecycleEventEnvelope[]
  ): readonly HarnessLifecycleEventEnvelope[] {
    const deduped: HarnessLifecycleEventEnvelope[] = [];
    for (const event of events) {
      const sessionId = event.context.sessionId;
      if (sessionId === null) {
        deduped.push(event);
        continue;
      }
      const dedupeKey = `${sessionId}:${event.eventType}`;
      const currentEventMs = Date.parse(event.ts);
      const eventMs = Number.isFinite(currentEventMs) ? currentEventMs : Date.now();
      const lastMs = this.lastEmitMsBySessionAndType.get(dedupeKey);
      if (lastMs !== undefined && eventMs - lastMs <= SESSION_DEDUP_WINDOW_MS) {
        continue;
      }
      this.lastEmitMsBySessionAndType.set(dedupeKey, eventMs);
      deduped.push(event);
    }
    return deduped;
  }

  private buildLifecycleEvent(
    scope: LifecycleObservedScope,
    observed: StreamObservedEvent,
    cursor: number,
    provider: HarnessLifecycleProvider,
    eventType: HarnessLifecycleEventType,
    details: {
      sessionId: string | null;
      summary: string;
      attributes: Readonly<Record<string, unknown>>;
    }
  ): HarnessLifecycleEventEnvelope {
    const observedRecord = asRecord(observed);
    const observedTs = readTrimmedString(observedRecord?.['ts']);
    return {
      schemaVersion: '1',
      eventId: randomUUID(),
      eventType,
      provider,
      observedType: observed.type,
      ts: normalizeTimestamp(observedTs),
      cursor,
      summary: details.summary,
      context: {
        tenantId: scope.tenantId,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        directoryId: scope.directoryId,
        conversationId: scope.conversationId,
        sessionId: details.sessionId
      },
      attributes: details.attributes
    };
  }

  private isProviderEnabled(provider: HarnessLifecycleProvider): boolean {
    if (provider === 'codex') {
      return this.providers.codex;
    }
    if (provider === 'claude') {
      return this.providers.claude;
    }
    if (provider === 'control-plane') {
      return this.providers.controlPlane;
    }
    return this.providers.codex || this.providers.claude;
  }
}
