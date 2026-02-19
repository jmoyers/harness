import type { GitCommandRunner } from './git-snapshot.ts';

type CritiqueReviewAgent = 'claude' | 'opencode';

interface CritiqueReviewAgentAvailability {
  readonly claudeAvailable: boolean;
  readonly opencodeAvailable: boolean;
}

type CritiqueReviewCommandInput =
  | {
      readonly mode: 'staged';
      readonly agent: CritiqueReviewAgent | null;
    }
  | {
      readonly mode: 'base-branch';
      readonly baseBranch: string;
      readonly agent: CritiqueReviewAgent | null;
    };

function normalizeBranchName(value: string): string | null {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized === 'HEAD' || normalized === '(detached)') {
    return null;
  }
  return normalized;
}

export function parseRemoteHeadBranch(rawRemoteHead: string): string | null {
  const normalizedRemoteHead = normalizeBranchName(rawRemoteHead);
  if (normalizedRemoteHead === null) {
    return null;
  }
  const slashIndex = normalizedRemoteHead.indexOf('/');
  if (slashIndex < 0) {
    return normalizedRemoteHead;
  }
  return normalizeBranchName(normalizedRemoteHead.slice(slashIndex + 1));
}

export function resolveCritiqueReviewAgent(
  availability: CritiqueReviewAgentAvailability,
): CritiqueReviewAgent | null {
  if (availability.claudeAvailable) {
    return 'claude';
  }
  if (availability.opencodeAvailable) {
    return 'opencode';
  }
  return null;
}

export function buildCritiqueReviewCommand(input: CritiqueReviewCommandInput): string {
  const tokens = ['critique', 'review'];
  if (input.mode === 'staged') {
    tokens.push('--staged');
  } else {
    const normalizedBaseBranch = normalizeBranchName(input.baseBranch) ?? 'main';
    tokens.push(normalizedBaseBranch, 'HEAD');
  }
  if (input.agent !== null) {
    tokens.push('--agent', input.agent);
  }
  return tokens.join(' ');
}

export async function resolveCritiqueReviewBaseBranch(
  cwd: string,
  runCommand: GitCommandRunner,
): Promise<string> {
  const remoteHead = parseRemoteHeadBranch(
    await runCommand(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']),
  );
  if (remoteHead !== null) {
    return remoteHead;
  }

  for (const candidate of ['main', 'master']) {
    const localBranch = await runCommand(cwd, ['rev-parse', '--verify', '--quiet', candidate]);
    if (localBranch.length > 0) {
      return candidate;
    }
    const remoteBranch = await runCommand(cwd, [
      'rev-parse',
      '--verify',
      '--quiet',
      `origin/${candidate}`,
    ]);
    if (remoteBranch.length > 0) {
      return candidate;
    }
  }

  const currentBranch = normalizeBranchName(
    await runCommand(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
  );
  if (currentBranch !== null) {
    return currentBranch;
  }
  return 'main';
}
