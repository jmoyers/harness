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

interface WorkspaceRailRepositorySummary {
  readonly repositoryId: string;
  readonly name: string;
  readonly remoteUrl: string;
  readonly associatedProjectCount: number;
  readonly commitCount: number | null;
  readonly lastCommitAt: string | null;
  readonly shortCommitHash: string | null;
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
  readonly repositories?: readonly WorkspaceRailRepositorySummary[];
  readonly directories: readonly WorkspaceRailDirectorySummary[];
  readonly conversations: readonly WorkspaceRailConversationSummary[];
  readonly processes: readonly WorkspaceRailProcessSummary[];
  readonly activeProjectId: string | null;
  readonly activeConversationId: string | null;
  readonly localControllerId?: string | null;
  readonly projectSelectionEnabled?: boolean;
  readonly repositoriesCollapsed?: boolean;
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
    | 'repository-header'
    | 'repository-row'
    | 'shortcut-header'
    | 'shortcut-body'
    | 'action'
    | 'muted';
  readonly text: string;
  readonly active: boolean;
  readonly conversationSessionId: string | null;
  readonly directoryKey: string | null;
  readonly repositoryId: string | null;
  readonly railAction: WorkspaceRailAction | null;
  readonly conversationStatus: NormalizedConversationStatus | null;
}

const INTER_DIRECTORY_SPACER_ROWS = 2;
const NEW_THREAD_INLINE_LABEL = '[+ thread]';
const ADD_PROJECT_BUTTON_LABEL = formatUiButton({
  label: 'add project',
  prefixIcon: '>'
});
const ADD_REPOSITORY_BUTTON_LABEL = formatUiButton({
  label: 'add repository',
  prefixIcon: '>'
});
const ARCHIVE_REPOSITORY_BUTTON_LABEL = formatUiButton({
  label: 'archive repository',
  prefixIcon: '<'
});
const STARTING_TEXT_STALE_MS = 2_000;
const WORKING_TEXT_STALE_MS = 5_000;
const NEEDS_ACTION_TEXT_STALE_MS = 60_000;
const RUNNING_ACTIVITY_STALE_MS = 15_000;

type WorkspaceRailAction =
  | 'conversation.new'
  | 'conversation.delete'
  | 'project.add'
  | 'project.close'
  | 'shortcuts.toggle'
  | 'repository.add'
  | 'repository.edit'
  | 'repository.archive'
  | 'repositories.toggle';

type NormalizedConversationStatus = 'needs-action' | 'starting' | 'working' | 'idle' | 'exited';

interface WorkspaceRailConversationProjection {
  readonly status: NormalizedConversationStatus;
  readonly glyph: string;
  readonly detailText: string;
}

function parseIsoMs(value: string | null | undefined): number {
  if (value === null || value === undefined) {
    return Number.NaN;
  }
  return Date.parse(value);
}

