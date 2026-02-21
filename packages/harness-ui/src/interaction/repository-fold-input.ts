import type { LeftNavSelection } from './left-nav-input.ts';

export interface RepositoryFoldState {
  readonly leftNavSelection: () => LeftNavSelection;
  readonly repositoryToggleChordPrefixAtMs: () => number | null;
  readonly setRepositoryToggleChordPrefixAtMs: (value: number | null) => void;
  readonly conversations: () => ReadonlyMap<string, { directoryId: string | null }>;
  readonly repositoryGroupIdForDirectory: (directoryId: string) => string;
  readonly nowMs: () => number;
}

export interface RepositoryFoldActions {
  readonly collapseRepositoryGroup: (repositoryGroupId: string) => void;
  readonly expandRepositoryGroup: (repositoryGroupId: string) => void;
  readonly collapseAllRepositoryGroups: () => void;
  readonly expandAllRepositoryGroups: () => void;
  readonly selectLeftNavRepository: (repositoryGroupId: string) => void;
  readonly markDirty: () => void;
}

export interface RepositoryFoldChordConfig {
  readonly chordTimeoutMs: number;
  readonly collapseAllChordPrefix: Buffer;
}

export interface RepositoryFoldStrategies {
  reduceRepositoryFoldChordInput(input: {
    readonly input: Buffer;
    readonly leftNavSelection: LeftNavSelection;
    readonly nowMs: number;
    readonly prefixAtMs: number | null;
    readonly chordTimeoutMs: number;
    readonly collapseAllChordPrefix: Buffer;
  }): {
    readonly consumed: boolean;
    readonly nextPrefixAtMs: number | null;
    readonly action: 'expand-all' | 'collapse-all' | null;
  };
  repositoryTreeArrowAction(
    input: Buffer,
    selection: LeftNavSelection,
    repositoryId: string | null,
  ): 'expand' | 'collapse' | null;
}

export class RepositoryFoldInput {
  constructor(
    private readonly state: RepositoryFoldState,
    private readonly actions: RepositoryFoldActions,
    private readonly chordConfig: RepositoryFoldChordConfig,
    private readonly strategies: RepositoryFoldStrategies,
  ) {}

  private selectedRepositoryGroupId(): string | null {
    const leftNavSelection = this.state.leftNavSelection();
    if (leftNavSelection.kind === 'repository') {
      return leftNavSelection.repositoryId;
    }
    if (leftNavSelection.kind === 'project') {
      return this.state.repositoryGroupIdForDirectory(leftNavSelection.directoryId);
    }
    if (leftNavSelection.kind === 'conversation') {
      const conversation = this.state.conversations().get(leftNavSelection.sessionId);
      if (conversation?.directoryId !== null && conversation?.directoryId !== undefined) {
        return this.state.repositoryGroupIdForDirectory(conversation.directoryId);
      }
    }
    return null;
  }

  handleRepositoryTreeArrow(input: Buffer): boolean {
    const repositoryId = this.selectedRepositoryGroupId();
    const action = this.strategies.repositoryTreeArrowAction(
      input,
      this.state.leftNavSelection(),
      repositoryId,
    );
    if (repositoryId === null || action === null) {
      return false;
    }
    if (action === 'expand') {
      this.actions.expandRepositoryGroup(repositoryId);
      this.actions.selectLeftNavRepository(repositoryId);
      this.actions.markDirty();
      return true;
    }
    if (action === 'collapse') {
      this.actions.collapseRepositoryGroup(repositoryId);
      this.actions.selectLeftNavRepository(repositoryId);
      this.actions.markDirty();
      return true;
    }
    return false;
  }

  handleRepositoryFoldChords(input: Buffer): boolean {
    const reduced = this.strategies.reduceRepositoryFoldChordInput({
      input,
      leftNavSelection: this.state.leftNavSelection(),
      nowMs: this.state.nowMs(),
      prefixAtMs: this.state.repositoryToggleChordPrefixAtMs(),
      chordTimeoutMs: this.chordConfig.chordTimeoutMs,
      collapseAllChordPrefix: this.chordConfig.collapseAllChordPrefix,
    });
    this.state.setRepositoryToggleChordPrefixAtMs(reduced.nextPrefixAtMs);
    if (reduced.action === 'expand-all') {
      this.actions.expandAllRepositoryGroups();
      this.actions.markDirty();
      return true;
    }
    if (reduced.action === 'collapse-all') {
      this.actions.collapseAllRepositoryGroups();
      this.actions.markDirty();
      return true;
    }
    return reduced.consumed;
  }
}
