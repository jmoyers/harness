import type { ConversationRailSessionSummary } from './conversation-rail.ts';
import { formatUiButton } from '../ui/kit.ts';
import type { StreamSessionController } from '../control-plane/stream-protocol.ts';

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
  readonly git: WorkspaceRailGitSummary;
}

interface WorkspaceRailConversationSummary {
  readonly sessionId: string;
  readonly directoryKey: string;
  readonly title: string;
  readonly agentLabel: string;
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
  readonly lastKnownWork: string | null;
  readonly lastKnownWorkAt?: string | null;
  readonly status: ConversationRailSessionSummary['status'];
  readonly attentionReason: string | null;
  readonly startedAt: string;
  readonly lastEventAt: string | null;
  readonly controller?: StreamSessionController | null;
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
  readonly activeProjectId: string | null;
  readonly activeConversationId: string | null;
  readonly localControllerId?: string | null;
  readonly projectSelectionEnabled?: boolean;
  readonly shortcutHint?: string;
  readonly shortcutsCollapsed?: boolean;
  readonly nowMs?: number;
}

interface WorkspaceRailViewRow {
  readonly kind:
    | 'dir-header'
    | 'dir-meta'
    | 'conversation-title'
    | 'conversation-body'
    | 'process-title'
    | 'process-meta'
    | 'shortcut-header'
    | 'shortcut-body'
    | 'action'
    | 'muted';
  readonly text: string;
  readonly active: boolean;
  readonly conversationSessionId: string | null;
  readonly directoryKey: string | null;
  readonly railAction: WorkspaceRailAction | null;
  readonly conversationStatus: NormalizedConversationStatus | null;
}

const INTER_DIRECTORY_SPACER_ROWS = 2;
const NEW_THREAD_INLINE_LABEL = '[+ thread]';
const ADD_PROJECT_BUTTON_LABEL = formatUiButton({
  label: 'add project',
  prefixIcon: '>'
});

type WorkspaceRailAction =
  | 'conversation.new'
  | 'conversation.delete'
  | 'project.add'
  | 'project.close'
  | 'shortcuts.toggle';

type NormalizedConversationStatus = 'needs-action' | 'working' | 'idle' | 'complete' | 'exited';

function parseIsoMs(value: string | null | undefined): number {
  if (value === null || value === undefined) {
    return Number.NaN;
  }
  return Date.parse(value);
}

function isLastKnownWorkCurrent(conversation: WorkspaceRailConversationSummary): boolean {
  const lastKnownWorkAtMs = parseIsoMs(conversation.lastKnownWorkAt ?? null);
  const lastEventAtMs = parseIsoMs(conversation.lastEventAt);
  if (!Number.isFinite(lastEventAtMs)) {
    return true;
  }
  if (!Number.isFinite(lastKnownWorkAtMs)) {
    return false;
  }
  return lastKnownWorkAtMs + 200 >= lastEventAtMs;
}

function inferStatusFromLastKnownWork(lastKnownWork: string | null): NormalizedConversationStatus | null {
  const normalized = summaryText(lastKnownWork)?.toLowerCase() ?? null;
  if (normalized === null) {
    return null;
  }
  if (
    normalized.includes('needs-input') ||
    normalized.includes('needs input') ||
    normalized.includes('attention-required') ||
    normalized.includes('approval denied')
  ) {
    return 'needs-action';
  }
  if (
    normalized.includes('turn complete') ||
    normalized.includes('response.completed') ||
    normalized.includes('completed')
  ) {
    return 'complete';
  }
  if (
    normalized.includes('prompt') ||
    normalized.includes('request') ||
    normalized.includes('stream') ||
    normalized.includes('tool ') ||
    normalized.includes('realtime')
  ) {
    return 'working';
  }
  return null;
}

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
  const inferred = inferStatusFromLastKnownWork(conversation.lastKnownWork);
  if ((inferred === 'needs-action' || inferred === 'complete') && isLastKnownWorkCurrent(conversation)) {
    return inferred;
  }
  const lastEventAtMs = parseIsoMs(conversation.lastEventAt);
  if (!Number.isFinite(lastEventAtMs) || nowMs - lastEventAtMs > 15_000) {
    return 'idle';
  }
  if (inferred === 'working' && isLastKnownWorkCurrent(conversation)) {
    return 'working';
  }
  return 'working';
}

