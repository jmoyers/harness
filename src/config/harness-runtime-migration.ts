import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_HARNESS_CONFIG,
  HARNESS_CONFIG_FILE_NAME,
  parseHarnessConfigText,
  resolveHarnessConfigDirectory,
} from './config-core.ts';
import {
  resolveHarnessWorkspaceDirectory,
  resolveLegacyHarnessDirectory,
} from './harness-paths.ts';

const LEGACY_SECRETS_FILE_NAME = 'secrets.env';
const MIGRATION_MARKER_FILE_NAME = '.legacy-layout-migration-v1';
const MIGRATION_CONFIG_BACKUP_FILE_NAME = `${HARNESS_CONFIG_FILE_NAME}.pre-migration.bak`;
const LEGACY_RUNTIME_EXCLUDE_NAMES = new Set([
  HARNESS_CONFIG_FILE_NAME,
  LEGACY_SECRETS_FILE_NAME,
  'workspaces',
]);

interface HarnessLegacyLayoutMigrationResult {
  readonly migrated: boolean;
  readonly migratedEntries: number;
  readonly configCopied: boolean;
  readonly configReplacedExisting: boolean;
  readonly configBackupPath: string | null;
  readonly secretsCopied: boolean;
  readonly skipped: boolean;
  readonly markerPath: string;
  readonly legacyRootRemoved: boolean;
}

interface ConfigCopyResult {
  readonly copied: boolean;
  readonly replacedExisting: boolean;
  readonly backupPath: string | null;
}

