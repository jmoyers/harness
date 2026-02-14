import type { ConversationRailSessionSummary } from './conversation-rail.ts';
import {
  createUiSurface,
  DEFAULT_UI_STYLE,
  drawUiText,
  fillUiRow,
  renderUiSurfaceAnsiRows
} from '../ui/surface.ts';

interface WorkspaceRailGitSummary {
  readonly branch: string;
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
}

interface WorkspaceRailDirectorySummary {
  readonly key: string;
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly active: boolean;
  readonly git: WorkspaceRailGitSummary;
}

interface WorkspaceRailConversationSummary {
  readonly sessionId: string;
  readonly directoryKey: string;
  readonly agentLabel: string;
  readonly worktreeLabel: string | null;
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
  readonly status: ConversationRailSessionSummary['status'];
  readonly attentionReason: string | null;
  readonly startedAt: string;
}

interface WorkspaceRailProcessSummary {
  readonly key: string;
  readonly directoryKey: string;
  readonly label: string;
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
  readonly status: 'running' | 'exited';
}

interface WorkspaceRailModel {
  readonly directories: readonly WorkspaceRailDirectorySummary[];
  readonly conversations: readonly WorkspaceRailConversationSummary[];
  readonly processes: readonly WorkspaceRailProcessSummary[];
  readonly activeConversationId: string | null;
  readonly nowMs?: number;
}

interface RailRow {
  readonly kind:
    | 'dir-header'
    | 'dir-meta'
    | 'conversation-title'
    | 'conversation-meta'
    | 'process-title'
    | 'process-meta'
    | 'shortcut-header'
    | 'shortcut-body'
    | 'muted'
    | 'empty';
  readonly text: string;
  readonly active: boolean;
}

const NORMAL_STYLE = DEFAULT_UI_STYLE;
const HEADER_STYLE = {
  fg: { kind: 'indexed', index: 255 },
  bg: { kind: 'indexed', index: 237 },
  bold: true
} as const;
const META_STYLE = {
  fg: { kind: 'indexed', index: 151 },
  bg: { kind: 'default' },
  bold: false
} as const;
const ACTIVE_TITLE_STYLE = {
  fg: { kind: 'indexed', index: 255 },
  bg: { kind: 'indexed', index: 24 },
  bold: false
} as const;
const ACTIVE_META_STYLE = {
  fg: { kind: 'indexed', index: 195 },
  bg: { kind: 'indexed', index: 24 },
  bold: false
} as const;
const PROCESS_STYLE = {
  fg: { kind: 'indexed', index: 223 },
  bg: { kind: 'default' },
  bold: false
} as const;
const MUTED_STYLE = {
  fg: { kind: 'indexed', index: 245 },
  bg: { kind: 'default' },
  bold: false
} as const;
const SHORTCUT_STYLE = {
  fg: { kind: 'indexed', index: 251 },
  bg: { kind: 'indexed', index: 236 },
  bold: false
} as const;

function compactSessionId(sessionId: string): string {
  if (sessionId.startsWith('conversation-')) {
    const suffix = sessionId.slice('conversation-'.length);
    return suffix.length > 8 ? suffix.slice(0, 8) : suffix;
  }
  return sessionId.length > 12 ? sessionId.slice(0, 12) : sessionId;
}

function conversationStatusBadge(status: ConversationRailSessionSummary['status']): string {
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

function conversationStatusGlyph(status: ConversationRailSessionSummary['status']): string {
  if (status === 'needs-input') {
    return '◐';
  }
  if (status === 'running') {
    return '●';
  }
  if (status === 'completed') {
    return '○';
  }
  return '◌';
}

function processStatusBadge(status: WorkspaceRailProcessSummary['status']): string {
  return status === 'running' ? 'RUN ' : 'EXIT';
}

function formatCpu(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '·';
  }
  return `${value.toFixed(1)}%`;
}

function formatMem(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '·';
  }
  return `${String(Math.max(0, Math.round(value)))}MB`;
}

