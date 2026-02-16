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
    deletions: deletionsMatch === null ? 0 : Number.parseInt(deletionsMatch[1]!, 10)
  };
}

export function normalizeGitHubRemoteUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let candidate = trimmed;
  if (candidate.startsWith('git@')) {
    candidate = candidate.replace(':', '/').replace(/^git@/, 'https://');
  }
  if (candidate.startsWith('ssh://')) {
    candidate = candidate.replace(/^ssh:\/\//, 'https://');
  }
  if (candidate.startsWith('git://')) {
    candidate = candidate.replace(/^git:\/\//, 'https://');
  }
  if (candidate.endsWith('.git')) {
    candidate = candidate.slice(0, -4);
  }
  const normalized = candidate.toLowerCase();
  if (!normalized.startsWith('https://github.com/')) {
    return null;
  }
  const remainder = normalized.slice('https://github.com/'.length);
  if (remainder.length === 0 || !remainder.includes('/')) {
    return null;
  }
  return `https://github.com/${remainder}`;
}

export function repositoryNameFromGitHubRemoteUrl(remoteUrl: string): string {
  const normalized = normalizeGitHubRemoteUrl(remoteUrl);
  if (normalized === null) {
    return remoteUrl;
  }
  const parts = normalized.split('/');
  const name = parts[parts.length - 1];
  if (typeof name !== 'string' || name.length === 0) {
    return remoteUrl;
  }
  return name;
}

export function parseCommitCount(output: string): number | null {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
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
      shortCommitHash: null
    };
  }
  const [hashPart = '', tsPart = ''] = trimmed.split('\t');
  const hash = hashPart.trim();
  const timestamp = tsPart.trim();
  return {
    lastCommitAt: timestamp.length > 0 ? timestamp : null,
    shortCommitHash: hash
  };
}
