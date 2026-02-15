import type { ConversationRailSessionSummary } from './conversation-rail.ts';

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
  readonly title: string;
  readonly agentLabel: string;
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
  readonly status: ConversationRailSessionSummary['status'];
  readonly attentionReason: string | null;
  readonly startedAt: string;
  readonly lastEventAt: string | null;
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
  readonly shortcutHint?: string;
  readonly nowMs?: number;
}

interface WorkspaceRailViewRow {
  readonly kind:
    | 'dir-header'
    | 'dir-meta'
    | 'conversation-title'
    | 'conversation-meta'
    | 'process-title'
    | 'process-meta'
    | 'shortcut-header'
    | 'shortcut-body'
    | 'muted';
  readonly text: string;
  readonly active: boolean;
  readonly conversationSessionId: string | null;
}

type NormalizedConversationStatus = 'needs-action' | 'working' | 'idle' | 'complete' | 'exited';

function normalizeConversationStatus(
  conversation: WorkspaceRailConversationSummary,
  nowMs: number
): NormalizedConversationStatus {
  if (conversation.status === 'needs-input') {
    return 'needs-action';
  }
  if (conversation.status === 'completed') {
    return 'complete';
  }
  if (conversation.status === 'exited') {
    return 'exited';
  }
  const lastEventAtMs = conversation.lastEventAt === null ? Number.NaN : Date.parse(conversation.lastEventAt);
  if (Number.isFinite(lastEventAtMs) && nowMs - lastEventAtMs > 15_000) {
    return 'idle';
  }
  return 'working';
}

function statusGlyph(status: NormalizedConversationStatus): string {
  if (status === 'needs-action') {
    return '◐';
  }
  if (status === 'working') {
    return '●';
  }
  if (status === 'idle') {
    return '◍';
  }
  if (status === 'complete') {
    return '○';
  }
  return '◌';
}

function statusText(status: NormalizedConversationStatus): string {
  if (status === 'needs-action') {
    return 'needs action';
  }
  if (status === 'working') {
    return 'working';
  }
  if (status === 'idle') {
    return 'idle';
  }
  if (status === 'complete') {
    return 'complete';
  }
  return 'exited';
}

function processStatusText(status: WorkspaceRailProcessSummary['status']): string {
  return status === 'running' ? 'running' : 'exited';
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

function directoryDisplayName(directory: WorkspaceRailDirectorySummary): string {
  const name = directory.workspaceId.trim();
  if (name.length === 0) {
    return '(unnamed)';
  }
  return name;
}

function pushRow(
  rows: WorkspaceRailViewRow[],
  kind: WorkspaceRailViewRow['kind'],
  text: string,
  active = false,
  conversationSessionId: string | null = null
): void {
  rows.push({
    kind,
    text,
    active,
    conversationSessionId
  });
}

function buildContentRows(model: WorkspaceRailModel, nowMs: number): readonly WorkspaceRailViewRow[] {
  const rows: WorkspaceRailViewRow[] = [];

  if (model.directories.length === 0) {
    pushRow(rows, 'dir-header', '┌─ 📁 no directories');
    pushRow(rows, 'muted', '│  create one with ^t');
    return rows;
  }

  for (let directoryIndex = 0; directoryIndex < model.directories.length; directoryIndex += 1) {
    const directory = model.directories[directoryIndex]!;
    const connector = directoryIndex === 0 ? '┌' : '├';
    pushRow(
      rows,
      'dir-header',
      `${connector}─ 📁 ${directoryDisplayName(directory)} ─ ${directory.git.branch}`
    );
    pushRow(
      rows,
      'dir-meta',
      `│  +${String(directory.git.additions)} -${String(directory.git.deletions)} │ ${String(directory.git.changedFiles)} files`
    );
    pushRow(rows, 'muted', '│');

    const conversations = model.conversations.filter(
      (conversation) => conversation.directoryKey === directory.key
    );
    if (conversations.length === 0) {
      pushRow(rows, 'muted', '│  (no conversations)');
    } else {
      for (let index = 0; index < conversations.length; index += 1) {
        const conversation = conversations[index]!;
        const active = conversation.sessionId === model.activeConversationId;
        const reason =
          conversation.attentionReason !== null && conversation.attentionReason.trim().length > 0
            ? ` · ${conversation.attentionReason.trim()}`
            : '';
        const normalizedStatus = normalizeConversationStatus(conversation, nowMs);
        pushRow(
          rows,
          'conversation-title',
          `│  ${active ? '▸' : ' '} ${conversation.agentLabel} - ${conversation.title}`,
          active,
          conversation.sessionId
        );
        pushRow(
          rows,
          'conversation-meta',
          `│    ${statusGlyph(normalizedStatus)} ${statusText(normalizedStatus)}${reason} · ${formatCpu(conversation.cpuPercent)} · ${formatMem(conversation.memoryMb)} · ${formatDuration(conversation.startedAt, nowMs)}`,
          active,
          conversation.sessionId
        );
        if (index + 1 < conversations.length) {
          pushRow(rows, 'muted', '│');
        }
      }
    }

    const processes = model.processes.filter((process) => process.directoryKey === directory.key);
    if (processes.length > 0) {
      pushRow(rows, 'muted', '│');
      for (const process of processes) {
        pushRow(rows, 'process-title', `│  ⚙ ${process.label}`);
        pushRow(
          rows,
          'process-meta',
          `│    ${processStatusText(process.status)} · ${formatCpu(process.cpuPercent)} · ${formatMem(process.memoryMb)}`
        );
      }
    }
  }

  return rows;
}

function shortcutRows(): readonly WorkspaceRailViewRow[] {
  return [
    {
      kind: 'shortcut-header',
      text: '├─ ⌨ shortcuts',
      active: false,
      conversationSessionId: null
    },
    {
      kind: 'shortcut-body',
      text: '│  ctrl+t new  ctrl+j/k switch  ctrl+c x2 quit',
      active: false,
      conversationSessionId: null
    }
  ];
}

export function buildWorkspaceRailViewRows(
  model: WorkspaceRailModel,
  maxRows: number
): readonly WorkspaceRailViewRow[] {
  const safeRows = Math.max(1, maxRows);
  const nowMs = model.nowMs ?? Date.now();
  const contentRows = buildContentRows(model, nowMs);
  const shortcuts = shortcutRows();

  if (safeRows <= shortcuts.length) {
    return shortcuts.slice(shortcuts.length - safeRows);
  }

  const contentCapacity = safeRows - shortcuts.length;
  const rows: WorkspaceRailViewRow[] = [...contentRows.slice(0, contentCapacity)];
  while (rows.length < contentCapacity) {
    pushRow(rows, 'muted', '│');
  }
  if (model.shortcutHint !== undefined && model.shortcutHint.trim().length > 0) {
    rows.push(shortcuts[0]!, {
      ...shortcuts[1]!,
      text: `│  ${model.shortcutHint.trim()}`
    });
    return rows;
  }
  rows.push(...shortcuts);
  return rows;
}

export function conversationIdAtWorkspaceRailRow(
  rows: readonly WorkspaceRailViewRow[],
  rowIndex: number
): string | null {
  const row = rows[rowIndex];
  if (row === undefined) {
    return null;
  }
  return row.conversationSessionId;
}
