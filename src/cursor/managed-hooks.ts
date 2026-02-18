import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

export const CURSOR_HOOK_NOTIFY_FILE_ENV = 'HARNESS_CURSOR_NOTIFY_FILE';
export const CURSOR_HOOK_SESSION_ID_ENV = 'HARNESS_CURSOR_SESSION_ID';
export const CURSOR_MANAGED_HOOK_ID_PREFIX = 'harness-cursor-hook-v1';

const DEFAULT_CURSOR_MANAGED_HOOK_EVENTS = [
  'beforeSubmitPrompt',
  'beforeShellExecution',
  'afterShellExecution',
  'beforeMCPExecution',
  'afterMCPExecution',
  'stop',
] as const;

const LEGACY_CURSOR_HOOK_EVENT_MIGRATIONS = [
  ['beforeMCPTool', 'beforeMCPExecution'],
  ['afterMCPTool', 'afterMCPExecution'],
] as const;

interface CursorHookEntryRecord {
  readonly [key: string]: unknown;
}

interface CursorHooksRootRecord {
  readonly [key: string]: unknown;
}

interface ParsedCursorHooksFile {
  readonly root: CursorHooksRootRecord;
  readonly hooksByEvent: Readonly<Record<string, readonly CursorHookEntryRecord[]>>;
}

interface CursorManagedHooksResult {
  readonly filePath: string;
  readonly changed: boolean;
  readonly removedCount: number;
  readonly addedCount: number;
}

interface EnsureManagedCursorHooksOptions {
  readonly hooksFilePath?: string;
  readonly relayCommand: string;
  readonly managedEvents?: readonly string[];
}

