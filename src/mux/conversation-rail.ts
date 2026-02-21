import type {
  StreamSessionListSort,
  StreamSessionRuntimeStatus,
  StreamSessionStatusModel,
} from '../control-plane/stream-protocol.ts';
import { padOrTrimDisplay } from './dual-pane-core.ts';
import { UiKit } from '../../packages/harness-ui/src/kit.ts';
import { DEFAULT_UI_STYLE, SurfaceBuffer } from '../../packages/harness-ui/src/surface.ts';
import { getActiveMuxTheme } from '../ui/mux-theme.ts';

const UI_KIT = new UiKit();

export interface ConversationRailSessionSummary {
  readonly sessionId: string;
  readonly status: StreamSessionRuntimeStatus;
  readonly statusModel: StreamSessionStatusModel | null;
  readonly attentionReason: string | null;
  readonly live: boolean;
  readonly startedAt: string;
  readonly lastEventAt: string | null;
}

type ConversationRailOrder = StreamSessionListSort | 'input-order';

interface ConversationRailRenderRow {
  readonly kind: 'header' | 'session' | 'empty';
  readonly text: string;
  readonly session?: ConversationRailSessionSummary;
  readonly active?: boolean;
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
  exited: 3,
};

function statusPriority(status: StreamSessionRuntimeStatus): number {
  return STATUS_PRIORITY[status];
}

export function sortConversationRailSessions(
  sessions: readonly ConversationRailSessionSummary[],
  sort: StreamSessionListSort = 'attention-first',
): readonly ConversationRailSessionSummary[] {
  const sorted = [...sessions];
  if (sort === 'started-asc') {
    sorted.sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) ||
        left.sessionId.localeCompare(right.sessionId),
    );
    return sorted;
  }

  if (sort === 'started-desc') {
    sorted.sort(
      (left, right) =>
        right.startedAt.localeCompare(left.startedAt) ||
        left.sessionId.localeCompare(right.sessionId),
    );
    return sorted;
  }

  sorted.sort(
    (left, right) =>
      statusPriority(left.status) - statusPriority(right.status) ||
      compareIsoDesc(left.lastEventAt, right.lastEventAt) ||
      right.startedAt.localeCompare(left.startedAt) ||
      left.sessionId.localeCompare(right.sessionId),
  );
  return sorted;
}

function compactSessionId(sessionId: string): string {
  if (sessionId.startsWith('conversation-')) {
    const suffix = sessionId.slice('conversation-'.length);
    if (suffix.length > 8) {
      return suffix.slice(0, 8);
    }
    return suffix;
  }
  if (sessionId.length > 16) {
    return `${sessionId.slice(0, 16)}…`;
  }
  return sessionId;
}

function statusToken(status: StreamSessionRuntimeStatus): string {
  if (status === 'needs-input') {
    return '!';
  }
  if (status === 'running') {
    return '~';
  }
  if (status === 'completed') {
    return '+';
  }
  return 'x';
}

function renderConversationLine(
  session: ConversationRailSessionSummary,
  activeSessionId: string | null,
): string {
  const activePrefix = session.sessionId === activeSessionId ? '>' : ' ';
  const token = statusToken(session.status);
  const shortId = compactSessionId(session.sessionId);
  const liveState = session.live ? '' : ' (dead)';
  const base = `${activePrefix} [${token}] ${shortId}${liveState}`;
  if (session.attentionReason !== null && session.attentionReason.length > 0) {
    return `${base} - ${session.attentionReason}`;
  }
  return base;
}

