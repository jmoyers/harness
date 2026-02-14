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
    | 'muted'
    | 'empty';
  readonly text: string;
  readonly active: boolean;
}

function statusGlyph(status: ConversationRailSessionSummary['status']): string {
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

function statusText(status: ConversationRailSessionSummary['status']): string {
  if (status === 'needs-input') {
    return 'needs input';
  }
  if (status === 'running') {
    return 'running';
  }
  if (status === 'completed') {
    return 'done';
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
  active = false
): void {
  rows.push({
    kind,
    text,
    active
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
        pushRow(
          rows,
          'conversation-title',
          `│  ${active ? '▸' : ' '} ${conversation.agentLabel} - ${conversation.title}`,
          active
        );
        pushRow(
          rows,
          'conversation-meta',
          `│    ${statusGlyph(conversation.status)} ${statusText(conversation.status)}${reason} · ${formatCpu(conversation.cpuPercent)} · ${formatMem(conversation.memoryMb)} · ${formatDuration(conversation.startedAt, nowMs)}`,
          active
        );
        if (index + 1 < conversations.length) {
          pushRow(rows, 'empty', '');
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
      active: false
    },
    {
      kind: 'shortcut-body',
      text: '│  ^t new  ^n/^p switch  ^] quit',
      active: false
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
    pushRow(rows, 'empty', '');
  }
  rows.push(...shortcuts);
  return rows;
}
