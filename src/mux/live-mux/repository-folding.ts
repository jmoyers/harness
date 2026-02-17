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