function buildConversationRailRows(
  sessions: readonly ConversationRailSessionSummary[],
  activeSessionId: string | null,
  maxRows: number,
  order: ConversationRailOrder,
): readonly ConversationRailRenderRow[] {
  const safeMaxRows = Math.max(1, maxRows);
  const sorted =
    order === 'input-order' ? [...sessions] : sortConversationRailSessions(sessions, order);
  const headerText = `conversations (${String(sorted.length)}) [ctrl-t new] [ctrl-n/p switch]`;
  const rows: ConversationRailRenderRow[] = [
    {
      kind: 'header',
      text: headerText,
    },
  ];

  if (safeMaxRows === 1) {
    return rows;
  }

  const maxConversationRows = safeMaxRows - 1;
  const visible: ConversationRailSessionSummary[] = sorted.slice(0, maxConversationRows);
  if (
    activeSessionId !== null &&
    !visible.some((session) => session.sessionId === activeSessionId)
  ) {
    const active = sorted.find((session) => session.sessionId === activeSessionId);
    if (active !== undefined) {
      visible[visible.length - 1] = active;
    }
  }

  for (const session of visible) {
    rows.push({
      kind: 'session',
      text: renderConversationLine(session, activeSessionId),
      session,
      active: session.sessionId === activeSessionId,
    });
  }

  while (rows.length < safeMaxRows) {
    rows.push({
      kind: 'empty',
      text: '',
    });
  }
  return rows;
}

export function buildConversationRailLines(
  sessions: readonly ConversationRailSessionSummary[],
  activeSessionId: string | null,
  width: number,
  maxRows: number,
  order: ConversationRailOrder = 'attention-first',
): readonly string[] {
  const safeWidth = Math.max(1, width);
  const rows = buildConversationRailRows(sessions, activeSessionId, maxRows, order);
  return rows.map((row) => padOrTrimDisplay(row.text, safeWidth));
}

function badgeLabel(status: StreamSessionRuntimeStatus): string {
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

function rowBodyText(session: ConversationRailSessionSummary): string {
  const idText = compactSessionId(session.sessionId);
  const deadToken = session.live ? '' : ' (dead)';
  const attentionText =
    session.attentionReason !== null && session.attentionReason.length > 0
      ? ` - ${session.attentionReason}`
      : '';
  return `${idText}${deadToken}${attentionText}`;
}

export function renderConversationRailAnsiRows(
  sessions: readonly ConversationRailSessionSummary[],
  activeSessionId: string | null,
  width: number,
  maxRows: number,
  order: ConversationRailOrder = 'attention-first',
): readonly string[] {
  const safeWidth = Math.max(1, width);
  const rows = buildConversationRailRows(sessions, activeSessionId, maxRows, order);
  const surface = new SurfaceBuffer(safeWidth, rows.length, DEFAULT_UI_STYLE);
  const theme = getActiveMuxTheme().conversationRail;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!;
    if (row.kind === 'header') {
      UI_KIT.paintRow(surface, rowIndex, row.text, theme.headerStyle, theme.headerStyle, 1);
      continue;
    }

    if (row.kind === 'empty') {
      UI_KIT.paintRow(surface, rowIndex, '', theme.normalRowStyle, theme.normalRowStyle);
      continue;
    }

    const session = row.session!;
    const active = row.active === true;
    surface.fillRow(rowIndex, active ? theme.activeRowStyle : theme.normalRowStyle);
    surface.drawText(
      0,
      rowIndex,
      active ? '>' : ' ',
      active ? theme.activeIndicatorStyle : theme.normalTextStyle,
    );
    surface.drawText(
      2,
      rowIndex,
      badgeLabel(session.status),
      session.status === 'needs-input'
        ? theme.statusBadgeStyles.needsInput
        : session.status === 'running'
          ? theme.statusBadgeStyles.running
          : session.status === 'completed'
            ? theme.statusBadgeStyles.completed
            : theme.statusBadgeStyles.exited,
    );
    surface.drawText(
      7,
      rowIndex,
      rowBodyText(session),
      active ? theme.activeTextStyle : theme.normalTextStyle,
    );

    if (!session.live && session.attentionReason === null) {
      surface.drawText(7, rowIndex, rowBodyText(session), theme.deadTextStyle);
    }
  }

  return surface.renderAnsiRows();
}

export function cycleConversationId(
  sessionIds: readonly string[],
  activeSessionId: string | null,
  direction: 'next' | 'previous',
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