function statusGlyph(status: NormalizedConversationStatus, nowMs: number): string {
  if (status === 'needs-action') {
    return '▲';
  }
  if (status === 'working') {
    return Math.floor(nowMs / 400) % 2 === 0 ? '◆' : '◇';
  }
  if (status === 'idle') {
    return '○';
  }
  if (status === 'complete') {
    return '◇';
  }
  return '■';
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

function summaryText(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length === 0 ? null : normalized;
}

function statusLineLabel(status: NormalizedConversationStatus): string {
  if (status === 'needs-action') {
    return 'needs input';
  }
  if (status === 'working') {
    return 'working';
  }
  if (status === 'complete') {
    return 'complete';
  }
  if (status === 'exited') {
    return 'exited';
  }
  return 'idle';
}

function controllerDisplayText(
  conversation: WorkspaceRailConversationSummary,
  localControllerId: string | null
): string | null {
  const controller = conversation.controller;
  if (controller === null || controller === undefined) {
    return null;
  }
  if (controller.controllerType === 'human' && controller.controllerId === localControllerId) {
    return null;
  }
  const label = controller.controllerLabel?.trim() ?? '';
  if (label.length > 0) {
    return `controlled by ${label}`;
  }
  return `controlled by ${controller.controllerType}:${controller.controllerId}`;
}

function conversationDetailText(
  conversation: WorkspaceRailConversationSummary,
  localControllerId: string | null,
  normalizedStatus: NormalizedConversationStatus
): string {
  const controllerText = controllerDisplayText(conversation, localControllerId);
  if (controllerText !== null) {
    return controllerText;
  }
  const lastKnownWork = summaryText(conversation.lastKnownWork);
  if (lastKnownWork !== null && isLastKnownWorkCurrent(conversation)) {
    return lastKnownWork;
  }
  const attentionReason = summaryText(conversation.attentionReason);
  if (attentionReason !== null) {
    return attentionReason;
  }
  return `${statusLineLabel(normalizedStatus)} · ${formatCpu(conversation.cpuPercent)} · ${formatMem(conversation.memoryMb)}`;
}

function directoryDisplayName(directory: WorkspaceRailDirectorySummary): string {
  const name = directory.workspaceId.trim();
  if (name.length === 0) {
    return '(unnamed)';
  }
  return name;
}

function conversationDisplayTitle(conversation: WorkspaceRailConversationSummary): string {
  const title = conversation.title.trim();
  if (title.length === 0) {
    return conversation.agentLabel;
  }
  return `${conversation.agentLabel} - ${conversation.title}`;
}

function pushRow(
  rows: WorkspaceRailViewRow[],
  kind: WorkspaceRailViewRow['kind'],
  text: string,
  active = false,
  conversationSessionId: string | null = null,
  directoryKey: string | null = null,
  railAction: WorkspaceRailAction | null = null,
  conversationStatus: NormalizedConversationStatus | null = null
): void {
  rows.push({
    kind,
    text,
    active,
    conversationSessionId,
    directoryKey,
    railAction,
    conversationStatus
  });
}

function buildContentRows(model: WorkspaceRailModel, nowMs: number): readonly WorkspaceRailViewRow[] {
  const rows: WorkspaceRailViewRow[] = [];
  pushRow(rows, 'action', `│  ${ADD_PROJECT_BUTTON_LABEL}`, false, null, null, 'project.add');
  pushRow(rows, 'muted', '│');

  if (model.directories.length === 0) {
    pushRow(rows, 'dir-header', '├─ 📁 no projects');
    pushRow(rows, 'muted', '│  create one with ctrl+o');
    return rows;
  }

  for (let directoryIndex = 0; directoryIndex < model.directories.length; directoryIndex += 1) {
    const directory = model.directories[directoryIndex]!;
    const projectSelected =
      (model.projectSelectionEnabled ?? false) && directory.key === model.activeProjectId;
    const connector = '├';
    pushRow(
      rows,
      'dir-header',
      `${connector}─ 📁 ${directoryDisplayName(directory)} ─ ${directory.git.branch}  ${NEW_THREAD_INLINE_LABEL}`,
      projectSelected,
      null,
      directory.key
    );
    pushRow(
      rows,
      'dir-meta',
      `│  +${String(directory.git.additions)} -${String(directory.git.deletions)} │ ${String(directory.git.changedFiles)} files`,
      projectSelected,
      null,
      directory.key
    );
    pushRow(rows, 'muted', '│', false, null, directory.key);

    const conversations = model.conversations.filter(
      (conversation) => conversation.directoryKey === directory.key
    );
    if (conversations.length > 0) {
      for (let index = 0; index < conversations.length; index += 1) {
        const conversation = conversations[index]!;
        const active =
          !(model.projectSelectionEnabled ?? false) && conversation.sessionId === model.activeConversationId;
        const normalizedStatus = normalizeConversationStatus(conversation, nowMs);
        pushRow(
          rows,
          'conversation-title',
          `│  ${active ? '▸' : ' '} ${statusGlyph(normalizedStatus, nowMs)} ${conversationDisplayTitle(conversation)}`,
          active,
          conversation.sessionId,
          directory.key,
          null,
          normalizedStatus
        );
        pushRow(
          rows,
          'conversation-body',
          `│    ${conversationDetailText(conversation, model.localControllerId ?? null, normalizedStatus)}`,
          active,
          conversation.sessionId,
          directory.key,
          null,
          normalizedStatus
        );
        if (index + 1 < conversations.length) {
          pushRow(rows, 'muted', '│', false, null, directory.key);
        }
      }
    }

    const processes = model.processes.filter((process) => process.directoryKey === directory.key);
    if (processes.length > 0) {
      pushRow(rows, 'muted', '│', false, null, directory.key);
      for (const process of processes) {
        pushRow(rows, 'process-title', `│  ⚙ ${process.label}`, false, null, directory.key);
        pushRow(
          rows,
          'process-meta',
          `│    ${processStatusText(process.status)} · ${formatCpu(process.cpuPercent)} · ${formatMem(process.memoryMb)}`,
          false,
          null,
          directory.key
        );
      }
    }

    if (directoryIndex + 1 < model.directories.length) {
      for (let spacerIndex = 0; spacerIndex < INTER_DIRECTORY_SPACER_ROWS; spacerIndex += 1) {
        pushRow(rows, 'muted', '│', false, null, directory.key);
      }
    }
  }

  return rows;
}

function shortcutDescriptionRows(shortcutHint: string | undefined): readonly string[] {
  const normalized = shortcutHint?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return [
      'ctrl+t new thread',
      'ctrl+x archive thread',
      'ctrl+l take over thread',
      'ctrl+o add project',
      'ctrl+w close project',
      'ctrl+j/k switch thread',
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
      directoryKey: null,
      railAction: 'shortcuts.toggle',
      conversationStatus: null
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
        directoryKey: null,
        railAction: null,
        conversationStatus: null
      });
    }
  }
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

