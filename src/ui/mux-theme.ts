import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HarnessMuxThemeConfig } from '../config/config-core.ts';
import type { UiColor, UiStyle } from './surface.ts';
import type { UiModalTheme } from './kit.ts';
import { BUILTIN_MUX_THEME_PRESETS } from './mux-theme-presets.ts';

type OpenCodeThemeMode = 'dark' | 'light';

type OpenCodeColorValue =
  | string
  | {
      readonly dark: string;
      readonly light: string;
    };

interface OpenCodeThemeDocument {
  readonly $schema?: string;
  readonly defs?: Readonly<Record<string, OpenCodeColorValue>>;
  readonly theme: Readonly<Record<string, OpenCodeColorValue>>;
}

interface OpenCodeThemeInput {
  readonly mode: OpenCodeThemeMode;
  readonly document: OpenCodeThemeDocument;
}

interface MuxWorkspaceRailStatusColors {
  readonly working: UiColor;
  readonly exited: UiColor;
  readonly needsAction: UiColor;
  readonly starting: UiColor;
  readonly idle: UiColor;
}

export interface MuxWorkspaceRailTheme {
  readonly normalStyle: UiStyle;
  readonly headerStyle: UiStyle;
  readonly activeRowStyle: UiStyle;
  readonly metaStyle: UiStyle;
  readonly conversationBodyStyle: UiStyle;
  readonly processStyle: UiStyle;
  readonly repositoryRowStyle: UiStyle;
  readonly mutedStyle: UiStyle;
  readonly shortcutStyle: UiStyle;
  readonly actionStyle: UiStyle;
  readonly statusColors: MuxWorkspaceRailStatusColors;
}

interface ActiveMuxTheme {
  readonly name: string;
  readonly mode: OpenCodeThemeMode;
  readonly modalTheme: UiModalTheme;
  readonly workspaceRail: MuxWorkspaceRailTheme;
  readonly terminalForegroundHex: string | null;
  readonly terminalBackgroundHex: string | null;
}

interface ResolveConfiguredMuxThemeResult {
  readonly theme: ActiveMuxTheme;
  readonly error: string | null;
}

interface ResolveConfiguredMuxThemeOptions {
  readonly config: HarnessMuxThemeConfig | null;
  readonly cwd: string;
  readonly readFile?: (path: string) => string;
}

const FALLBACK_HEX = {
  text: '#d0d7de',
  textMuted: '#a4adb8',
  conceal: '#5c6370',
  primary: '#6cb6ff',
  success: '#8ccf7e',
  error: '#f47067',
  warning: '#e6c07b',
  info: '#39c5cf',
  background: '#0f1419',
  backgroundPanel: '#1b2128',
  backgroundElement: '#2a313a',
};

const BUILTIN_OPENCODE_PRESETS = BUILTIN_MUX_THEME_PRESETS as Readonly<
  Record<string, OpenCodeThemeDocument>
>;

const LEGACY_MUX_THEME: ActiveMuxTheme = {
  name: 'legacy-default',
  mode: 'dark',
  modalTheme: {
    frameStyle: {
      fg: { kind: 'indexed', index: 252 },
      bg: { kind: 'indexed', index: 236 },
      bold: true,
    },
    titleStyle: {
      fg: { kind: 'indexed', index: 231 },
      bg: { kind: 'indexed', index: 236 },
      bold: true,
    },
    bodyStyle: {
      fg: { kind: 'indexed', index: 253 },
      bg: { kind: 'indexed', index: 236 },
      bold: false,
    },
    footerStyle: {
      fg: { kind: 'indexed', index: 247 },
      bg: { kind: 'indexed', index: 236 },
      bold: false,
    },
  },
  workspaceRail: {
    normalStyle: {
      fg: { kind: 'default' },
      bg: { kind: 'default' },
      bold: false,
    },
    headerStyle: {
      fg: { kind: 'indexed', index: 254 },
      bg: { kind: 'default' },
      bold: true,
    },
    activeRowStyle: {
      fg: { kind: 'indexed', index: 254 },
      bg: { kind: 'indexed', index: 237 },
      bold: false,
    },
    metaStyle: {
      fg: { kind: 'indexed', index: 151 },
      bg: { kind: 'default' },
      bold: false,
    },
    conversationBodyStyle: {
      fg: { kind: 'indexed', index: 151 },
      bg: { kind: 'default' },
      bold: false,
    },
    processStyle: {
      fg: { kind: 'indexed', index: 223 },
      bg: { kind: 'default' },
      bold: false,
    },
    repositoryRowStyle: {
      fg: { kind: 'indexed', index: 181 },
      bg: { kind: 'default' },
      bold: false,
    },
    mutedStyle: {
      fg: { kind: 'indexed', index: 245 },
      bg: { kind: 'default' },
      bold: false,
    },
    shortcutStyle: {
      fg: { kind: 'indexed', index: 250 },
      bg: { kind: 'default' },
      bold: false,
    },
    actionStyle: {
      fg: { kind: 'indexed', index: 230 },
      bg: { kind: 'indexed', index: 237 },
      bold: false,
    },
    statusColors: {
      working: { kind: 'indexed', index: 45 },
      exited: { kind: 'indexed', index: 196 },
      needsAction: { kind: 'indexed', index: 220 },
      starting: { kind: 'indexed', index: 110 },
      idle: { kind: 'indexed', index: 245 },
    },
  },
  terminalForegroundHex: null,
  terminalBackgroundHex: null,
};

