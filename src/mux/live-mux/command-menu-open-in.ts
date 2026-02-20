import {
  HARNESS_MUX_OPEN_IN_TARGET_IDS,
  type HarnessMuxOpenInTargetId,
  type HarnessMuxOpenInTargetOverrideConfig,
} from '../../config/config-core.ts';
import type { RegisteredCommandMenuAction } from './command-menu.ts';

interface OpenInTargetDefaults {
  readonly title: string;
  readonly aliases: readonly string[];
  readonly keywords: readonly string[];
  readonly macAppName: string | null;
  readonly launchCommand: string | null;
}

const OPEN_IN_TARGET_DEFAULTS: Readonly<Record<HarnessMuxOpenInTargetId, OpenInTargetDefaults>> = {
  iterm2: {
    title: 'iTerm2',
    aliases: ['iterm2', 'terminal'],
    keywords: ['iterm', 'terminal'],
    macAppName: 'iTerm',
    launchCommand: 'iterm2',
  },
  ghostty: {
    title: 'Ghostty',
    aliases: ['ghostty', 'terminal'],
    keywords: ['ghostty', 'terminal'],
    macAppName: 'Ghostty',
    launchCommand: 'ghostty',
  },
  zed: {
    title: 'Zed',
    aliases: ['zed', 'editor'],
    keywords: ['zed', 'editor'],
    macAppName: 'Zed',
    launchCommand: 'zed',
  },
  cursor: {
    title: 'Cursor',
    aliases: ['cursor', 'cursor ide', 'editor'],
    keywords: ['cursor', 'editor', 'ide'],
    macAppName: 'Cursor',
    launchCommand: 'cursor',
  },
  vscode: {
    title: 'VSCode',
    aliases: ['vscode', 'vs code', 'code', 'editor'],
    keywords: ['vscode', 'editor', 'ide'],
    macAppName: 'Visual Studio Code',
    launchCommand: 'code',
  },
  warp: {
    title: 'Warp',
    aliases: ['warp', 'terminal'],
    keywords: ['warp', 'terminal'],
    macAppName: 'Warp',
    launchCommand: 'warp',
  },
  finder: {
    title: 'Finder',
    aliases: ['finder', 'file manager'],
    keywords: ['finder', 'files'],
    macAppName: 'Finder',
    launchCommand: null,
  },
};

function normalizedCommandPart(part: string): string {
  return part.trim();
}

function normalizeLaunchCommandOverride(
  value: readonly string[] | undefined,
): readonly string[] | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.map(normalizedCommandPart).filter((part) => part.length > 0);
  return normalized.length > 0 ? normalized : [];
}

function defaultLaunchCommand(
  platform: NodeJS.Platform,
  defaults: OpenInTargetDefaults,
  appName: string | null,
): readonly string[] {
  if (platform === 'darwin' && appName !== null) {
    return ['open', '-a', appName, '{path}'];
  }
  if (defaults.launchCommand === null) {
    return [];
  }
  return [defaults.launchCommand, '{path}'];
}

function defaultDetectCommand(
  platform: NodeJS.Platform,
  defaults: OpenInTargetDefaults,
): string | null {
  if (platform === 'darwin') {
    return null;
  }
  return defaults.launchCommand;
}

function isAutoDetectedTargetAvailable(options: {
  platform: NodeJS.Platform;
  appName: string | null;
  detectCommand: string | null;
  isMacApplicationInstalled: (appName: string) => boolean;
  isCommandAvailable: (command: string) => boolean;
}): boolean {
  if (options.platform === 'darwin' && options.appName !== null) {
    return options.isMacApplicationInstalled(options.appName);
  }
  if (options.detectCommand === null) {
    return false;
  }
  return options.isCommandAvailable(options.detectCommand);
}

export interface ResolvedCommandMenuOpenInTarget {
  readonly id: HarnessMuxOpenInTargetId;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly keywords: readonly string[];
  readonly launchCommand: readonly string[];
}