export function actionAtWorkspaceRailCell(
  rows: readonly WorkspaceRailViewRow[],
  rowIndex: number,
  colIndex: number,
  paneCols: number | null = null
): WorkspaceRailAction | null {
  const row = rows[rowIndex];
  if (row === undefined) {
    return null;
  }
  if (row.railAction !== null) {
    return row.railAction;
  }
  if (row.kind !== 'dir-header') {
    return null;
  }
  if (!row.text.includes(NEW_THREAD_INLINE_LABEL)) {
    return null;
  }
  const buttonStart =
    paneCols === null
      ? row.text.lastIndexOf(NEW_THREAD_INLINE_LABEL)
      : Math.max(0, Math.floor(paneCols) - NEW_THREAD_INLINE_LABEL.length);
  const normalizedCol = Math.max(0, Math.floor(colIndex));
  if (normalizedCol < buttonStart || normalizedCol >= buttonStart + NEW_THREAD_INLINE_LABEL.length) {
    return null;
  }
  return 'conversation.new';
}

export function projectIdAtWorkspaceRailRow(
  rows: readonly WorkspaceRailViewRow[],
  rowIndex: number
): string | null {
  const row = rows[rowIndex];
  if (row === undefined) {
    return null;
  }
  return row.directoryKey;
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
