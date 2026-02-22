import { basename } from 'node:path';
import type { ConversationRailSessionSummary } from '../conversation-rail.ts';
import { buildWorkspaceRailViewRows } from '../workspace-rail-model.ts';
import { renderWorkspaceRailAnsiRows } from '../workspace-rail.ts';
import type { ProjectPaneGitHubReviewSummary } from '../project-pane-github-review.ts';
import type {
  StreamSessionController,
  StreamSessionStatusModel,
} from '../../control-plane/stream-protocol.ts';

type WorkspaceRailModel = Parameters<typeof renderWorkspaceRailAnsiRows>[0];

interface GitSummary {
  readonly branch: string;
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
}

interface GitRepositorySnapshot {
  readonly normalizedRemoteUrl: string | null;
  readonly commitCount: number | null;
  readonly lastCommitAt: string | null;
  readonly shortCommitHash: string | null;
  readonly inferredName: string | null;
  readonly defaultBranch: string | null;
}

interface MuxRailRepositoryRecord {
  readonly repositoryId: string;
  readonly name: string;
  readonly remoteUrl: string;
}

interface MuxRailDirectoryRecord {
  readonly directoryId: string;
  readonly path: string;
}

interface MuxRailConversationRecord {
  readonly sessionId: string;
  readonly directoryId: string | null;
  readonly title: string;
  readonly agentType: string;
  readonly status: ConversationRailSessionSummary['status'];
  readonly statusModel: StreamSessionStatusModel | null;
  readonly attentionReason: string | null;
  readonly live: boolean;
  readonly startedAt: string;
  readonly lastEventAt: string | null;
  readonly controller: StreamSessionController | null;
}

interface MuxRailProcessUsageSample {
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
}

interface BuildRailModelArgs {
  readonly repositories: ReadonlyMap<string, MuxRailRepositoryRecord>;
  readonly repositoryAssociationByDirectoryId: ReadonlyMap<string, string>;
  readonly directoryRepositorySnapshotByDirectoryId: ReadonlyMap<string, GitRepositorySnapshot>;
  readonly directories: ReadonlyMap<string, MuxRailDirectoryRecord>;
  readonly conversations: ReadonlyMap<string, MuxRailConversationRecord>;
  readonly orderedIds: readonly string[];
  readonly activeProjectId: string | null;
  readonly activeRepositoryId: string | null;
  readonly activeConversationId: string | null;
  readonly projectSelectionEnabled: boolean;
  readonly repositorySelectionEnabled: boolean;
  readonly homeSelectionEnabled: boolean;
  readonly nimSelectionEnabled?: boolean;
  readonly tasksSelectionEnabled?: boolean;
  readonly showNimEntry?: boolean;
  readonly showTasksEntry?: boolean;
  readonly showGitHubIntegration?: boolean;
  readonly visibleGitHubDirectoryIds?: ReadonlySet<string>;
  readonly expandedGitHubDirectoryIds?: ReadonlySet<string>;
  readonly githubReviewByDirectoryId?: ReadonlyMap<string, ProjectPaneGitHubReviewSummary>;
  readonly githubSelectionEnabled?: boolean;
  readonly activeGitHubProjectId?: string | null;
  readonly repositoriesCollapsed: boolean;
  readonly collapsedRepositoryGroupIds: ReadonlySet<string>;
  readonly gitSummaryByDirectoryId: ReadonlyMap<string, GitSummary>;
  readonly processUsageBySessionId: ReadonlyMap<string, MuxRailProcessUsageSample>;
  readonly loadingGitSummary: GitSummary;
}

interface BuildRailRowsArgs extends BuildRailModelArgs {
  readonly layout: {
    leftCols: number;
    paneRows: number;
  };
}

function conversationSummary(
  conversation: MuxRailConversationRecord,
): ConversationRailSessionSummary {
  return {
    sessionId: conversation.sessionId,
    status: conversation.status,
    statusModel: conversation.statusModel,
    attentionReason: conversation.attentionReason,
    live: conversation.live,
    startedAt: conversation.startedAt,
    lastEventAt: conversation.lastEventAt,
  };
}

