import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type MuxThemePresetColor =
  | string
  | {
      readonly dark: string;
      readonly light: string;
    };

interface MuxThemePresetDocument {
  readonly $schema?: string;
  readonly defs?: Readonly<Record<string, MuxThemePresetColor>>;
  readonly theme: Readonly<Record<string, MuxThemePresetColor>>;
}

const BUILTIN_MUX_THEME_PRESETS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'mux-theme-presets.json',
);

const parsedBuiltinPresetPayload = JSON.parse(
  readFileSync(BUILTIN_MUX_THEME_PRESETS_PATH, 'utf8'),
) as unknown;

export const BUILTIN_MUX_THEME_PRESETS = parsedBuiltinPresetPayload as Readonly<
  Record<string, MuxThemePresetDocument>
>;
