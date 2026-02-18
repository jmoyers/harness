import {
  reduceRepositoryFoldChordInput,
  repositoryTreeArrowAction,
} from '../mux/live-mux/repository-folding.ts';
import type { LeftNavSelection } from '../mux/live-mux/left-nav.ts';

interface RepositoryFoldInputOptions {
  readonly getLeftNavSelection: () => LeftNavSelection;
  readonly getRepositoryToggleChordPrefixAtMs: () => number | null;
  readonly setRepositoryToggleChordPrefixAtMs: (value: number | null) => void;
  readonly conversations: ReadonlyMap<string, { directoryId: string | null }>;
  readonly repositoryGroupIdForDirectory: (directoryId: string) => string;
  readonly collapseRepositoryGroup: (repositoryGroupId: string) => void;
  readonly expandRepositoryGroup: (repositoryGroupId: string) => void;
  readonly collapseAllRepositoryGroups: () => void;
  readonly expandAllRepositoryGroups: () => void;
  readonly selectLeftNavRepository: (repositoryGroupId: string) => void;
  readonly markDirty: () => void;
  readonly chordTimeoutMs: number;
  readonly collapseAllChordPrefix: Buffer;
  readonly nowMs: () => number;
}

export class RepositoryFoldInput {
  constructor(private readonly options: RepositoryFoldInputOptions) {}

  private selectedRepositoryGroupId(): string | null {
    const leftNavSelection = this.options.getLeftNavSelection();
    if (leftNavSelection.kind === 'repository') {
      return leftNavSelection.repositoryId;
    }
    if (leftNavSelection.kind === 'project') {
      return this.options.repositoryGroupIdForDirectory(leftNavSelection.directoryId);
    }
    if (leftNavSelection.kind === 'conversation') {
      const conversation = this.options.conversations.get(leftNavSelection.sessionId);
      if (conversation?.directoryId !== null && conversation?.directoryId !== undefined) {
        return this.options.repositoryGroupIdForDirectory(conversation.directoryId);
      }
    }
    return null;
  }

  handleRepositoryTreeArrow(input: Buffer): boolean {
    const repositoryId = this.selectedRepositoryGroupId();
    const action = repositoryTreeArrowAction(input, this.options.getLeftNavSelection(), repositoryId);
    if (repositoryId === null || action === null) {
      return false;
    }
    if (action === 'expand') {
      this.options.expandRepositoryGroup(repositoryId);
      this.options.selectLeftNavRepository(repositoryId);
      this.options.markDirty();
      return true;
    }
    if (action === 'collapse') {
      this.options.collapseRepositoryGroup(repositoryId);
      this.options.selectLeftNavRepository(repositoryId);
      this.options.markDirty();
      return true;
    }
    return false;
  }

  handleRepositoryFoldChords(input: Buffer): boolean {
    const reduced = reduceRepositoryFoldChordInput({
      input,
      leftNavSelection: this.options.getLeftNavSelection(),
      nowMs: this.options.nowMs(),
      prefixAtMs: this.options.getRepositoryToggleChordPrefixAtMs(),
      chordTimeoutMs: this.options.chordTimeoutMs,
      collapseAllChordPrefix: this.options.collapseAllChordPrefix,
    });
    this.options.setRepositoryToggleChordPrefixAtMs(reduced.nextPrefixAtMs);
    if (reduced.action === 'expand-all') {
      this.options.expandAllRepositoryGroups();
      this.options.markDirty();
      return true;
    }
    if (reduced.action === 'collapse-all') {
      this.options.collapseAllRepositoryGroups();
      this.options.markDirty();
      return true;
    }
    return reduced.consumed;
  }
}
