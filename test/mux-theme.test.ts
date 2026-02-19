import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'bun:test';
import { renderWorkspaceRailRowAnsiForTest } from '../src/mux/workspace-rail.ts';
import {
  getActiveMuxTheme,
  muxThemePresetNames,
  resetActiveMuxThemeForTest,
  resolveConfiguredMuxTheme,
  setActiveMuxTheme,
} from '../src/ui/mux-theme.ts';

function readFileFromMap(values: Record<string, string>): (path: string) => string {
  return (path: string): string => {
    const content = values[path];
    if (content === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    return content;
  };
}

void test('muxThemePresetNames returns sorted preset names', () => {
  const names = muxThemePresetNames();
  const sorted = [...names].sort();
  assert.deepEqual(names, sorted);
  assert.equal(names.includes('aura'), true);
  assert.equal(names.includes('carbonfox'), true);
  assert.equal(names.includes('default'), true);
  assert.equal(names.includes('github'), true);
  assert.equal(names.includes('tokyonight'), true);
});

void test('resolveConfiguredMuxTheme returns legacy defaults when theme config is null', () => {
  const resolved = resolveConfiguredMuxTheme({
    config: null,
    cwd: '/tmp',
  });
  assert.equal(resolved.error, null);
  assert.equal(resolved.theme.name, 'legacy-default');
  assert.equal(resolved.theme.terminalForegroundHex, null);
  assert.equal(resolved.theme.terminalBackgroundHex, null);
});

void test('resolveConfiguredMuxTheme supports special default preset', () => {
  const resolved = resolveConfiguredMuxTheme({
    config: {
      preset: 'default',
      mode: 'dark',
      customThemePath: null,
    },
    cwd: '/tmp',
  });
  assert.equal(resolved.error, null);
  assert.equal(resolved.theme.name, 'default');
  assert.equal(resolved.theme.terminalForegroundHex, null);
  assert.equal(resolved.theme.terminalBackgroundHex, null);
});

void test('resolveConfiguredMuxTheme resolves built-in presets and applies rgb styles', () => {
  const resolved = resolveConfiguredMuxTheme({
    config: {
      preset: 'github-light',
      mode: 'light',
      customThemePath: null,
    },
    cwd: '/tmp',
  });
  assert.equal(resolved.error, null);
  assert.equal(resolved.theme.name, 'github-light');
  assert.equal(resolved.theme.mode, 'light');
  assert.equal(resolved.theme.terminalForegroundHex, '24292f');
  assert.equal(resolved.theme.terminalBackgroundHex, 'ffffff');
  assert.deepEqual(resolved.theme.workspaceRail.headerStyle.fg, {
    kind: 'rgb',
    r: 5,
    g: 80,
    b: 174,
  });
});

void test('resolveConfiguredMuxTheme falls back to github preset when preset name is unknown', () => {
  const resolved = resolveConfiguredMuxTheme({
    config: {
      preset: 'does-not-exist',
      mode: 'dark',
      customThemePath: null,
    },
    cwd: '/tmp',
  });
  assert.equal(resolved.theme.name, 'github');
  assert.equal(resolved.error, 'unknown mux theme preset "does-not-exist"');
});

void test('resolveConfiguredMuxTheme loads custom opencode theme from file and resolves refs and variants', () => {
  const cwd = '/workspace/project';
  const path = '/workspace/project/themes/custom.json';
  const readFile = readFileFromMap({
    [path]: JSON.stringify({
      $schema: 'https://opencode.ai/theme.json',
      defs: {
        main: '#112233',
        panel: '#202020',
      },
      theme: {
        primary: '#445566',
        success: '#228833',
        error: '#cc3344',
        warning: '#ddaa22',
        info: '#3377cc',
        text: {
          dark: 'main',
          light: '#abcdef',
        },
        textMuted: '#778899',
        conceal: '#556677',
        background: '#0a0b0c',
        backgroundPanel: 'panel',
        backgroundElement: '#30363d',
        syntaxFunction: 'primary',
      },
    }),
  });
  const resolved = resolveConfiguredMuxTheme({
    config: {
      preset: 'github',
      mode: 'dark',
      customThemePath: 'themes/custom.json',
    },
    cwd,
    readFile,
  });
  assert.equal(resolved.error, null);
  assert.equal(resolved.theme.name, 'custom:themes/custom.json');
  assert.equal(resolved.theme.terminalForegroundHex, '112233');
  assert.equal(resolved.theme.terminalBackgroundHex, '0a0b0c');
  assert.deepEqual(resolved.theme.workspaceRail.actionStyle.fg, {
    kind: 'rgb',
    r: 68,
    g: 85,
    b: 102,
  });
  assert.deepEqual(resolved.theme.workspaceRail.actionStyle.bg, {
    kind: 'rgb',
    r: 48,
    g: 54,
    b: 61,
  });
});

void test('resolveConfiguredMuxTheme maps action button colors to primary fg over backgroundElement bg', () => {
  const resolved = resolveConfiguredMuxTheme({
    config: {
      preset: 'github',
      mode: 'dark',
      customThemePath: 'themes/action-colors.json',
    },
    cwd: '/workspace/project',
    readFile: () =>
      JSON.stringify({
        theme: {
          text: '#c0ffee',
          textMuted: '#778899',
          conceal: '#556677',
          primary: '#112233',
          success: '#00aa00',
          error: '#aa0000',
          warning: '#aaaa00',
          info: '#0099aa',
          background: '#ffffff',
          backgroundPanel: '#101010',
          backgroundElement: '#445566',
        },
      }),
  });
  assert.equal(resolved.theme.name, 'custom:themes/action-colors.json');
  assert.deepEqual(resolved.theme.workspaceRail.actionStyle.fg, {
    kind: 'rgb',
    r: 17,
    g: 34,
    b: 51,
  });
  assert.deepEqual(resolved.theme.workspaceRail.actionStyle.bg, {
    kind: 'rgb',
    r: 68,
    g: 85,
    b: 102,
  });
});

void test('resolveConfiguredMuxTheme reports custom parse errors and falls back to selected preset', () => {
  const resolved = resolveConfiguredMuxTheme({
    config: {
      preset: 'nord',
      mode: 'dark',
      customThemePath: 'broken/custom.json',
    },
    cwd: '/workspace/project',
    readFile: () => '{ not-json',
  });
  assert.equal(resolved.theme.name, 'nord');
  assert.equal(
    resolved.error?.startsWith('invalid theme json at /workspace/project/broken/custom.json:'),
    true,
  );
});

void test('resolveConfiguredMuxTheme reports malformed custom theme files and falls back to preset', () => {
  const resolved = resolveConfiguredMuxTheme({
    config: {
      preset: 'dracula',
      mode: 'dark',
      customThemePath: 'bad/custom.json',
    },
    cwd: '/workspace/project',
    readFile: () => '{"hello":"world"}',
  });
  assert.equal(resolved.theme.name, 'dracula');
  assert.equal(
    resolved.error,
    'theme at /workspace/project/bad/custom.json must be an object with a "theme" record',
  );
});

void test('resolveConfiguredMuxTheme rejects non-object root theme docs and falls back to preset', () => {
  const resolved = resolveConfiguredMuxTheme({
    config: {
      preset: 'github',
      mode: 'dark',
      customThemePath: 'bad/root.json',
    },
    cwd: '/workspace/project',
    readFile: () => '[]',
  });
  assert.equal(resolved.theme.name, 'github');
  assert.equal(
    resolved.error,
    'theme at /workspace/project/bad/root.json must be an object with a "theme" record',
  );
});

void test('resolveConfiguredMuxTheme handles unknown references, transparent colors, and cyclic refs with fallbacks', () => {
  const resolved = resolveConfiguredMuxTheme({
    config: {
      preset: 'github',
      mode: 'dark',
      customThemePath: 'themes/edge.json',
    },
    cwd: '/workspace/project',
    readFile: () =>
      JSON.stringify({
        theme: {
          text: 'a',
          a: 'b',
          b: 'a',
          textMuted: 'none',
          conceal: 'transparent',
          primary: '#abc',
          success: '#123456',
          error: '#654321',
          warning: '#999999',
          info: '#888888',
          background: 'missing-ref',
          backgroundPanel: '#222222',
          backgroundElement: '#333333',
          syntaxFunction: { dark: '#445566' },
        },
      }),
  });
  assert.equal(resolved.theme.name, 'custom:themes/edge.json');
  assert.equal(resolved.theme.terminalForegroundHex, 'd0d7de');
  assert.equal(resolved.theme.terminalBackgroundHex, '0f1419');
  assert.deepEqual(resolved.theme.workspaceRail.headerStyle.fg, {
    kind: 'rgb',
    r: 170,
    g: 187,
    b: 204,
  });
});

void test('resolveConfiguredMuxTheme handles missing keys, blank refs, and non-object variants with fallback colors', () => {
  const resolved = resolveConfiguredMuxTheme({
    config: {
      preset: 'github',
      mode: 'dark',
      customThemePath: 'themes/fallbacks.json',
    },
    cwd: '/workspace/project',
    readFile: () =>
      JSON.stringify({
        theme: {
          text: '   ',
          primary: 123,
          background: '#000000',
          backgroundPanel: '#111111',
          backgroundElement: '#222222',
        },
      }),
  });
  assert.equal(resolved.theme.name, 'custom:themes/fallbacks.json');
  assert.equal(resolved.theme.terminalForegroundHex, 'd0d7de');
  assert.equal(resolved.theme.terminalBackgroundHex, '000000');
  assert.deepEqual(resolved.theme.workspaceRail.headerStyle.fg, {
    kind: 'rgb',
    r: 108,
    g: 182,
    b: 255,
  });
});

void test('resolveConfiguredMuxTheme uses default file reader when readFile override is omitted', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-theme-file-'));
  const themePath = join(baseDir, 'theme.json');
  writeFileSync(
    themePath,
    JSON.stringify({
      theme: {
        text: '#112233',
        textMuted: '#445566',
        conceal: '#778899',
        primary: '#123456',
        success: '#00aa00',
        error: '#aa0000',
        warning: '#aaaa00',
        info: '#0099aa',
        background: '#010203',
        backgroundPanel: '#111111',
        backgroundElement: '#222222',
      },
    }),
    'utf8',
  );
  const resolved = resolveConfiguredMuxTheme({
    config: {
      preset: 'github',
      mode: 'dark',
      customThemePath: themePath,
    },
    cwd: '/',
  });
  assert.equal(resolved.error, null);
  assert.equal(resolved.theme.terminalForegroundHex, '112233');
  assert.equal(resolved.theme.terminalBackgroundHex, '010203');
});

void test('setActiveMuxTheme and resetActiveMuxThemeForTest update renderer theme state', () => {
  resetActiveMuxThemeForTest();
  try {
    const resolved = resolveConfiguredMuxTheme({
      config: {
        preset: 'tokyonight',
        mode: 'dark',
        customThemePath: null,
      },
      cwd: '/tmp',
    });
    setActiveMuxTheme(resolved.theme);
    assert.equal(getActiveMuxTheme().name, 'tokyonight');
    const ansi = renderWorkspaceRailRowAnsiForTest(
      {
        kind: 'repository-row',
        text: 'repo-name',
        active: false,
        conversationSessionId: null,
        directoryKey: null,
        repositoryId: null,
        railAction: null,
        conversationStatus: null,
      },
      32,
    );
    assert.equal(ansi.includes('\u001b['), true);
    assert.equal(ansi.includes('38;2;'), true);
  } finally {
    resetActiveMuxThemeForTest();
  }
  assert.equal(getActiveMuxTheme().name, 'legacy-default');
});