let activeMuxTheme: ActiveMuxTheme = LEGACY_MUX_THEME;

function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const red = trimmed[1]!;
    const green = trimmed[2]!;
    const blue = trimmed[3]!;
    return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase();
  }
  return null;
}

function hexToUiColor(hex: string): UiColor {
  const normalized = normalizeHex(hex) ?? '#000000';
  return {
    kind: 'rgb',
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function asThemeDocument(value: unknown): OpenCodeThemeDocument | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record['theme'] === null ||
    typeof record['theme'] !== 'object' ||
    Array.isArray(record['theme'])
  ) {
    return null;
  }
  return {
    ...(typeof record['$schema'] === 'string' ? { $schema: record['$schema'] } : {}),
    ...(record['defs'] !== undefined &&
    record['defs'] !== null &&
    typeof record['defs'] === 'object' &&
    !Array.isArray(record['defs'])
      ? { defs: record['defs'] as Readonly<Record<string, OpenCodeColorValue>> }
      : {}),
    theme: record['theme'] as Readonly<Record<string, OpenCodeColorValue>>,
  };
}

function asColorVariant(
  value: OpenCodeColorValue,
): { readonly dark: string; readonly light: string } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  if (typeof value.dark !== 'string' || typeof value.light !== 'string') {
    return null;
  }
  return {
    dark: value.dark,
    light: value.light,
  };
}

function resolveColorValue(
  input: OpenCodeThemeInput,
  value: OpenCodeColorValue,
  stack: ReadonlySet<string>,
): string | null {
  if (typeof value === 'string') {
    const normalizedHex = normalizeHex(value);
    if (normalizedHex !== null) {
      return normalizedHex;
    }
    const nextKey = value.trim();
    if (nextKey.length === 0) {
      return null;
    }
    if (stack.has(nextKey)) {
      return null;
    }
    if (nextKey === 'transparent' || nextKey === 'none') {
      return null;
    }
    const nextValue = input.document.theme[nextKey] ?? input.document.defs?.[nextKey];
    if (nextValue === undefined) {
      return null;
    }
    const nextStack = new Set(stack);
    nextStack.add(nextKey);
    return resolveColorValue(input, nextValue, nextStack);
  }
  const variant = asColorVariant(value);
  if (variant === null) {
    return null;
  }
  return resolveColorValue(input, variant[input.mode], stack);
}

function themeHex(input: OpenCodeThemeInput, key: string, fallback: string): string {
  const value = input.document.theme[key];
  if (value === undefined) {
    return fallback;
  }
  return resolveColorValue(input, value, new Set<string>([key])) ?? fallback;
}

function uiStyle(fgHex: string, bgHex: string | null, bold = false): UiStyle {
  return {
    fg: hexToUiColor(fgHex),
    bg: bgHex === null ? { kind: 'default' } : hexToUiColor(bgHex),
    bold,
  };
}