export function resolveCommandMenuOpenInTargets(options: {
  platform: NodeJS.Platform;
  overrides: Readonly<
    Partial<Record<HarnessMuxOpenInTargetId, HarnessMuxOpenInTargetOverrideConfig>>
  >;
  isCommandAvailable: (command: string) => boolean;
  isMacApplicationInstalled: (appName: string) => boolean;
}): readonly ResolvedCommandMenuOpenInTarget[] {
  const resolved: ResolvedCommandMenuOpenInTarget[] = [];
  for (const targetId of HARNESS_MUX_OPEN_IN_TARGET_IDS) {
    const defaults = OPEN_IN_TARGET_DEFAULTS[targetId];
    const override = options.overrides[targetId];
    if (override?.enabled === false) {
      continue;
    }
    const appName =
      override?.appName === undefined || override.appName.trim().length === 0
        ? defaults.macAppName
        : override.appName.trim();
    const detectCommand =
      override?.detectCommand === undefined
        ? defaultDetectCommand(options.platform, defaults)
        : override.detectCommand === null || override.detectCommand.trim().length === 0
          ? null
          : override.detectCommand.trim();
    const overrideLaunchCommand = normalizeLaunchCommandOverride(override?.launchCommand);
    const launchCommand =
      overrideLaunchCommand === null
        ? defaultLaunchCommand(options.platform, defaults, appName)
        : overrideLaunchCommand;
    if (launchCommand.length === 0) {
      continue;
    }
    const available =
      override?.enabled === true
        ? true
        : isAutoDetectedTargetAvailable({
            platform: options.platform,
            appName,
            detectCommand,
            isCommandAvailable: options.isCommandAvailable,
            isMacApplicationInstalled: options.isMacApplicationInstalled,
          });
    if (!available) {
      continue;
    }
    resolved.push({
      id: targetId,
      title: defaults.title,
      aliases: defaults.aliases,
      keywords: defaults.keywords,
      launchCommand,
    });
  }
  return resolved;
}

export function resolveCommandMenuOpenInCommand(
  target: ResolvedCommandMenuOpenInTarget,
  directoryPath: string,
): { command: string; args: readonly string[] } | null {
  const command = target.launchCommand[0]?.trim() ?? '';
  if (command.length === 0) {
    return null;
  }
  let pathInjected = false;
  const args = target.launchCommand.slice(1).map((part) => {
    if (part === '{path}') {
      pathInjected = true;
      return directoryPath;
    }
    return part;
  });
  if (!pathInjected) {
    args.push(directoryPath);
  }
  return {
    command,
    args,
  };
}

interface CommandMenuOpenInProviderDirectory {
  readonly directoryId: string;
  readonly path: string;
}

interface CommandMenuOpenInProviderOptions<TContext> {
  readonly registerProvider: (
    providerId: string,
    provider: (context: TContext) => readonly RegisteredCommandMenuAction<TContext>[],
  ) => () => void;
  readonly providerId?: string;
  readonly resolveDirectories: (context: TContext) => readonly CommandMenuOpenInProviderDirectory[];
  readonly resolveTargets: () => readonly ResolvedCommandMenuOpenInTarget[];
  readonly projectPathTail: (directoryPath: string) => string;
  readonly openInTarget: (
    target: ResolvedCommandMenuOpenInTarget,
    directoryPath: string,
  ) => boolean;
  readonly copyPath: (directoryPath: string) => boolean;
  readonly setNotice: (message: string) => void;
}

export function registerCommandMenuOpenInProvider<TContext>(
  options: CommandMenuOpenInProviderOptions<TContext>,
): () => void {
  const providerId = options.providerId ?? 'project.open-in';
  return options.registerProvider(providerId, (context) => {
    const actions: RegisteredCommandMenuAction<TContext>[] = [];
    const targets = options.resolveTargets();
    for (const directory of options.resolveDirectories(context)) {
      const projectLabel = options.projectPathTail(directory.path);
      for (const target of targets) {
        actions.push({
          id: `project.open-in.${target.id}.${directory.directoryId}`,
          title: `Open in ${target.title}: ${projectLabel}`,
          aliases: [
            ...target.aliases,
            'open project in',
            `open in ${target.title.toLowerCase()}`,
            directory.path,
            projectLabel,
          ],
          keywords: ['open', 'project', 'directory', 'path', ...target.keywords],
          detail: directory.path,
          run: () => {
            const opened = options.openInTarget(target, directory.path);
            options.setNotice(
              opened
                ? `opened ${projectLabel} in ${target.title}`
                : `failed to open ${projectLabel} in ${target.title}`,
            );
          },
        });
      }
      actions.push({
        id: `project.copy-path.${directory.directoryId}`,
        title: `Copy Path: ${projectLabel}`,
        aliases: ['copy path', 'copy project path', directory.path, projectLabel],
        keywords: ['copy', 'path', 'clipboard', 'project', 'directory'],
        detail: directory.path,
        run: () => {
          const copied = options.copyPath(directory.path);
          options.setNotice(copied ? `copied path: ${directory.path}` : 'failed to copy path');
        },
      });
    }
    return actions;
  });
}
