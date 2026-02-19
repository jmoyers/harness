import type { ConversationRailSessionSummary } from './conversation-rail.ts';
import { formatUiButton } from '../ui/kit.ts';
import type {
  StreamSessionController,
  StreamSessionDisplayPhase,
} from '../control-plane/stream-protocol.ts';

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
  readonly repositoryId?: string | null;
  readonly git: WorkspaceRailGitSummary;
}

interface WorkspaceRailConversationSummary {
  readonly sessionId: string;
  readonly directoryKey: string;
  readonly title: string;
  readonly agentLabel: string;
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
  readonly status?: ConversationRailSessionSummary['status'];
  readonly lastKnownWork?: string | null;
  readonly lastKnownWorkAt?: string | null;
  readonly statusModel: ConversationRailSessionSummary['statusModel'] | null;
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
  readonly showTaskPlanningUi?: boolean;
  readonly activeProjectId: string | null;
  readonly activeRepositoryId?: string | null;
  readonly activeConversationId: string | null;
  readonly projectSelectionEnabled?: boolean;
  readonly repositorySelectionEnabled?: boolean;
  readonly homeSelectionEnabled?: boolean;
  readonly tasksSelectionEnabled?: boolean;
  readonly repositoriesCollapsed?: boolean;
  readonly collapsedRepositoryGroupIds?: readonly string[];
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

const NEW_THREAD_INLINE_LABEL = '[+ thread]';
const UNTRACKED_REPOSITORY_GROUP_ID = 'untracked';
const ADD_PROJECT_BUTTON_LABEL = formatUiButton({
  label: 'add project',
  prefixIcon: '>',
});

type WorkspaceRailAction =
  | 'conversation.new'
  | 'conversation.delete'
  | 'project.add'
  | 'home.open'
  | 'tasks.open'
  | 'project.close'
  | 'shortcuts.toggle'
  | 'repository.toggle'
  | 'repository.add'
  | 'repository.edit'
  | 'repository.archive'
  | 'repositories.toggle';

type NormalizedConversationStatus = StreamSessionDisplayPhase;

interface WorkspaceRailConversationProjection {
  readonly status: NormalizedConversationStatus;
  readonly glyph: string;
  readonly detailText: string;
  readonly statusVisible: boolean;
}

function fixedThreadGlyphForAgent(agentLabel: string): string {
  const normalized = agentLabel.trim().toLowerCase();
  if (normalized === 'terminal') {
    return '⌨';
  }
  if (normalized === 'critique') {
    return '✎';
  }
  return '';
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
  const labels: Record<NormalizedConversationStatus, string> = {
    'needs-action': 'needs input',
    starting: 'starting',
    working: 'active',
    idle: 'inactive',
    exited: 'exited',
  };
  return labels[status];
}

function conversationDetailText(
  conversation: WorkspaceRailConversationSummary,
  normalizedStatus: NormalizedConversationStatus,
): string {
  const detailText = summaryText(conversation.statusModel?.detailText ?? null);
  if (detailText !== null) {
    return detailText;
  }
  const attentionReason = summaryText(conversation.attentionReason);
  if (attentionReason !== null) {
    return attentionReason;
  }
  return statusLineLabel(normalizedStatus);
}

function statusFromRuntimeStatus(
  status: WorkspaceRailConversationSummary['status'] | undefined,
): NormalizedConversationStatus {
  if (status === 'needs-input') {
    return 'needs-action';
  }
  if (status === 'running') {
    return 'starting';
  }
  if (status === 'exited') {
    return 'exited';
  }
  return 'idle';
}

function statusVisibleForAgent(agentLabel: string): boolean {
  const normalized = agentLabel.trim().toLowerCase();
  return normalized !== 'terminal' && normalized !== 'critique';
}

export function projectWorkspaceRailConversation(
  conversation: WorkspaceRailConversationSummary,
  _options: {
    readonly nowMs?: number;
  } = {},
): WorkspaceRailConversationProjection {
  const statusModel = conversation.statusModel;
  const normalizedStatus = statusModel?.phase ?? statusFromRuntimeStatus(conversation.status);
  const statusVisible = statusModel !== null && statusVisibleForAgent(conversation.agentLabel);
  const fixedGlyph = fixedThreadGlyphForAgent(conversation.agentLabel);
  return {
    status: normalizedStatus,
    glyph: statusVisible ? (statusModel?.glyph ?? fixedGlyph) : fixedGlyph,
    detailText: statusVisible ? conversationDetailText(conversation, normalizedStatus) : '',
    statusVisible,
  };
}

function directoryDisplayName(directory: WorkspaceRailDirectorySummary): string {
  const name = directory.workspaceId.trim();
  if (name.length === 0) {
    return '(unnamed)';
  }
  return name;
}

function trackedProjectGitSuffix(git: WorkspaceRailGitSummary): string {
  if (git.additions === 0 && git.deletions === 0) {
    return ` (${git.branch})`;
  }
  return ` (${git.branch}:+${String(git.additions)},-${String(git.deletions)})`;
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
  conversationStatus: NormalizedConversationStatus | null = null,
): void {
  rows.push({
    kind,
    text,
    active,
    conversationSessionId,
    directoryKey,
    repositoryId,
    railAction,
    conversationStatus,
  });
}

function buildContentRows(
  model: WorkspaceRailModel,
  nowMs: number,
): readonly WorkspaceRailViewRow[] {
  const rows: WorkspaceRailViewRow[] = [];
  const showTaskPlanningUi = model.showTaskPlanningUi ?? true;
  const homeSelectionEnabled = model.homeSelectionEnabled ?? false;
  const tasksSelectionEnabled = model.tasksSelectionEnabled ?? false;
  const projectSelectionEnabled = model.projectSelectionEnabled ?? false;
  const repositorySelectionEnabled = model.repositorySelectionEnabled ?? false;
  const collapsedRepositoryGroupIds = new Set(model.collapsedRepositoryGroupIds ?? []);
  const repositoryById = new Map(
    (model.repositories ?? []).map((repository) => [repository.repositoryId, repository] as const),
  );
  const repositoryGroups = new Map<
    string,
    {
      readonly name: string;
      readonly tracked: boolean;
      readonly directories: WorkspaceRailDirectorySummary[];
    }
  >();

  const ensureRepositoryGroup = (
    repositoryId: string,
    name: string,
    tracked: boolean,
  ): {
    readonly name: string;
    readonly tracked: boolean;
    readonly directories: WorkspaceRailDirectorySummary[];
  } => {
    const existing = repositoryGroups.get(repositoryId);
    if (existing !== undefined) {
      return existing;
    }
    const created = {
      name,
      tracked,
      directories: [],
    };
    repositoryGroups.set(repositoryId, created);
    return created;
  };

  for (const directory of model.directories) {
    const repositoryId = directory.repositoryId;
    if (repositoryId === undefined || repositoryId === null || !repositoryById.has(repositoryId)) {
      ensureRepositoryGroup(
        UNTRACKED_REPOSITORY_GROUP_ID,
        UNTRACKED_REPOSITORY_GROUP_ID,
        false,
      ).directories.push(directory);
      continue;
    }
    const repository = repositoryById.get(repositoryId)!;
    ensureRepositoryGroup(repository.repositoryId, repository.name, true).directories.push(
      directory,
    );
  }

  const orderedRepositoryGroupIds: string[] = [];
  for (const repository of model.repositories ?? []) {
    const group = repositoryGroups.get(repository.repositoryId);
    if (group === undefined || group.directories.length === 0) {
      continue;
    }
    orderedRepositoryGroupIds.push(repository.repositoryId);
  }
  if (repositoryGroups.has(UNTRACKED_REPOSITORY_GROUP_ID)) {
    orderedRepositoryGroupIds.push(UNTRACKED_REPOSITORY_GROUP_ID);
  }

  const activeConversationCountByDirectoryId = new Map<string, number>();
  for (const conversation of model.conversations) {
    const projection = projectWorkspaceRailConversation(conversation, {
      nowMs,
    });
    if (!projection.statusVisible) {
      continue;
    }
    if (
      projection.status !== 'working' &&
      projection.status !== 'starting' &&
      projection.status !== 'needs-action'
    ) {
      continue;
    }
    const count = activeConversationCountByDirectoryId.get(conversation.directoryKey) ?? 0;
    activeConversationCountByDirectoryId.set(conversation.directoryKey, count + 1);
  }

  if (showTaskPlanningUi) {
    pushRow(rows, 'dir-header', '├─ 🏠 home', homeSelectionEnabled, null, null, null, 'home.open');
    pushRow(
      rows,
      'dir-header',
      '├─ 🗂️ tasks',
      tasksSelectionEnabled,
      null,
      null,
      null,
      'tasks.open',
    );
  }

  if (orderedRepositoryGroupIds.length === 0) {
    pushRow(rows, 'dir-header', '├─ 📁 no projects');
    pushRow(rows, 'muted', '│  create one with ctrl+o');
    return rows;
  }

  for (const repositoryId of orderedRepositoryGroupIds) {
    const group = repositoryGroups.get(repositoryId);
    if (group === undefined || group.directories.length === 0) {
      continue;
    }
    const activeProjectCount = group.directories.filter(
      (directory) => (activeConversationCountByDirectoryId.get(directory.key) ?? 0) > 0,
    ).length;
    const repositorySelected =
      repositorySelectionEnabled && model.activeRepositoryId === repositoryId;
    const repositoryCollapsed =
      model.repositoriesCollapsed === true || collapsedRepositoryGroupIds.has(repositoryId);
    pushRow(
      rows,
      'repository-header',
      `├─ 📁 ${group.name} (${String(group.directories.length)} projects, ${String(activeProjectCount)} active) ${
        repositoryCollapsed ? '[+]' : '[-]'
      }`,
      repositorySelected,
      null,
      null,
      repositoryId,
      'repository.toggle',
    );
    if (repositoryCollapsed) {
      continue;
    }

    for (let directoryIndex = 0; directoryIndex < group.directories.length; directoryIndex += 1) {
      const directory = group.directories[directoryIndex]!;
      const projectSelected = projectSelectionEnabled && directory.key === model.activeProjectId;
      const projectIsLast = directoryIndex + 1 >= group.directories.length;
      const projectTreePrefix = `│  ${projectIsLast ? '└' : '├'}─ `;
      const projectChildPrefix = `│  ${projectIsLast ? '   ' : '│  '}`;
      const projectGitSuffix = group.tracked ? trackedProjectGitSuffix(directory.git) : '';
      pushRow(
        rows,
        'dir-header',
        `${projectTreePrefix}📁 ${directoryDisplayName(directory)}${projectGitSuffix}  ${NEW_THREAD_INLINE_LABEL}`,
        projectSelected,
        null,
        directory.key,
        repositoryId,
        null,
      );

      const conversations = model.conversations.filter(
        (conversation) => conversation.directoryKey === directory.key,
      );
      for (
        let conversationIndex = 0;
        conversationIndex < conversations.length;
        conversationIndex += 1
      ) {
        const conversation = conversations[conversationIndex]!;
        const conversationIsLast = conversationIndex + 1 >= conversations.length;
        const active =
          !projectSelectionEnabled &&
          !homeSelectionEnabled &&
          !repositorySelectionEnabled &&
          conversation.sessionId === model.activeConversationId;
        const projection = projectWorkspaceRailConversation(conversation, {
          nowMs,
        });
        const hasTitleGlyph = projection.glyph.trim().length > 0;
        const titleText = hasTitleGlyph
          ? `${projectChildPrefix}${conversationIsLast ? '└' : '├'}─ ${projection.glyph} ${conversationDisplayTitle(
              conversation,
            )}`
          : `${projectChildPrefix}${conversationIsLast ? '└' : '├'}─ ${conversationDisplayTitle(
              conversation,
            )}`;
        pushRow(
          rows,
          'conversation-title',
          titleText,
          active,
          conversation.sessionId,
          directory.key,
          repositoryId,
          null,
          projection.statusVisible ? projection.status : null,
        );
        if (projection.statusVisible) {
          pushRow(
            rows,
            'conversation-body',
            `${projectChildPrefix}${conversationIsLast ? '     ' : '│    '}${projection.detailText}`,
            active,
            conversation.sessionId,
            directory.key,
            repositoryId,
            null,
            projection.status,
          );
        }
      }

      const processes = model.processes.filter((process) => process.directoryKey === directory.key);
      for (const process of processes) {
        pushRow(
          rows,
          'process-title',
          `${projectChildPrefix}⚙ ${process.label}`,
          false,
          null,
          directory.key,
          repositoryId,
          null,
        );
        pushRow(
          rows,
          'process-meta',
          `${projectChildPrefix}${processStatusText(process.status)} · ${formatCpu(process.cpuPercent)} · ${formatMem(process.memoryMb)}`,
          false,
          null,
          directory.key,
          repositoryId,
          null,
        );
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
      'ctrl+g critique thread',
      'ctrl+x archive thread',
      'ctrl+l take over thread',
      'ctrl+o add project',
      'ctrl+w close project',
      'ctrl+j/k switch nav',
      '→ expand repo',
      '← collapse repo',
      'ctrl+k ctrl+j expand all repos',
      'ctrl+k ctrl+0 collapse all repos',
      'ctrl+c quit mux',
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
  shortcutsCollapsed: boolean,
): readonly WorkspaceRailViewRow[] {
  const rows: WorkspaceRailViewRow[] = [
    {
      kind: 'shortcut-header',
      text: `├─ shortcuts ${shortcutsCollapsed ? '[+]' : '[-]'}`,
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: null,
      railAction: 'shortcuts.toggle',
      conversationStatus: null,
    },
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
        conversationStatus: null,
      });
    }
  }
  return rows;
}

export function buildWorkspaceRailViewRows(
  model: WorkspaceRailModel,
  maxRows: number,
): readonly WorkspaceRailViewRow[] {
  const safeRows = Math.max(1, maxRows);
  const nowMs = model.nowMs ?? Date.now();
  const contentRows = buildContentRows(model, nowMs);
  const renderedShortcuts = shortcutRows(model.shortcutHint, model.shortcutsCollapsed ?? false);

  if (safeRows <= renderedShortcuts.length) {
    return renderedShortcuts.slice(renderedShortcuts.length - safeRows);
  }

  const contentCapacity = safeRows - renderedShortcuts.length;
  const rows: WorkspaceRailViewRow[] = [...contentRows.slice(0, Math.max(0, contentCapacity - 1))];
  while (rows.length < contentCapacity) {
    rows.push({
      kind: 'muted',
      text: '│',
      active: false,
      conversationSessionId: null,
      directoryKey: null,
      repositoryId: null,
      railAction: null,
      conversationStatus: null,
    });
  }
  const projectActionRow: WorkspaceRailViewRow = {
    kind: 'action',
    text: ADD_PROJECT_BUTTON_LABEL,
    active: false,
    conversationSessionId: null,
    directoryKey: null,
    repositoryId: null,
    railAction: 'project.add',
    conversationStatus: null,
  };
  const projectActionRowIndex = Math.max(0, contentCapacity - 3);
  rows.splice(projectActionRowIndex, 0, projectActionRow);
  if (rows.length > contentCapacity) {
    rows.length = contentCapacity;
  }
  rows.push(...renderedShortcuts);
  return rows;
}

export function conversationIdAtWorkspaceRailRow(
  rows: readonly WorkspaceRailViewRow[],
  rowIndex: number,
): string | null {
  const row = rows[rowIndex];
  if (row === undefined) {
    return null;
  }
  return row.conversationSessionId;
}

export function actionAtWorkspaceRailRow(
  rows: readonly WorkspaceRailViewRow[],
  rowIndex: number,
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
  paneCols: number | null = null,
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
  if (
    normalizedCol < buttonStart ||
    normalizedCol >= buttonStart + NEW_THREAD_INLINE_LABEL.length
  ) {
    return null;
  }
  return 'conversation.new';
}

export function projectIdAtWorkspaceRailRow(
  rows: readonly WorkspaceRailViewRow[],
  rowIndex: number,
): string | null {
  const row = rows[rowIndex];
  if (row === undefined) {
    return null;
  }
  return row.directoryKey;
}

export function repositoryIdAtWorkspaceRailRow(
  rows: readonly WorkspaceRailViewRow[],
  rowIndex: number,
): string | null {
  const row = rows[rowIndex];
  if (row === undefined) {
    return null;
  }
  return row.repositoryId;
}

export function kindAtWorkspaceRailRow(
  rows: readonly WorkspaceRailViewRow[],
  rowIndex: number,
): WorkspaceRailViewRow['kind'] | null {
  const row = rows[rowIndex];
  if (row === undefined) {
    return null;
  }
  return row.kind;
}