function isLastKnownWorkCurrent(
  conversation: WorkspaceRailConversationSummary,
  nowMs: number
): boolean {
  const lastKnownWorkAtMs = parseIsoMs(conversation.lastKnownWorkAt ?? null);
  if (!Number.isFinite(lastKnownWorkAtMs)) {
    return true;
  }
  const ageMs = Math.max(0, nowMs - lastKnownWorkAtMs);
  const inferred = inferStatusFromLastKnownWork(conversation.lastKnownWork);
  if (inferred === 'starting') {
    return ageMs <= STARTING_TEXT_STALE_MS;
  }
  if (inferred === 'working') {
    return ageMs <= WORKING_TEXT_STALE_MS;
  }
  if (inferred === 'needs-action') {
    return ageMs <= NEEDS_ACTION_TEXT_STALE_MS;
  }
  return true;
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
  if (normalized === 'starting' || normalized.includes('conversation started')) {
    return 'starting';
  }
  if (
    normalized === 'idle' ||
    normalized.includes('turn complete') ||
    normalized.includes('response.completed') ||
    normalized.includes('response complete') ||
    normalized.includes('completed')
  ) {
    return 'idle';
  }
  if (
    normalized.startsWith('working:') ||
    normalized.includes('thinking') ||
    normalized.includes('writing') ||
    normalized.includes('tool ')
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
  if (conversation.status === 'exited') {
    return 'exited';
  }
  const inferred = inferStatusFromLastKnownWork(conversation.lastKnownWork);
  if (inferred !== null && isLastKnownWorkCurrent(conversation, nowMs)) {
    if (inferred === 'idle' && hasFreshRunningActivity(conversation, nowMs)) {
      return 'working';
    }
    return inferred;
  }
  if (hasFreshRunningActivity(conversation, nowMs)) {
    return 'working';
  }
  return 'idle';
}

function statusGlyph(status: NormalizedConversationStatus): string {
  if (status === 'needs-action') {
    return '▲';
  }
  if (status === 'starting') {
    return '◔';
  }
  if (status === 'working') {
    return '◆';
  }
  if (status === 'idle') {
    return '○';
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
  if (status === 'exited') {
    return 'exited';
  }
  return 'idle';
}

function hasFreshRunningActivity(
  conversation: WorkspaceRailConversationSummary,
  nowMs: number
): boolean {
  if (conversation.status !== 'running') {
    return false;
  }
  const lastEventAtMs = parseIsoMs(conversation.lastEventAt);
  if (!Number.isFinite(lastEventAtMs)) {
    return false;
  }
  const lastKnownWorkAtMs = parseIsoMs(conversation.lastKnownWorkAt ?? null);
  if (Number.isFinite(lastKnownWorkAtMs) && lastEventAtMs <= lastKnownWorkAtMs) {
    return false;
  }
  const ageMs = Math.max(0, nowMs - lastEventAtMs);
  return ageMs <= RUNNING_ACTIVITY_STALE_MS;
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
  normalizedStatus: NormalizedConversationStatus,
  nowMs: number
): string {
  const controllerText = controllerDisplayText(conversation, localControllerId);
  if (controllerText !== null) {
    return controllerText;
  }
  const lastKnownWork = summaryText(conversation.lastKnownWork);
  const inferredStatus = inferStatusFromLastKnownWork(lastKnownWork);
  if (
    lastKnownWork !== null &&
    isLastKnownWorkCurrent(conversation, nowMs) &&
    !(
      normalizedStatus === 'working' &&
      inferredStatus === 'idle' &&
      hasFreshRunningActivity(conversation, nowMs)
    )
  ) {
    return lastKnownWork;
  }
  const attentionReason = summaryText(conversation.attentionReason);
  if (attentionReason !== null) {
    return attentionReason;
  }
  return `${statusLineLabel(normalizedStatus)} · ${formatCpu(conversation.cpuPercent)} · ${formatMem(conversation.memoryMb)}`;
}

export function projectWorkspaceRailConversation(
  conversation: WorkspaceRailConversationSummary,
  options: {
    readonly localControllerId?: string | null;
    readonly nowMs?: number;
  } = {}
): WorkspaceRailConversationProjection {
  const nowMs = options.nowMs ?? Date.now();
  const normalizedStatus = normalizeConversationStatus(conversation, nowMs);
  return {
    status: normalizedStatus,
    glyph: statusGlyph(normalizedStatus),
    detailText: conversationDetailText(
      conversation,
      options.localControllerId ?? null,
      normalizedStatus,
      nowMs
    )
  };
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
  repositoryId: string | null = null,
  railAction: WorkspaceRailAction | null = null,
  conversationStatus: NormalizedConversationStatus | null = null
): void {
  rows.push({
    kind,
    text,
    active,
    conversationSessionId,
    directoryKey,
    repositoryId,
    railAction,
    conversationStatus
  });
}

function repositoryDisplayName(repository: WorkspaceRailRepositorySummary): string {
  const name = repository.name.trim();
  if (name.length > 0) {
    return name;
  }
  return '(unnamed repository)';
}

function repositoryPathFromUrl(remoteUrl: string): string | null {
  const normalized = remoteUrl.trim();
  if (normalized.length === 0) {
    return null;
  }
  const match = /github\.com[/:]([^/\s]+\/[^/\s]+?)(?:\.git)?(?:\/)?$/iu.exec(normalized);
  if (match === null) {
    return null;
  }
  return match[1] as string;
}

function formatRepositoryCommitCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '· commits';
  }
  const rounded = Math.max(0, Math.floor(value));
  return `${String(rounded)} commits`;
}

function formatRepositoryLastUpdated(lastCommitAt: string | null, nowMs: number): string {
  const commitAtMs = parseIsoMs(lastCommitAt);
  if (!Number.isFinite(commitAtMs)) {
    return 'unknown';
  }
  const diffMs = Math.max(0, nowMs - commitAtMs);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (diffMs < minuteMs) {
    return 'just now';
  }
  if (diffMs < hourMs) {
    return `${String(Math.floor(diffMs / minuteMs))}m ago`;
  }
  if (diffMs < dayMs) {
    return `${String(Math.floor(diffMs / hourMs))}h ago`;
  }
  return `${String(Math.floor(diffMs / dayMs))}d ago`;
}