interface UninstallManagedCursorHooksOptions {
  readonly hooksFilePath?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function shellEscape(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function managedHookIdForEvent(eventName: string): string {
  return `${CURSOR_MANAGED_HOOK_ID_PREFIX}:${eventName}`;
}

function managedHookCommandForEvent(relayCommand: string, eventName: string): string {
  return `${relayCommand} --managed-hook-id ${shellEscape(managedHookIdForEvent(eventName))}`;
}

function isManagedHookCommand(command: string): boolean {
  return command.includes(`--managed-hook-id '${CURSOR_MANAGED_HOOK_ID_PREFIX}:`);
}

function cloneHooksByEvent(
  hooksByEvent: Readonly<Record<string, readonly CursorHookEntryRecord[]>>,
): Record<string, CursorHookEntryRecord[]> {
  const next: Record<string, CursorHookEntryRecord[]> = {};
  for (const [eventName, entries] of Object.entries(hooksByEvent)) {
    next[eventName] = entries.map((entry) => ({ ...entry }));
  }
  return next;
}

function parseCursorHooksFile(filePath: string): ParsedCursorHooksFile {
  if (!existsSync(filePath)) {
    return {
      root: {
        version: 1,
        hooks: {},
      },
      hooksByEvent: {},
    };
  }
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  const root = asRecord(parsed);
  if (root === null) {
    throw new Error(`cursor hooks file must contain a JSON object: ${filePath}`);
  }
  const rawHooks = root['hooks'];
  if (rawHooks === undefined) {
    return {
      root,
      hooksByEvent: {},
    };
  }
  const hooksRecord = asRecord(rawHooks);
  if (hooksRecord === null) {
    throw new Error(`cursor hooks file has invalid hooks shape: ${filePath}`);
  }
  const hooksByEvent: Record<string, readonly CursorHookEntryRecord[]> = {};
  for (const [eventName, rawEntries] of Object.entries(hooksRecord)) {
    if (!Array.isArray(rawEntries)) {
      throw new Error(`cursor hooks for event "${eventName}" must be an array`);
    }
    const entries: CursorHookEntryRecord[] = [];
    for (const rawEntry of rawEntries) {
      const entry = asRecord(rawEntry);
      if (entry === null) {
        throw new Error(`cursor hooks entry for event "${eventName}" must be an object`);
      }
      entries.push({ ...entry });
    }
    hooksByEvent[eventName] = entries;
  }
  return {
    root,
    hooksByEvent,
  };
}

function serializeCursorHooksFile(
  root: CursorHooksRootRecord,
  hooksByEvent: Readonly<Record<string, readonly CursorHookEntryRecord[]>>,
): string {
  const normalizedVersion = typeof root['version'] === 'number' ? root['version'] : 1;
  return `${JSON.stringify(
    {
      ...root,
      version: normalizedVersion,
      hooks: hooksByEvent,
    },
    null,
    2,
  )}\n`;
}

function removeManagedHooks(hooksByEvent: Record<string, CursorHookEntryRecord[]>): number {
  let removedCount = 0;
  for (const [eventName, entries] of Object.entries(hooksByEvent)) {
    const nextEntries = entries.filter((entry) => {
      const command = readNonEmptyString(entry['command']);
      if (command === null) {
        return true;
      }
      if (!isManagedHookCommand(command)) {
        return true;
      }
      removedCount += 1;
      return false;
    });
    hooksByEvent[eventName] = nextEntries;
  }
  return removedCount;
}

function migrateLegacyHookEvents(hooksByEvent: Record<string, CursorHookEntryRecord[]>): void {
  for (const [legacyEventName, nextEventName] of LEGACY_CURSOR_HOOK_EVENT_MIGRATIONS) {
    const legacyEntries = hooksByEvent[legacyEventName];
    if (legacyEntries === undefined) {
      continue;
    }
    const nextEntries = hooksByEvent[nextEventName] ?? [];
    nextEntries.push(...legacyEntries);
    hooksByEvent[nextEventName] = nextEntries;
    delete hooksByEvent[legacyEventName];
  }
}

function resolveManagedEvents(events: readonly string[] | undefined): readonly string[] {
  if (events === undefined) {
    return DEFAULT_CURSOR_MANAGED_HOOK_EVENTS;
  }
  const normalized = events
    .map((eventName) => eventName.trim())
    .filter((eventName) => eventName.length > 0);
  if (normalized.length === 0) {
    return DEFAULT_CURSOR_MANAGED_HOOK_EVENTS;
  }
  return [...new Set(normalized)];
}

function resolveCursorHooksFilePath(filePath?: string): string {
  const trimmed = filePath?.trim() ?? '';
  if (trimmed.length > 0) return resolve(trimmed);
  return resolve(homedir(), '.cursor', 'hooks.json');
}

export function buildCursorManagedHookRelayCommand(relayScriptPath: string): string {
  return `/usr/bin/env ${shellEscape(process.execPath)} ${shellEscape(resolve(relayScriptPath))}`;
}

export function buildCursorHookRelayEnvironment(
  sessionId: string,
  notifyFilePath: string,
): Record<string, string> {
  return {
    [CURSOR_HOOK_NOTIFY_FILE_ENV]: notifyFilePath,
    [CURSOR_HOOK_SESSION_ID_ENV]: sessionId,
  };
}

export function ensureManagedCursorHooksInstalled(
  options: EnsureManagedCursorHooksOptions,
): CursorManagedHooksResult {
  const filePath = resolveCursorHooksFilePath(options.hooksFilePath);
  const parsed = parseCursorHooksFile(filePath);
  const nextHooksByEvent = cloneHooksByEvent(parsed.hooksByEvent);
  const removedCount = removeManagedHooks(nextHooksByEvent);
  migrateLegacyHookEvents(nextHooksByEvent);
  const managedEvents = resolveManagedEvents(options.managedEvents);
  let addedCount = 0;
  for (const eventName of managedEvents) {
    const nextEntries = nextHooksByEvent[eventName] ?? [];
    const command = managedHookCommandForEvent(options.relayCommand, eventName);
    if (!nextEntries.some((entry) => readNonEmptyString(entry['command']) === command)) {
      nextEntries.push({
        command,
      });
      addedCount += 1;
    }
    nextHooksByEvent[eventName] = nextEntries;
  }

  const beforeText = serializeCursorHooksFile(parsed.root, parsed.hooksByEvent);
  const afterText = serializeCursorHooksFile(parsed.root, nextHooksByEvent);
  const changed = beforeText !== afterText;
  if (changed) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, afterText, 'utf8');
  }
  return {
    filePath,
    changed,
    removedCount,
    addedCount,
  };
}

export function uninstallManagedCursorHooks(
  options: UninstallManagedCursorHooksOptions = {},
): CursorManagedHooksResult {
  const filePath = resolveCursorHooksFilePath(options.hooksFilePath);
  const parsed = parseCursorHooksFile(filePath);
  const nextHooksByEvent = cloneHooksByEvent(parsed.hooksByEvent);
  const removedCount = removeManagedHooks(nextHooksByEvent);
  const beforeText = serializeCursorHooksFile(parsed.root, parsed.hooksByEvent);
  const afterText = serializeCursorHooksFile(parsed.root, nextHooksByEvent);
  const changed = beforeText !== afterText;
  if (changed) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, afterText, 'utf8');
  }
  return {
    filePath,
    changed,
    removedCount,
    addedCount: 0,
  };
}
