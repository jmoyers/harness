export function parseGitBranchFromStatusHeader(header: string | null): string {
  if (header === null) {
    return '(detached)';
  }
  const raw = header.trim();
  if (raw.length === 0) {
    return '(detached)';
  }
  if (raw.startsWith('No commits yet on')) {
    const branch = raw.slice('No commits yet on'.length).trim();
    return branch.length > 0 ? branch : '(detached)';
  }
  const [headPart = ''] = raw.split('...');
  const head = headPart.trim();
  if (head.length === 0 || head === 'HEAD' || head.startsWith('HEAD ')) {
    return '(detached)';
  }
  return head;
}

export function parseGitShortstatCounts(output: string): { additions: number; deletions: number } {
  const additionsMatch = output.match(/(\d+)\s+insertions?\(\+\)/);
  const deletionsMatch = output.match(/(\d+)\s+deletions?\(-\)/);
  return {
    additions: additionsMatch === null ? 0 : Number.parseInt(additionsMatch[1]!, 10),
    deletions: deletionsMatch === null ? 0 : Number.parseInt(deletionsMatch[1]!, 10),
  };
}

export function normalizeGitHubRemoteUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalizePath = (rawPath: string): string | null => {
    let path = rawPath.trim().replace(/^\/+/u, '').replace(/\/+$/u, '');
    if (path.length === 0) {
      return null;
    }
    if (path.endsWith('.git')) {
      path = path.slice(0, -4);
    }
    const [owner = '', repository = ''] = path.split('/');
    if (owner.length === 0 || repository.length === 0) {
      return null;
    }
    return `https://github.com/${owner.toLowerCase()}/${repository.toLowerCase()}`;
  };

  const scpMatch = trimmed.match(/^git@github\.com:(.+)$/iu);
  if (scpMatch !== null) {
    return normalizePath(scpMatch[1]!);
  }

  let candidate = trimmed;
  if (candidate.startsWith('ssh://')) {
    candidate = `https://${candidate.slice('ssh://'.length)}`;
  } else if (candidate.startsWith('git://')) {
    candidate = `https://${candidate.slice('git://'.length)}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== 'github.com') {
    return null;
  }
  return normalizePath(parsed.pathname);
}

export function repositoryNameFromGitHubRemoteUrl(remoteUrl: string): string {
  const normalized = normalizeGitHubRemoteUrl(remoteUrl);
  if (normalized === null) {
    return remoteUrl;
  }
  const parts = normalized.split('/');
  const name = parts[parts.length - 1]!;
  return name;
}

function normalizeDefaultBranchForActions(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveGitHubDefaultBranchForActions(input: {
  repositoryDefaultBranch: string | null;
  snapshotDefaultBranch: string | null;
}): string | null {
  const repositoryDefaultBranch = normalizeDefaultBranchForActions(input.repositoryDefaultBranch);
  if (repositoryDefaultBranch !== null) {
    return repositoryDefaultBranch;
  }
  return normalizeDefaultBranchForActions(input.snapshotDefaultBranch);
}

export function shouldShowGitHubPrActions(input: {
  trackedBranch: string | null;
  defaultBranch: string | null;
}): boolean {
  const trackedBranch = input.trackedBranch?.trim() ?? '';
  if (trackedBranch.length === 0 || trackedBranch === '(detached)') {
    return false;
  }
  const normalizedTrackedBranch = trackedBranch.toLowerCase();
  const normalizedDefaultBranch = input.defaultBranch?.trim().toLowerCase() ?? '';
  if (normalizedDefaultBranch.length > 0) {
    return normalizedTrackedBranch !== normalizedDefaultBranch;
  }
  return normalizedTrackedBranch !== 'main';
}

function normalizeTrackedBranchForActions(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (
    trimmed.length === 0 ||
    trimmed === '(detached)' ||
    trimmed === '(loading)' ||
    trimmed === 'HEAD'
  ) {
    return null;
  }
  return trimmed;
}

export function resolveGitHubTrackedBranchForActions(input: {
  projectTrackedBranch: string | null;
  currentBranch: string | null;
}): string | null {
  const trackedBranch = normalizeTrackedBranchForActions(input.projectTrackedBranch);
  if (trackedBranch !== null) {
    return trackedBranch;
  }
  return normalizeTrackedBranchForActions(input.currentBranch);
}

export function parseCommitCount(output: string): number | null {
  const trimmed = output.trim();
  if (trimmed.length === 0 || !/^\d+$/u.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

export function parseLastCommitLine(output: string): {
  lastCommitAt: string | null;
  shortCommitHash: string | null;
} {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return {
      lastCommitAt: null,
      shortCommitHash: null,
    };
  }
  const [hashPart = '', tsPart = ''] = trimmed.split('\t');
  const hash = hashPart.trim();
  const timestamp = tsPart.trim();
  return {
    lastCommitAt: timestamp.length > 0 ? timestamp : null,
    shortCommitHash: hash,
  };
}