function repositoryStatLine(repository: WorkspaceRailRepositorySummary, nowMs: number): string {
  const commitCount = formatRepositoryCommitCount(repository.commitCount);
  const updated = formatRepositoryLastUpdated(repository.lastCommitAt, nowMs);
  const hash =
    repository.shortCommitHash === null || repository.shortCommitHash.trim().length === 0
      ? '·'
      : repository.shortCommitHash.trim();
  const path = repositoryPathFromUrl(repository.remoteUrl);
  const projectCountLabel = repository.associatedProjectCount === 1 ? 'project' : 'projects';
  const pathSuffix = path === null ? '' : ` (${path})`;
  return `${repositoryDisplayName(repository)}${pathSuffix} · ${String(repository.associatedProjectCount)} ${projectCountLabel} · ${commitCount} · ${updated} · ${hash}`;
}

function buildContentRows(model: WorkspaceRailModel, nowMs: number): readonly WorkspaceRailViewRow[] {
  const rows: WorkspaceRailViewRow[] = [];
  const showRepositorySection =
    model.repositories !== undefined || model.repositoriesCollapsed !== undefined;
  if (showRepositorySection) {
    const repositories = model.repositories ?? [];
    const repositoriesCollapsed = model.repositoriesCollapsed ?? false;
    pushRow(rows, 'repository-header', `├─ ⎇ repositories ${repositoriesCollapsed ? '[+]' : '[-]'}`, false, null, null, null, 'repositories.toggle');
    if (!repositoriesCollapsed) {
      pushRow(rows, 'action', `│  ${ADD_REPOSITORY_BUTTON_LABEL}`, false, null, null, null, 'repository.add');
      if (repositories.length === 0) {
        pushRow(rows, 'muted', '│  no repositories');
      } else {
        for (const repository of repositories) {
          pushRow(
            rows,
            'repository-row',
            `│  ⎇ ${repositoryStatLine(repository, nowMs)}`,
            false,
            null,
            null,
            repository.repositoryId,
            'repository.edit'
          );
          pushRow(
            rows,
            'action',
            `│    ${ARCHIVE_REPOSITORY_BUTTON_LABEL}`,
            false,
            null,
            null,
            repository.repositoryId,
            'repository.archive'
          );
          pushRow(rows, 'muted', '│');
        }
      }
    }
  }

  pushRow(rows, 'action', `│  ${ADD_PROJECT_BUTTON_LABEL}`, false, null, null, null, 'project.add');
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
      directory.key,
      null,
      null
    );
    pushRow(
      rows,
      'dir-meta',
      `│  +${String(directory.git.additions)} -${String(directory.git.deletions)} │ ${String(directory.git.changedFiles)} files`,
      projectSelected,
      null,
      directory.key,
      null,
      null
    );
    pushRow(rows, 'muted', '│', false, null, directory.key, null, null);

    const conversations = model.conversations.filter(
      (conversation) => conversation.directoryKey === directory.key
    );
    if (conversations.length > 0) {
      for (let index = 0; index < conversations.length; index += 1) {
        const conversation = conversations[index]!;
        const active =
          !(model.projectSelectionEnabled ?? false) && conversation.sessionId === model.activeConversationId;
        const projection = projectWorkspaceRailConversation(conversation, {
          localControllerId: model.localControllerId ?? null,
          nowMs
        });
        pushRow(
          rows,
          'conversation-title',
          `│  ${active ? '▸' : ' '} ${projection.glyph} ${conversationDisplayTitle(conversation)}`,
          active,
          conversation.sessionId,
          directory.key,
          null,
          null,
          projection.status
        );
        pushRow(
          rows,
          'conversation-body',
          `│    ${projection.detailText}`,
          active,
          conversation.sessionId,
          directory.key,
          null,
          null,
          projection.status
        );
        if (index + 1 < conversations.length) {
          pushRow(rows, 'muted', '│', false, null, directory.key, null, null);
        }
      }
    }

    const processes = model.processes.filter((process) => process.directoryKey === directory.key);
    if (processes.length > 0) {
      pushRow(rows, 'muted', '│', false, null, directory.key, null, null);
      for (const process of processes) {
        pushRow(rows, 'process-title', `│  ⚙ ${process.label}`, false, null, directory.key, null, null);
        pushRow(
          rows,
          'process-meta',
          `│    ${processStatusText(process.status)} · ${formatCpu(process.cpuPercent)} · ${formatMem(process.memoryMb)}`,
          false,
          null,
          directory.key,
          null,
          null
        );
      }
    }

    if (directoryIndex + 1 < model.directories.length) {
      for (let spacerIndex = 0; spacerIndex < INTER_DIRECTORY_SPACER_ROWS; spacerIndex += 1) {
        pushRow(rows, 'muted', '│', false, null, directory.key, null, null);
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
      repositoryId: null,
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
        repositoryId: null,
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

export function repositoryIdAtWorkspaceRailRow(
  rows: readonly WorkspaceRailViewRow[],
  rowIndex: number
): string | null {
  const row = rows[rowIndex];
  if (row === undefined) {
    return null;
  }
  return row.repositoryId;
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
