import type { buildWorkspaceRailViewRows } from '../workspace-rail-model.ts';

export type LeftNavSelection =
  | {
      readonly kind: 'home';
    }
  | {
      readonly kind: 'nim';
    }
  | {
      readonly kind: 'tasks';
    }
  | {
      readonly kind: 'repository';
      readonly repositoryId: string;
    }
  | {
      readonly kind: 'project';
      readonly directoryId: string;
    }
  | {
      readonly kind: 'conversation';
      readonly sessionId: string;
    };

export function leftNavTargetKey(target: LeftNavSelection): string {
  if (target.kind === 'home') {
    return 'home';
  }
  if (target.kind === 'nim') {
    return 'nim';
  }
  if (target.kind === 'tasks') {
    return 'tasks';
  }
  if (target.kind === 'repository') {
    return `repository:${target.repositoryId}`;
  }
  if (target.kind === 'project') {
    return `directory:${target.directoryId}`;
  }
  return `conversation:${target.sessionId}`;
}

function leftNavTargetFromRow(
  rows: ReturnType<typeof buildWorkspaceRailViewRows>,
  rowIndex: number,
): LeftNavSelection | null {
  const row = rows[rowIndex];
  if (row === undefined) {
    return null;
  }
  if (row.railAction === 'home.open') {
    return {
      kind: 'home',
    };
  }
  if (row.railAction === 'nim.open') {
    return {
      kind: 'nim',
    };
  }
  if (row.railAction === 'tasks.open') {
    return {
      kind: 'tasks',
    };
  }
  if (row.kind === 'repository-header' && row.repositoryId !== null) {
    return {
      kind: 'repository',
      repositoryId: row.repositoryId,
    };
  }
  if (row.kind === 'dir-header' && row.directoryKey !== null) {
    return {
      kind: 'project',
      directoryId: row.directoryKey,
    };
  }
  if (row.kind === 'conversation-title' && row.conversationSessionId !== null) {
    return {
      kind: 'conversation',
      sessionId: row.conversationSessionId,
    };
  }
  return null;
}

export function visibleLeftNavTargets(
  rows: ReturnType<typeof buildWorkspaceRailViewRows>,
): readonly LeftNavSelection[] {
  const entries: LeftNavSelection[] = [];
  const seen = new Set<string>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const target = leftNavTargetFromRow(rows, rowIndex);
    if (target === null) {
      continue;
    }
    const key = leftNavTargetKey(target);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push(target);
  }
  return entries;
}
