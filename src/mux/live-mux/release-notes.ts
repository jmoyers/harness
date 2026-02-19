import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHarnessWorkspaceDirectory } from '../../config/harness-paths.ts';

const RELEASE_NOTES_STATE_FILE_NAME = 'release-notes.json';
const DEFAULT_RELEASE_NOTES_URL = 'https://github.com/jmoyers/harness/releases';
const DEFAULT_RELEASE_NOTES_API_URL = 'https://api.github.com/repos/jmoyers/harness/releases';
const PACKAGE_JSON_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../package.json');

export const RELEASE_NOTES_STATE_VERSION = 1;

interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (number | string)[] | null;
}

interface NormalizedGitHubRelease {
  readonly tag: string;
  readonly name: string;
  readonly url: string;
  readonly body: string;
}

export interface ReleaseNotesState {
  readonly version: typeof RELEASE_NOTES_STATE_VERSION;
  readonly neverShow: boolean;
  readonly dismissedLatestTag: string | null;
}

export interface ReleaseNotesPromptRelease {
  readonly tag: string;
  readonly name: string;
  readonly url: string;
  readonly previewLines: readonly string[];
  readonly previewTruncated: boolean;
}

export interface ReleaseNotesPrompt {
  readonly currentVersion: string;
  readonly latestTag: string;
  readonly releases: readonly ReleaseNotesPromptRelease[];
  readonly releasesPageUrl: string;
}

interface ResolveReleaseNotesPromptOptions {
  readonly currentVersion: string;
  readonly releases: readonly NormalizedGitHubRelease[];
  readonly previewLineCount: number;
  readonly maxReleases: number;
}

interface FetchReleaseNotesPromptOptions {
  readonly currentVersion: string;
  readonly previewLineCount: number;
  readonly maxReleases: number;
  readonly fetchImpl?: typeof fetch;
  readonly apiUrl?: string;
  readonly releasesPageUrl?: string;
}

function parseSemverTag(value: string): ParsedSemver | null {
  const trimmed = value.trim();
  const normalized = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u.exec(normalized);
  if (match === null) {
    return null;
  }
  const major = Number.parseInt(match[1]!, 10);
  const minor = Number.parseInt(match[2]!, 10);
  const patch = Number.parseInt(match[3]!, 10);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return null;
  }
  const prereleaseRaw = match[4];
  if (prereleaseRaw === undefined) {
    return {
      major,
      minor,
      patch,
      prerelease: null,
    };
  }
  const prerelease = prereleaseRaw
    .split('.')
    .map((part) => {
      if (/^\d+$/u.test(part)) {
        return Number.parseInt(part, 10);
      }
      return part;
    })
    .filter((part) => (typeof part === 'number' ? Number.isFinite(part) : part.length > 0));
  return {
    major,
    minor,
    patch,
    prerelease: prerelease.length > 0 ? prerelease : null,
  };
}

function comparePrerelease(
  left: readonly (number | string)[] | null,
  right: readonly (number | string)[] | null,
): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftEntry = left[index];
    const rightEntry = right[index];
    if (leftEntry === undefined) {
      return -1;
    }
    if (rightEntry === undefined) {
      return 1;
    }
    if (leftEntry === rightEntry) {
      continue;
    }
    const leftNumber = typeof leftEntry === 'number';
    const rightNumber = typeof rightEntry === 'number';
    if (leftNumber && rightNumber) {
      return leftEntry < rightEntry ? -1 : 1;
    }
    if (leftNumber && !rightNumber) {
      return -1;
    }
    if (!leftNumber && rightNumber) {
      return 1;
    }
    return String(leftEntry).localeCompare(String(rightEntry));
  }
  return 0;
}