function copyFileIfMissing(sourcePath: string, targetPath: string): boolean {
  if (!existsSync(sourcePath) || existsSync(targetPath)) {
    return false;
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  return true;
}

function copyEntryIfMissing(sourcePath: string, targetPath: string): boolean {
  if (!existsSync(sourcePath)) {
    return false;
  }
  const targetExisted = existsSync(targetPath);
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
  return !targetExisted;
}

function configEqualsDefaultConfig(text: string): boolean {
  try {
    const parsed = parseHarnessConfigText(text);
    return JSON.stringify(parsed) === JSON.stringify(DEFAULT_HARNESS_CONFIG);
  } catch {
    return false;
  }
}

function copyConfigIfGlobalUninitialized(sourcePath: string, targetPath: string): ConfigCopyResult {
  if (!existsSync(sourcePath)) {
    return {
      copied: false,
      replacedExisting: false,
      backupPath: null,
    };
  }
  if (!existsSync(targetPath)) {
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
    return {
      copied: true,
      replacedExisting: false,
      backupPath: null,
    };
  }

  const targetText = readFileSync(targetPath, 'utf8');
  const targetUninitialized =
    targetText.trim().length === 0 || configEqualsDefaultConfig(targetText);
  if (!targetUninitialized) {
    return {
      copied: false,
      replacedExisting: false,
      backupPath: null,
    };
  }

  const backupPath = resolve(dirname(targetPath), MIGRATION_CONFIG_BACKUP_FILE_NAME);
  if (!existsSync(backupPath)) {
    copyFileSync(targetPath, backupPath);
  }
  copyFileSync(sourcePath, targetPath);
  return {
    copied: true,
    replacedExisting: true,
    backupPath,
  };
}

function writeMigrationMarker(markerPath: string): void {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${new Date().toISOString()}\n`, 'utf8');
}

function removeLegacyRootIfSafe(
  legacyRoot: string,
  configDirectory: string,
  workspaceDirectory: string,
): boolean {
  if (!existsSync(legacyRoot) || resolve(configDirectory) === legacyRoot) {
    return false;
  }

  const legacyEntries = readdirSync(legacyRoot, { withFileTypes: true }).map((entry) => entry.name);
  for (const entryName of legacyEntries) {
    if (entryName === HARNESS_CONFIG_FILE_NAME) {
      if (!existsSync(resolve(configDirectory, HARNESS_CONFIG_FILE_NAME))) {
        return false;
      }
      continue;
    }
    if (entryName === LEGACY_SECRETS_FILE_NAME) {
      if (!existsSync(resolve(configDirectory, LEGACY_SECRETS_FILE_NAME))) {
        return false;
      }
      continue;
    }
    if (entryName === 'workspaces') {
      continue;
    }
    if (!existsSync(resolve(workspaceDirectory, entryName))) {
      return false;
    }
  }

  rmSync(legacyRoot, { recursive: true, force: true });
  return !existsSync(legacyRoot);
}

export function migrateLegacyHarnessLayout(
  invocationDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): HarnessLegacyLayoutMigrationResult {
  const legacyRoot = resolveLegacyHarnessDirectory(invocationDirectory);
  const configDirectory = resolveHarnessConfigDirectory(invocationDirectory, env);
  const workspaceDirectory = resolveHarnessWorkspaceDirectory(invocationDirectory, env);
  const markerPath = resolve(workspaceDirectory, MIGRATION_MARKER_FILE_NAME);

  const configCopy = copyConfigIfGlobalUninitialized(
    resolve(legacyRoot, HARNESS_CONFIG_FILE_NAME),
    resolve(configDirectory, HARNESS_CONFIG_FILE_NAME),
  );
  const secretsCopied = copyFileIfMissing(
    resolve(legacyRoot, LEGACY_SECRETS_FILE_NAME),
    resolve(configDirectory, LEGACY_SECRETS_FILE_NAME),
  );
  const withCleanupResult = (
    result: Omit<HarnessLegacyLayoutMigrationResult, 'legacyRootRemoved'>,
  ): HarnessLegacyLayoutMigrationResult => ({
    ...result,
    legacyRootRemoved: removeLegacyRootIfSafe(legacyRoot, configDirectory, workspaceDirectory),
  });

  if (resolve(configDirectory) === legacyRoot) {
    return withCleanupResult({
      migrated: configCopy.copied || secretsCopied,
      migratedEntries: 0,
      configCopied: configCopy.copied,
      configReplacedExisting: configCopy.replacedExisting,
      configBackupPath: configCopy.backupPath,
      secretsCopied,
      skipped: true,
      markerPath,
    });
  }

  if (!existsSync(legacyRoot)) {
    return withCleanupResult({
      migrated: configCopy.copied || secretsCopied,
      migratedEntries: 0,
      configCopied: configCopy.copied,
      configReplacedExisting: configCopy.replacedExisting,
      configBackupPath: configCopy.backupPath,
      secretsCopied,
      skipped: true,
      markerPath,
    });
  }

  if (existsSync(markerPath)) {
    return withCleanupResult({
      migrated: configCopy.copied || secretsCopied,
      migratedEntries: 0,
      configCopied: configCopy.copied,
      configReplacedExisting: configCopy.replacedExisting,
      configBackupPath: configCopy.backupPath,
      secretsCopied,
      skipped: true,
      markerPath,
    });
  }

  const legacyEntries = readdirSync(legacyRoot, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((name) => !LEGACY_RUNTIME_EXCLUDE_NAMES.has(name));

  let migratedEntries = 0;
  for (const entryName of legacyEntries) {
    const sourcePath = resolve(legacyRoot, entryName);
    const targetPath = resolve(workspaceDirectory, entryName);
    if (copyEntryIfMissing(sourcePath, targetPath)) {
      migratedEntries += 1;
    }
  }

  if (legacyEntries.length > 0) {
    writeMigrationMarker(markerPath);
  }

  return withCleanupResult({
    migrated: configCopy.copied || secretsCopied || migratedEntries > 0,
    migratedEntries,
    configCopied: configCopy.copied,
    configReplacedExisting: configCopy.replacedExisting,
    configBackupPath: configCopy.backupPath,
    secretsCopied,
    skipped: false,
    markerPath,
  });
}
