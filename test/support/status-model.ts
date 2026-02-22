import type {
  StreamSessionRuntimeStatus,
  StreamSessionStatusModel,
} from '../../src/control-plane/stream-protocol.ts';

function phaseForStatus(status: StreamSessionRuntimeStatus): StreamSessionStatusModel['phase'] {
  if (status === 'needs-input') {
    return 'needs-action';
  }
  if (status === 'running') {
    return 'starting';
  }
  if (status === 'completed') {
    return 'idle';
  }
  return 'exited';
}

function glyphForPhase(
  phase: StreamSessionStatusModel['phase'],
): StreamSessionStatusModel['glyph'] {
  if (phase === 'needs-action') {
    return '▲';
  }
  if (phase === 'starting') {
    return '◔';
  }
  if (phase === 'working') {
    return '◆';
  }
  if (phase === 'idle') {
    return '○';
  }
  return '■';
}

function badgeForStatus(status: StreamSessionRuntimeStatus): StreamSessionStatusModel['badge'] {
  if (status === 'needs-input') {
    return 'NEED';
  }
  if (status === 'running') {
    return 'RUN ';
  }
  if (status === 'completed') {
    return 'DONE';
  }
  return 'EXIT';
}

export function statusModelFor(
  status: StreamSessionRuntimeStatus,
  options: {
    observedAt?: string;
    attentionReason?: string | null;
    detailText?: string;
    phase?: StreamSessionStatusModel['phase'];
    lastKnownWork?: string | null;
    lastKnownWorkAt?: string | null;
    activityHint?: StreamSessionStatusModel['activityHint'];
  } = {},
): StreamSessionStatusModel {
  const phase = options.phase ?? phaseForStatus(status);
  const attentionReason = options.attentionReason ?? null;
  return {
    runtimeStatus: status,
    phase,
    glyph: glyphForPhase(phase),
    badge: badgeForStatus(status),
    detailText:
      options.detailText ??
      attentionReason ??
      (phase === 'needs-action'
        ? 'needs input'
        : phase === 'starting'
          ? 'starting'
          : phase === 'working'
            ? 'active'
            : phase === 'idle'
              ? 'inactive'
              : 'exited'),
    attentionReason,
    lastKnownWork: options.lastKnownWork ?? null,
    lastKnownWorkAt: options.lastKnownWorkAt ?? null,
    activityHint: options.activityHint ?? null,
    observedAt: options.observedAt ?? new Date(0).toISOString(),
  };
}
