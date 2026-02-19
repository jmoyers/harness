import type {
  StreamSessionDisplayPhase,
  StreamSessionRuntimeStatus,
  StreamSessionStatusModel,
  StreamTelemetrySummary,
} from '../stream-protocol.ts';
import type { AgentStatusProjectionInput, AgentStatusReducer } from './agent-status-reducer.ts';

interface WorkProjection {
  readonly text: string | null;
  readonly phaseHint: 'needs-action' | 'working' | 'idle' | null;
}

function normalizeText(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function parseIsoMs(value: string | null): number {
  if (value === null) {
    return Number.NaN;
  }
  return Date.parse(value);
}

function eventIsNewer(observedAt: string, previousObservedAt: string | null): boolean {
  const observedAtMs = parseIsoMs(observedAt);
  const previousAtMs = parseIsoMs(previousObservedAt);
  if (!Number.isFinite(observedAtMs)) {
    return false;
  }
  if (!Number.isFinite(previousAtMs)) {
    return true;
  }
  return observedAtMs >= previousAtMs;
}

function phaseFromRuntimeStatus(
  runtimeStatus: StreamSessionRuntimeStatus,
  phaseHint: WorkProjection['phaseHint'],
): StreamSessionDisplayPhase {
  if (runtimeStatus === 'needs-input') {
    return 'needs-action';
  }
  if (runtimeStatus === 'exited') {
    return 'exited';
  }
  if (phaseHint === 'working') {
    return 'working';
  }
  if (phaseHint === 'needs-action') {
    return 'needs-action';
  }
  if (phaseHint === 'idle') {
    return 'idle';
  }
  if (runtimeStatus === 'running') {
    return 'starting';
  }
  return 'idle';
}

function defaultTextForPhase(phase: StreamSessionDisplayPhase): string {
  if (phase === 'needs-action') {
    return 'needs input';
  }
  if (phase === 'starting') {
    return 'starting';
  }
  if (phase === 'working') {
    return 'active';
  }
  if (phase === 'exited') {
    return 'exited';
  }
  return 'inactive';
}

function glyphForPhase(phase: StreamSessionDisplayPhase): StreamSessionStatusModel['glyph'] {
  if (phase === 'needs-action') {
    return '▲';
  }
  if (phase === 'starting') {
    return '◔';
  }
  if (phase === 'working') {
    return '◆';
  }
  if (phase === 'exited') {
    return '■';
  }
  return '○';
}

function badgeForRuntimeStatus(
  runtimeStatus: StreamSessionRuntimeStatus,
): StreamSessionStatusModel['badge'] {
  if (runtimeStatus === 'needs-input') {
    return 'NEED';
  }
  if (runtimeStatus === 'running') {
    return 'RUN ';
  }
  if (runtimeStatus === 'completed') {
    return 'DONE';
  }
  return 'EXIT';
}

export abstract class BaseAgentStatusReducer implements AgentStatusReducer {
  abstract readonly agentType: string;

  protected constructor() {}

  project(input: AgentStatusProjectionInput): StreamSessionStatusModel | null {
    const previous = input.previous;
    let workText = previous?.lastKnownWork ?? null;
    let workPhaseHint = previous?.phaseHint ?? null;
    let workObservedAt = previous?.lastKnownWorkAt ?? null;

    if (input.telemetry !== null && eventIsNewer(input.telemetry.observedAt, workObservedAt)) {
      const projected = this.projectFromTelemetry(input.telemetry);
      if (projected !== null) {
        workText = projected.text;
        workPhaseHint = projected.phaseHint;
        workObservedAt = input.telemetry.observedAt;
      }
    }

    if (
      input.runtimeStatus === 'completed' &&
      eventIsNewer(input.observedAt, workObservedAt) &&
      workPhaseHint !== 'needs-action'
    ) {
      workText = 'inactive';
      workPhaseHint = 'idle';
      workObservedAt = input.observedAt;
    }
    if (input.runtimeStatus === 'exited' && eventIsNewer(input.observedAt, workObservedAt)) {
      workText = 'exited';
      workPhaseHint = 'idle';
      workObservedAt = input.observedAt;
    }

    const phase = phaseFromRuntimeStatus(input.runtimeStatus, workPhaseHint);
    const normalizedAttentionReason = normalizeText(input.attentionReason);
    const detailText =
      (input.runtimeStatus === 'needs-input' ? normalizedAttentionReason : null) ??
      workText ??
      normalizedAttentionReason ??
      defaultTextForPhase(phase);

    return {
      runtimeStatus: input.runtimeStatus,
      phase,
      glyph: glyphForPhase(phase),
      badge: badgeForRuntimeStatus(input.runtimeStatus),
      detailText,
      attentionReason: normalizedAttentionReason,
      lastKnownWork: workText,
      lastKnownWorkAt: workObservedAt,
      phaseHint: workPhaseHint,
      observedAt: input.observedAt,
    };
  }

  protected projectFromTelemetry(_telemetry: StreamTelemetrySummary): WorkProjection | null {
    return null;
  }
}