function resolveThemeDocumentFromFile(
  path: string,
  readFile: (path: string) => string,
): OpenCodeThemeDocument {
  const content = readFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid theme json at ${path}: ${message}`);
  }
  const document = asThemeDocument(parsed);
  if (document === null) {
    throw new Error(`theme at ${path} must be an object with a "theme" record`);
  }
  return document;
}

function buildActiveTheme(name: string, input: OpenCodeThemeInput): ActiveMuxTheme {
  const text = themeHex(input, 'text', FALLBACK_HEX.text);
  const textMuted = themeHex(input, 'textMuted', FALLBACK_HEX.textMuted);
  const conceal = themeHex(input, 'conceal', FALLBACK_HEX.conceal);
  const primary = themeHex(input, 'primary', FALLBACK_HEX.primary);
  const success = themeHex(input, 'success', FALLBACK_HEX.success);
  const error = themeHex(input, 'error', FALLBACK_HEX.error);
  const warning = themeHex(input, 'warning', FALLBACK_HEX.warning);
  const info = themeHex(input, 'info', FALLBACK_HEX.info);
  const background = themeHex(input, 'background', FALLBACK_HEX.background);
  const backgroundPanel = themeHex(input, 'backgroundPanel', FALLBACK_HEX.backgroundPanel);
  const backgroundElement = themeHex(input, 'backgroundElement', FALLBACK_HEX.backgroundElement);
  const syntaxFunction = themeHex(input, 'syntaxFunction', primary);

  return {
    name,
    mode: input.mode,
    modalTheme: {
      frameStyle: uiStyle(primary, backgroundPanel, true),
      titleStyle: uiStyle(text, backgroundPanel, true),
      bodyStyle: uiStyle(text, backgroundPanel, false),
      footerStyle: uiStyle(textMuted, backgroundPanel, false),
    },
    workspaceRail: {
      normalStyle: uiStyle(text, null, false),
      headerStyle: uiStyle(primary, null, true),
      activeRowStyle: uiStyle(text, backgroundElement, false),
      metaStyle: uiStyle(textMuted, null, false),
      conversationBodyStyle: uiStyle(textMuted, null, false),
      processStyle: uiStyle(info, null, false),
      repositoryRowStyle: uiStyle(syntaxFunction, null, false),
      mutedStyle: uiStyle(conceal, null, false),
      shortcutStyle: uiStyle(textMuted, null, false),
      actionStyle: uiStyle(primary, backgroundElement, false),
      statusColors: {
        working: hexToUiColor(success),
        exited: hexToUiColor(error),
        needsAction: hexToUiColor(warning),
        starting: hexToUiColor(primary),
        idle: hexToUiColor(conceal),
      },
    },
    terminalForegroundHex: text.slice(1),
    terminalBackgroundHex: background.slice(1),
  };
}

export function muxThemePresetNames(): readonly string[] {
  return Object.keys(BUILTIN_OPENCODE_PRESETS).sort();
}

function resolveBuiltinPreset(name: string): OpenCodeThemeDocument | null {
  const preset = BUILTIN_OPENCODE_PRESETS[name];
  return preset ?? null;
}

export function setActiveMuxTheme(theme: ActiveMuxTheme): void {
  activeMuxTheme = theme;
}

export function getActiveMuxTheme(): ActiveMuxTheme {
  return activeMuxTheme;
}

export function resetActiveMuxThemeForTest(): void {
  activeMuxTheme = LEGACY_MUX_THEME;
}

export function resolveConfiguredMuxTheme(
  options: ResolveConfiguredMuxThemeOptions,
): ResolveConfiguredMuxThemeResult {
  const configured = options.config;
  if (configured === null) {
    return {
      theme: LEGACY_MUX_THEME,
      error: null,
    };
  }

  const normalizedPreset = configured.preset.trim().toLowerCase();
  const presetDocument = resolveBuiltinPreset(normalizedPreset);
  const mode: OpenCodeThemeMode = configured.mode === 'light' ? 'light' : 'dark';
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));

  let selectedDocument: OpenCodeThemeDocument | null = presetDocument ?? null;
  let selectedName = normalizedPreset.length === 0 ? 'github' : normalizedPreset;
  let error: string | null = null;

  if (configured.customThemePath !== null) {
    const resolvedCustomPath = resolve(options.cwd, configured.customThemePath);
    try {
      selectedDocument = resolveThemeDocumentFromFile(resolvedCustomPath, readFile);
      selectedName = `custom:${configured.customThemePath}`;
    } catch (customError: unknown) {
      const message = customError instanceof Error ? customError.message : String(customError);
      error = message;
    }
  }

  if (selectedDocument === null) {
    const fallbackDocument = BUILTIN_OPENCODE_PRESETS.github as OpenCodeThemeDocument;
    selectedDocument = fallbackDocument;
    selectedName = 'github';
    if (error === null && presetDocument === null) {
      error = `unknown mux theme preset "${configured.preset}"`;
    }
  }
  const resolvedDocument =
    selectedDocument ?? (BUILTIN_OPENCODE_PRESETS.github as OpenCodeThemeDocument);

  return {
    theme: buildActiveTheme(selectedName, {
      mode,
      document: resolvedDocument,
    }),
    error,
  };
}
