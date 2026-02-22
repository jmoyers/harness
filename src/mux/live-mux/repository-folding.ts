import type { ConversationState } from './conversation-state.ts';
import type { LeftNavSelection } from './left-nav.ts';

export function selectedRepositoryGroupIdForLeftNav(
  leftNavSelection: LeftNavSelection,
  conversations: ReadonlyMap<string, ConversationState>,
  repositoryGroupIdForDirectory: (directoryId: string) => string,
): string | null {
  if (leftNavSelection.kind === 'repository') {
    return leftNavSelection.repositoryId;
  }
  if (leftNavSelection.kind === 'project') {
    return repositoryGroupIdForDirectory(leftNavSelection.directoryId);
  }
  if (leftNavSelection.kind === 'github') {
    return repositoryGroupIdForDirectory(leftNavSelection.directoryId);
  }
  if (leftNavSelection.kind === 'conversation') {
    const conversation = conversations.get(leftNavSelection.sessionId);
    if (conversation?.directoryId !== null && conversation?.directoryId !== undefined) {
      return repositoryGroupIdForDirectory(conversation.directoryId);
    }
  }
  return null;
}

export function repositoryTreeArrowAction(
  input: Buffer,
  leftNavSelection: LeftNavSelection,
  repositoryId: string | null,
): 'expand' | 'collapse' | null {
  if (leftNavSelection.kind === 'conversation' || repositoryId === null) {
    return null;
  }
  const text = input.toString('utf8');
  if (text === '\u001b[C') {
    return 'expand';
  }
  if (text === '\u001b[D') {
    return 'collapse';
  }
  return null;
}

interface RepositoryFoldChordResult {
  consumed: boolean;
  nextPrefixAtMs: number | null;
  action: 'expand-all' | 'collapse-all' | null;
}

interface RepositoryFoldChordOptions {
  input: Buffer;
  leftNavSelection: LeftNavSelection;
  nowMs: number;
  prefixAtMs: number | null;
  chordTimeoutMs: number;
  collapseAllChordPrefix: Buffer;
}

export function reduceRepositoryFoldChordInput(
  options: RepositoryFoldChordOptions,
): RepositoryFoldChordResult {
  if (options.leftNavSelection.kind === 'conversation') {
    return {
      consumed: false,
      nextPrefixAtMs: null,
      action: null,
    };
  }

  let prefixAtMs = options.prefixAtMs;
  if (prefixAtMs !== null && options.nowMs - prefixAtMs > options.chordTimeoutMs) {
    prefixAtMs = null;
  }

  if (prefixAtMs !== null) {
    if (options.input.length === 1 && options.input[0] === 0x0a) {
      return {
        consumed: true,
        nextPrefixAtMs: null,
        action: 'expand-all',
      };
    }
    if (options.input.length === 1 && options.input[0] === 0x30) {
      return {
        consumed: true,
        nextPrefixAtMs: null,
        action: 'collapse-all',
      };
    }
    return {
      consumed: false,
      nextPrefixAtMs: null,
      action: null,
    };
  }

  if (options.input.equals(options.collapseAllChordPrefix)) {
    return {
      consumed: true,
      nextPrefixAtMs: options.nowMs,
      action: null,
    };
  }

  return {
    consumed: false,
    nextPrefixAtMs: null,
    action: null,
  };
}

function isRepositoryGroupCollapsed(
  repositoryGroupId: string,
  repositoriesCollapsed: boolean,
  expandedRepositoryGroupIds: ReadonlySet<string>,
  collapsedRepositoryGroupIds: ReadonlySet<string>,
): boolean {
  if (repositoriesCollapsed) {
    return !expandedRepositoryGroupIds.has(repositoryGroupId);
  }
  return collapsedRepositoryGroupIds.has(repositoryGroupId);
}

export function collapseRepositoryGroup(
  repositoryGroupId: string,
  repositoriesCollapsed: boolean,
  expandedRepositoryGroupIds: Set<string>,
  collapsedRepositoryGroupIds: Set<string>,
): void {
  if (repositoriesCollapsed) {
    expandedRepositoryGroupIds.delete(repositoryGroupId);
    return;
  }
  collapsedRepositoryGroupIds.add(repositoryGroupId);
}

export function expandRepositoryGroup(
  repositoryGroupId: string,
  repositoriesCollapsed: boolean,
  expandedRepositoryGroupIds: Set<string>,
  collapsedRepositoryGroupIds: Set<string>,
): void {
  if (repositoriesCollapsed) {
    expandedRepositoryGroupIds.add(repositoryGroupId);
    return;
  }
  collapsedRepositoryGroupIds.delete(repositoryGroupId);
}

export function toggleRepositoryGroup(
  repositoryGroupId: string,
  repositoriesCollapsed: boolean,
  expandedRepositoryGroupIds: Set<string>,
  collapsedRepositoryGroupIds: Set<string>,
): void {
  if (
    isRepositoryGroupCollapsed(
      repositoryGroupId,
      repositoriesCollapsed,
      expandedRepositoryGroupIds,
      collapsedRepositoryGroupIds,
    )
  ) {
    expandRepositoryGroup(
      repositoryGroupId,
      repositoriesCollapsed,
      expandedRepositoryGroupIds,
      collapsedRepositoryGroupIds,
    );
    return;
  }
  collapseRepositoryGroup(
    repositoryGroupId,
    repositoriesCollapsed,
    expandedRepositoryGroupIds,
    collapsedRepositoryGroupIds,
  );
}

export function collapseAllRepositoryGroups(
  collapsedRepositoryGroupIds: Set<string>,
  expandedRepositoryGroupIds: Set<string>,
): true {
  collapsedRepositoryGroupIds.clear();
  expandedRepositoryGroupIds.clear();
  return true;
}

export function expandAllRepositoryGroups(
  collapsedRepositoryGroupIds: Set<string>,
  expandedRepositoryGroupIds: Set<string>,
): false {
  collapsedRepositoryGroupIds.clear();
  expandedRepositoryGroupIds.clear();
  return false;
}

export function firstDirectoryForRepositoryGroup<TDirectory extends { directoryId: string }>(
  directories: ReadonlyMap<string, TDirectory>,
  directoryRepositoryGroupId: (directoryId: string) => string,
  repositoryGroupId: string,
): string | null {
  for (const directory of directories.values()) {
    if (directoryRepositoryGroupId(directory.directoryId) === repositoryGroupId) {
      return directory.directoryId;
    }
  }
  return null;
}
