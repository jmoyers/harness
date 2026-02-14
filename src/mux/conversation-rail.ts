import type {
  StreamSessionListSort,
  StreamSessionRuntimeStatus
} from '../control-plane/stream-protocol.ts';
import { padOrTrimDisplay } from './dual-pane-core.ts';

export interface ConversationRailSessionSummary {
  readonly sessionId: string;
  readonly status: StreamSessionRuntimeStatus;
  readonly attentionReason: string | null;
  readonly live: boolean;
  readonly startedAt: string;
  readonly lastEventAt: string | null;
}

export function compareIsoDesc(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return right.localeCompare(left);
}

const STATUS_PRIORITY: Record<StreamSessionRuntimeStatus, number> = {
  'needs-input': 0,
  running: 1,
  completed: 2,
  exited: 3
};

function statusPriority(status: StreamSessionRuntimeStatus): number {
  return STATUS_PRIORITY[status];
}

export function sortConversationRailSessions(
  sessions: readonly ConversationRailSessionSummary[],
  sort: StreamSessionListSort = 'attention-first'
): readonly ConversationRailSessionSummary[] {
  const sorted = [...sessions];
  if (sort === 'started-asc') {
    sorted.sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) || left.sessionId.localeCompare(right.sessionId)
    );
    return sorted;
  }

  if (sort === 'started-desc') {
    sorted.sort(
      (left, right) =>
        right.startedAt.localeCompare(left.startedAt) || left.sessionId.localeCompare(right.sessionId)
    );
    return sorted;
  }

  sorted.sort(
    (left, right) =>
      statusPriority(left.status) - statusPriority(right.status) ||
      compareIsoDesc(left.lastEventAt, right.lastEventAt) ||
      right.startedAt.localeCompare(left.startedAt) ||
      left.sessionId.localeCompare(right.sessionId)
  );
  return sorted;
}

function compactSessionId(sessionId: string): string {
  if (sessionId.startsWith('conversation-')) {
    const suffix = sessionId.slice('conversation-'.length);
    if (suffix.length > 8) {
      return `conversation-${suffix.slice(0, 8)}`;
    }
    return sessionId;
  }
  if (sessionId.length > 18) {
    return `${sessionId.slice(0, 18)}…`;
  }
  return sessionId;
}

function statusAbbrev(status: StreamSessionRuntimeStatus): string {
  if (status === 'needs-input') {
    return 'need';
  }
  if (status === 'running') {
    return 'run ';
  }
  if (status === 'completed') {
    return 'done';
  }
  return 'exit';
}

function renderConversationLine(
  session: ConversationRailSessionSummary,
  activeSessionId: string | null
): string {
  const activePrefix = session.sessionId === activeSessionId ? '>' : ' ';
  const liveToken = session.live ? 'live' : 'dead';
  const shortId = compactSessionId(session.sessionId);
  const base = `${activePrefix} ${statusAbbrev(session.status)} ${liveToken} ${shortId}`;
  if (session.attentionReason !== null && session.attentionReason.length > 0) {
    return `${base} ${session.attentionReason}`;
  }
  return base;
}

export function buildConversationRailLines(
  sessions: readonly ConversationRailSessionSummary[],
  activeSessionId: string | null,
  width: number,
  maxRows: number
): readonly string[] {
  const safeWidth = Math.max(1, width);
  const safeMaxRows = Math.max(1, maxRows);
  const sorted = sortConversationRailSessions(sessions, 'attention-first');
  const header = padOrTrimDisplay(
    `conversations(${String(sorted.length)}) ctrl-t new ctrl-n/p switch`,
    safeWidth
  );

  if (safeMaxRows === 1) {
    return [header];
  }

  const maxConversationRows = safeMaxRows - 1;
  const visible: ConversationRailSessionSummary[] = sorted.slice(0, maxConversationRows);
  if (activeSessionId !== null && !visible.some((session) => session.sessionId === activeSessionId)) {
    const active = sorted.find((session) => session.sessionId === activeSessionId);
    if (active !== undefined) {
      visible[visible.length - 1] = active;
    }
  }

  const lines: string[] = [header];
  for (const session of visible) {
    lines.push(padOrTrimDisplay(renderConversationLine(session, activeSessionId), safeWidth));
  }
  while (lines.length < safeMaxRows) {
    lines.push(padOrTrimDisplay('', safeWidth));
  }
  return lines;
}

export function cycleConversationId(
  sessionIds: readonly string[],
  activeSessionId: string | null,
  direction: 'next' | 'previous'
): string | null {
  if (sessionIds.length === 0) {
    return null;
  }
  if (activeSessionId === null) {
    return sessionIds[0]!;
  }
  const index = sessionIds.indexOf(activeSessionId);
  if (index < 0) {
    return sessionIds[0]!;
  }
  if (direction === 'next') {
    return sessionIds[(index + 1) % sessionIds.length]!;
  }
  return sessionIds[(index - 1 + sessionIds.length) % sessionIds.length]!;
}