function formatDuration(startedAt: string, nowMs: number): string {
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return '·';
  }
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${String(minutes)}m`;
  }
  return `${String(seconds)}s`;
}

function buildRows(model: WorkspaceRailModel, maxRows: number): readonly RailRow[] {
  const rows: RailRow[] = [];
  const nowMs = model.nowMs ?? Date.now();
  const push = (kind: RailRow['kind'], text: string, active = false): void => {
    rows.push({ kind, text, active });
  };

  if (model.directories.length === 0) {
    push('dir-header', '┌─ 📁 no directories');
    push('muted', '│  create one with ^t');
  } else {
    for (let directoryIndex = 0; directoryIndex < model.directories.length; directoryIndex += 1) {
      const directory = model.directories[directoryIndex]!;
      const connector = directoryIndex === 0 ? '┌' : '├';
      const directoryLabel = `${directory.workspaceId}/${directory.worktreeId}`;
      push(
        'dir-header',
        `${connector}─ 📁 ${directoryLabel} ─ ${directory.git.branch}`,
        directory.active
      );
      push(
        'dir-meta',
        `│  +${String(directory.git.additions)} -${String(directory.git.deletions)} │ ${String(directory.git.changedFiles)} files`,
        directory.active
      );
      push('muted', '│');

      const conversations = model.conversations.filter(
        (conversation) => conversation.directoryKey === directory.key
      );
      if (conversations.length === 0) {
        push('muted', '│  (no conversations)');
      } else {
        for (const conversation of conversations) {
          const active = conversation.sessionId === model.activeConversationId;
          const reason =
            conversation.attentionReason !== null && conversation.attentionReason.trim().length > 0
              ? ` ${conversation.attentionReason.trim()}`
              : '';
          push(
            'conversation-title',
            `│  ${active ? '▸' : ' '} ${conversationStatusGlyph(conversation.status)} ${compactSessionId(conversation.sessionId)}${reason}`,
            active
          );
          push(
            'conversation-meta',
            `│    🤖 ${conversation.agentLabel} ${conversationStatusBadge(conversation.status)} ${formatCpu(conversation.cpuPercent)} ${formatMem(conversation.memoryMb)} ${formatDuration(conversation.startedAt, nowMs)}`,
            active
          );
          if (conversation.worktreeLabel !== null && conversation.worktreeLabel.length > 0) {
            push(
              'muted',
              `│    └─ 🌿 ${conversation.worktreeLabel}`,
              active
            );
          }
        }
      }

      const processes = model.processes.filter((process) => process.directoryKey === directory.key);
      if (processes.length > 0) {
        push('muted', '│');
        for (const process of processes) {
          push('process-title', `│  ┄ ${process.label}`);
          push(
            'process-meta',
            `│    ⚙ ${processStatusBadge(process.status)} ${formatCpu(process.cpuPercent)} ${formatMem(process.memoryMb)}`
          );
        }
      }
    }
  }

  push('shortcut-header', '├─ ⌨ shortcuts');
  push('shortcut-body', '│  ^t new  ^n/^p switch  ^] quit');

  if (rows.length > maxRows) {
    return rows.slice(0, maxRows);
  }
  while (rows.length < maxRows) {
    push('empty', '');
  }
  return rows;
}

export function renderWorkspaceRailAnsiRows(
  model: WorkspaceRailModel,
  width: number,
  maxRows: number
): readonly string[] {
  const safeWidth = Math.max(1, width);
  const safeRows = Math.max(1, maxRows);
  const rows = buildRows(model, safeRows);
  const surface = createUiSurface(safeWidth, safeRows, DEFAULT_UI_STYLE);

  for (let rowIndex = 0; rowIndex < safeRows; rowIndex += 1) {
    const row = rows[rowIndex]!;
    if (row.kind === 'dir-header') {
      const style = row.active ? ACTIVE_TITLE_STYLE : HEADER_STYLE;
      fillUiRow(surface, rowIndex, style);
      drawUiText(surface, 0, rowIndex, row.text, style);
      continue;
    }
    if (row.kind === 'dir-meta') {
      const style = row.active ? ACTIVE_META_STYLE : META_STYLE;
      fillUiRow(surface, rowIndex, style);
      drawUiText(surface, 0, rowIndex, row.text, style);
      continue;
    }
    if (row.kind === 'conversation-title') {
      const style = row.active ? ACTIVE_TITLE_STYLE : NORMAL_STYLE;
      fillUiRow(surface, rowIndex, style);
      drawUiText(surface, 0, rowIndex, row.text, style);
      continue;
    }
    if (row.kind === 'conversation-meta') {
      const style = row.active ? ACTIVE_META_STYLE : META_STYLE;
      fillUiRow(surface, rowIndex, style);
      drawUiText(surface, 0, rowIndex, row.text, style);
      continue;
    }
    if (row.kind === 'process-title' || row.kind === 'process-meta') {
      fillUiRow(surface, rowIndex, NORMAL_STYLE);
      drawUiText(surface, 0, rowIndex, row.text, PROCESS_STYLE);
      continue;
    }
    if (row.kind === 'shortcut-header') {
      fillUiRow(surface, rowIndex, HEADER_STYLE);
      drawUiText(surface, 0, rowIndex, row.text, HEADER_STYLE);
      continue;
    }
    if (row.kind === 'shortcut-body') {
      fillUiRow(surface, rowIndex, SHORTCUT_STYLE);
      drawUiText(surface, 0, rowIndex, row.text, SHORTCUT_STYLE);
      continue;
    }
    if (row.kind === 'muted') {
      const style = row.active ? ACTIVE_META_STYLE : MUTED_STYLE;
      fillUiRow(surface, rowIndex, NORMAL_STYLE);
      drawUiText(surface, 0, rowIndex, row.text, style);
      continue;
    }
    fillUiRow(surface, rowIndex, NORMAL_STYLE);
  }

  return renderUiSurfaceAnsiRows(surface);
}