export function buildRailModel(args: BuildRailModelArgs): WorkspaceRailModel {
  const repositoryRows = [...args.repositories.values()].map((repository) => {
    let associatedProjectCount = 0;
    let commitCount: number | null = null;
    let lastCommitAt: string | null = null;
    let shortCommitHash: string | null = null;
    for (const [directoryId, repositoryId] of args.repositoryAssociationByDirectoryId.entries()) {
      if (repositoryId !== repository.repositoryId) {
        continue;
      }
      associatedProjectCount += 1;
      const snapshot = args.directoryRepositorySnapshotByDirectoryId.get(directoryId);
      if (snapshot === undefined) {
        continue;
      }
      if (
        snapshot.commitCount !== null &&
        (commitCount === null || snapshot.commitCount > commitCount)
      ) {
        commitCount = snapshot.commitCount;
      }
      const snapshotCommitAtMs =
        snapshot.lastCommitAt === null ? Number.NaN : Date.parse(snapshot.lastCommitAt);
      const currentCommitAtMs = lastCommitAt === null ? Number.NaN : Date.parse(lastCommitAt);
      if (
        snapshot.lastCommitAt !== null &&
        (!Number.isFinite(currentCommitAtMs) || snapshotCommitAtMs >= currentCommitAtMs)
      ) {
        lastCommitAt = snapshot.lastCommitAt;
        shortCommitHash = snapshot.shortCommitHash;
      }
    }
    return {
      repositoryId: repository.repositoryId,
      name: repository.name,
      remoteUrl: repository.remoteUrl,
      associatedProjectCount,
      commitCount,
      lastCommitAt,
      shortCommitHash,
    };
  });
  const directoryRows = [...args.directories.values()].map((directory) => ({
    key: directory.directoryId,
    workspaceId: basename(directory.path) || directory.path,
    worktreeId: directory.path,
    repositoryId: args.repositoryAssociationByDirectoryId.get(directory.directoryId) ?? null,
    git: args.gitSummaryByDirectoryId.get(directory.directoryId) ?? args.loadingGitSummary,
  }));
  const knownDirectoryKeys = new Set(directoryRows.map((directory) => directory.key));
  for (const sessionId of args.orderedIds) {
    const conversation = args.conversations.get(sessionId);
    const directoryKey = conversation?.directoryId;
    if (
      directoryKey === null ||
      directoryKey === undefined ||
      knownDirectoryKeys.has(directoryKey)
    ) {
      continue;
    }
    knownDirectoryKeys.add(directoryKey);
    directoryRows.push({
      key: directoryKey,
      workspaceId: '(untracked)',
      worktreeId: '(untracked)',
      repositoryId: args.repositoryAssociationByDirectoryId.get(directoryKey) ?? null,
      git: args.gitSummaryByDirectoryId.get(directoryKey) ?? args.loadingGitSummary,
    });
  }

  return {
    repositories: repositoryRows,
    directories: directoryRows,
    conversations: args.orderedIds
      .map((sessionId) => {
        const conversation = args.conversations.get(sessionId);
        if (conversation === undefined) {
          return null;
        }
        const directoryKey = conversation.directoryId ?? 'directory-missing';
        return {
          ...conversationSummary(conversation),
          directoryKey,
          title: conversation.title,
          agentLabel: conversation.agentType,
          cpuPercent: args.processUsageBySessionId.get(conversation.sessionId)?.cpuPercent ?? null,
          memoryMb: args.processUsageBySessionId.get(conversation.sessionId)?.memoryMb ?? null,
          controller: conversation.controller,
        };
      })
      .flatMap((conversation) => (conversation === null ? [] : [conversation])),
    activeProjectId: args.activeProjectId,
    activeRepositoryId: args.activeRepositoryId,
    activeConversationId: args.activeConversationId,
    showTaskPlanningUi: true,
    showNimEntry: args.showNimEntry ?? true,
    showTasksEntry: args.showTasksEntry ?? true,
    showGitHubIntegration: args.showGitHubIntegration ?? false,
    ...(args.visibleGitHubDirectoryIds === undefined
      ? {}
      : {
          visibleGitHubDirectoryKeys: [...args.visibleGitHubDirectoryIds],
        }),
    ...(args.expandedGitHubDirectoryIds === undefined
      ? {}
      : {
          expandedGitHubDirectoryKeys: [...args.expandedGitHubDirectoryIds],
        }),
    ...(args.githubReviewByDirectoryId === undefined
      ? {}
      : {
          githubReviewByDirectoryKey: args.githubReviewByDirectoryId,
        }),
    projectSelectionEnabled: args.projectSelectionEnabled,
    githubSelectionEnabled: args.githubSelectionEnabled ?? false,
    activeGitHubProjectId: args.activeGitHubProjectId ?? null,
    repositorySelectionEnabled: args.repositorySelectionEnabled,
    homeSelectionEnabled: args.homeSelectionEnabled,
    nimSelectionEnabled: args.nimSelectionEnabled ?? false,
    tasksSelectionEnabled: args.tasksSelectionEnabled ?? false,
    repositoriesCollapsed: args.repositoriesCollapsed,
    collapsedRepositoryGroupIds: [...args.collapsedRepositoryGroupIds],
    processes: [],
    nowMs: Date.now(),
  };
}

export function buildRailRows(args: BuildRailRowsArgs): {
  ansiRows: readonly string[];
  viewRows: ReturnType<typeof buildWorkspaceRailViewRows>;
} {
  const railModel = buildRailModel(args);
  const viewRows = buildWorkspaceRailViewRows(railModel, args.layout.paneRows);
  return {
    ansiRows: renderWorkspaceRailAnsiRows(railModel, args.layout.leftCols, args.layout.paneRows),
    viewRows,
  };
}