export function compareSemverTags(leftTag: string, rightTag: string): number {
  const left = parseSemverTag(leftTag);
  const right = parseSemverTag(rightTag);
  if (left === null || right === null) {
    return leftTag.localeCompare(rightTag);
  }
  if (left.major !== right.major) {
    return left.major < right.major ? -1 : 1;
  }
  if (left.minor !== right.minor) {
    return left.minor < right.minor ? -1 : 1;
  }
  if (left.patch !== right.patch) {
    return left.patch < right.patch ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function previewLinesForBody(body: string, maxLines: number): {
  readonly lines: readonly string[];
  readonly truncated: boolean;
} {
  const safeMaxLines = Math.max(1, Math.floor(maxLines));
  const normalizedLines = body
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return {
    lines: normalizedLines.slice(0, safeMaxLines),
    truncated: normalizedLines.length > safeMaxLines,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseGitHubReleaseList(raw: unknown): readonly NormalizedGitHubRelease[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const parsed: NormalizedGitHubRelease[] = [];
  const seenTags = new Set<string>();
  for (const item of raw) {
    const record = asRecord(item);
    if (record === null) {
      continue;
    }
    if (record['draft'] === true || record['prerelease'] === true) {
      continue;
    }
    const tagName = record['tag_name'];
    const htmlUrl = record['html_url'];
    if (typeof tagName !== 'string' || typeof htmlUrl !== 'string') {
      continue;
    }
    const tag = tagName.trim();
    const url = htmlUrl.trim();
    if (tag.length === 0 || url.length === 0 || seenTags.has(tag)) {
      continue;
    }
    seenTags.add(tag);
    parsed.push({
      tag,
      name: typeof record['name'] === 'string' ? record['name'].trim() : '',
      url,
      body: typeof record['body'] === 'string' ? record['body'] : '',
    });
  }
  parsed.sort((left, right) => compareSemverTags(right.tag, left.tag));
  return parsed;
}

export function resolveReleaseNotesPrompt(
  options: ResolveReleaseNotesPromptOptions,
): ReleaseNotesPrompt | null {
  const sorted = [...options.releases].sort((left, right) => compareSemverTags(right.tag, left.tag));
  if (sorted.length === 0) {
    return null;
  }
  const newer = sorted.filter(
    (release) => compareSemverTags(release.tag, options.currentVersion) > 0,
  );
  if (newer.length === 0) {
    return null;
  }
  const safeMaxReleases = Math.max(1, Math.floor(options.maxReleases));
  const releases = newer.slice(0, safeMaxReleases).map((release) => {
    const preview = previewLinesForBody(release.body, options.previewLineCount);
    return {
      tag: release.tag,
      name: release.name,
      url: release.url,
      previewLines: preview.lines,
      previewTruncated: preview.truncated,
    };
  });
  return {
    currentVersion: options.currentVersion,
    latestTag: newer[0]!.tag,
    releases,
    releasesPageUrl: DEFAULT_RELEASE_NOTES_URL,
  };
}

export async function fetchReleaseNotesPrompt(
  options: FetchReleaseNotesPromptOptions,
): Promise<ReleaseNotesPrompt | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiUrl = options.apiUrl ?? DEFAULT_RELEASE_NOTES_API_URL;
  const releasesPageUrl = options.releasesPageUrl ?? DEFAULT_RELEASE_NOTES_URL;
  try {
    const response = await fetchImpl(`${apiUrl}?per_page=20`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `harness/${options.currentVersion}`,
      },
    });
    if (!response.ok) {
      return null;
    }
    const raw = (await response.json()) as unknown;
    const releases = parseGitHubReleaseList(raw);
    const prompt = resolveReleaseNotesPrompt({
      currentVersion: options.currentVersion,
      releases,
      previewLineCount: options.previewLineCount,
      maxReleases: options.maxReleases,
    });
    if (prompt === null) {
      return null;
    }
    return {
      ...prompt,
      releasesPageUrl,
    };
  } catch {
    return null;
  }
}

function defaultReleaseNotesState(): ReleaseNotesState {
  return {
    version: RELEASE_NOTES_STATE_VERSION,
    neverShow: false,
    dismissedLatestTag: null,
  };
}

export function parseReleaseNotesState(raw: unknown): ReleaseNotesState | null {
  const record = asRecord(raw);
  if (record === null) {
    return null;
  }
  if (record['version'] !== RELEASE_NOTES_STATE_VERSION) {
    return null;
  }
  const neverShow = record['neverShow'];
  const dismissedLatestTag = record['dismissedLatestTag'];
  if (typeof neverShow !== 'boolean') {
    return null;
  }
  if (dismissedLatestTag !== null && typeof dismissedLatestTag !== 'string') {
    return null;
  }
  return {
    version: RELEASE_NOTES_STATE_VERSION,
    neverShow,
    dismissedLatestTag,
  };
}

export function resolveReleaseNotesStatePath(
  invocationDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(
    resolveHarnessWorkspaceDirectory(invocationDirectory, env),
    RELEASE_NOTES_STATE_FILE_NAME,
  );
}

export function readReleaseNotesState(statePath: string): ReleaseNotesState {
  if (!existsSync(statePath)) {
    return defaultReleaseNotesState();
  }
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as unknown;
    return parseReleaseNotesState(raw) ?? defaultReleaseNotesState();
  } catch {
    return defaultReleaseNotesState();
  }
}

export function writeReleaseNotesState(statePath: string, state: ReleaseNotesState): void {
  const tempPath = `${statePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(tempPath, `${JSON.stringify(state)}\n`, 'utf8');
    renameSync(tempPath, statePath);
  } catch (error: unknown) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }
}

export function readInstalledHarnessVersion(packageJsonPath: string = PACKAGE_JSON_PATH): string {
  try {
    const raw = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as unknown;
    const version = asRecord(raw)?.['version'];
    if (typeof version === 'string' && version.trim().length > 0) {
      return version.trim();
    }
  } catch {
    // Fall back to a safe value that still allows release comparisons.
  }
  return '0.0.0';
}
