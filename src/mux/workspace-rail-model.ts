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
  readonly shortcutsCollapsed?: boolean;
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
    | 'action'
    | 'muted';
  readonly text: string;
  readonly active: boolean;
  readonly conversationSessionId: string | null;
  readonly railAction: WorkspaceRailAction | null;
}

const INTER_DIRECTORY_SPACER_ROWS = 2;

type WorkspaceRailAction =
  | 'conversation.new'
  | 'conversation.delete'
  | 'directory.add'
  | 'directory.close'
  | 'shortcuts.toggle';

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
  if (!Number.isFinite(lastEventAtMs) || nowMs - lastEventAtMs > 15_000) {
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
  conversationSessionId: string | null = null,
  railAction: WorkspaceRailAction | null = null
): void {
  rows.push({
    kind,
    text,
    active,
    conversationSessionId,
    railAction
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
          `│    ${statusGlyph(normalizedStatus)} ${statusText(normalizedStatus)}${reason} · ${formatCpu(conversation.cpuPercent)} · ${formatMem(conversation.memoryMb)}`,
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

    if (directoryIndex + 1 < model.directories.length) {
      for (let spacerIndex = 0; spacerIndex < INTER_DIRECTORY_SPACER_ROWS; spacerIndex += 1) {
        pushRow(rows, 'muted', '│');
      }
    }
  }

  return rows;
}

function shortcutDescriptionRows(shortcutHint: string | undefined): readonly string[] {
  const normalized = shortcutHint?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return [
      'ctrl+t new conversation',
      'ctrl+x archive conversation',
      'ctrl+o add directory',
      'ctrl+w close directory',
      'ctrl+j/k switch conversation',
      'ctrl+c quit mux'
    ];
  }
  if (normalized.includes('\n')) {
    return normalized
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return normalized
    .split(/\s{2,}/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function shortcutRows(
  shortcutHint: string | undefined,
  shortcutsCollapsed: boolean
): readonly WorkspaceRailViewRow[] {
  const rows: WorkspaceRailViewRow[] = [
    {
      kind: 'shortcut-header',
      text: `├─ ⌨ shortcuts ${shortcutsCollapsed ? '[+]' : '[-]'}`,
      active: false,
      conversationSessionId: null,
      railAction: 'shortcuts.toggle'
    }
  ];
  if (!shortcutsCollapsed) {
    const descriptions = shortcutDescriptionRows(shortcutHint);
    for (const description of descriptions) {
      rows.push({
        kind: 'shortcut-body',
        text: `│  ${description}`,
        active: false,
        conversationSessionId: null,
        railAction: null
      });
    }
  }
  rows.push(
    {
      kind: 'action',
      text: '│  + new conversation',
      active: false,
      conversationSessionId: null,
      railAction: 'conversation.new'
    },
    {
      kind: 'action',
      text: '│  x archive conversation',
      active: false,
      conversationSessionId: null,
      railAction: 'conversation.delete'
    },
    {
      kind: 'action',
      text: '│  > add directory',
      active: false,
      conversationSessionId: null,
      railAction: 'directory.add'
    },
    {
      kind: 'action',
      text: '│  < close directory',
      active: false,
      conversationSessionId: null,
      railAction: 'directory.close'
    }
  );
  return rows;
}

export function buildWorkspaceRailViewRows(
  model: WorkspaceRailModel,
  maxRows: number
): readonly WorkspaceRailViewRow[] {
  const safeRows = Math.max(1, maxRows);
  const nowMs = model.nowMs ?? Date.now();
  const contentRows = buildContentRows(model, nowMs);
  const renderedShortcuts = shortcutRows(model.shortcutHint, model.shortcutsCollapsed ?? false);

  if (safeRows <= renderedShortcuts.length) {
    return renderedShortcuts.slice(renderedShortcuts.length - safeRows);
  }

  const contentCapacity = safeRows - renderedShortcuts.length;
  const rows: WorkspaceRailViewRow[] = [...contentRows.slice(0, contentCapacity)];
  while (rows.length < contentCapacity) {
    pushRow(rows, 'muted', '│');
  }
  rows.push(...renderedShortcuts);
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

export function actionAtWorkspaceRailRow(
  rows: readonly WorkspaceRailViewRow[],
  rowIndex: number
): WorkspaceRailAction | null {
  const row = rows[rowIndex];
  if (row === undefined) {
    return null;
  }
  return row.railAction;
}

export function kindAtWorkspaceRailRow(
  rows: readonly WorkspaceRailViewRow[],
  rowIndex: number
): WorkspaceRailViewRow['kind'] | null {
  const row = rows[rowIndex];
  if (row === undefined) {
    return null;
  }
  return row.kind;
}
