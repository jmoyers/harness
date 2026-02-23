import assert from 'node:assert/strict';
import { describe, test } from 'bun:test';
import type { Theme } from '../../../packages/harness-ui/src/theme/theme.ts';
import {
  DARK_THEME,
  LIGHT_THEME,
  defaultTheme,
  fromOpenCodeTheme,
} from '../../../packages/harness-ui/src/theme/defaults.ts';

function validateThemeShape(theme: Theme): void {
  assert.equal(typeof theme.mode, 'string');
  assert.ok(theme.mode === 'dark' || theme.mode === 'light');

  for (const [key, value] of Object.entries(theme.colors)) {
    assert.equal(typeof value, 'string', `colors.${key} should be string`);
    assert.ok(value.length > 0, `colors.${key} should not be empty`);
  }

  for (const [key, value] of Object.entries(theme.input)) {
    assert.equal(typeof value, 'string', `input.${key} should be string`);
  }

  for (const [key, value] of Object.entries(theme.select)) {
    assert.equal(typeof value, 'string', `select.${key} should be string`);
  }

  for (const [key, value] of Object.entries(theme.modal)) {
    assert.equal(typeof value, 'string', `modal.${key} should be string`);
  }

  assert.equal(theme.terminal.palette.length, 16);
  for (const color of theme.terminal.palette) {
    assert.equal(typeof color, 'string');
    assert.ok(color.startsWith('#'));
  }
  assert.equal(typeof theme.terminal.foreground, 'string');
  assert.equal(typeof theme.terminal.background, 'string');
  assert.equal(typeof theme.terminal.cursor, 'string');
  assert.equal(typeof theme.terminal.selection, 'string');
}

describe('DARK_THEME', () => {
  test('has valid shape', () => {
    validateThemeShape(DARK_THEME);
  });

  test('is dark mode', () => {
    assert.equal(DARK_THEME.mode, 'dark');
  });

  test('colors are hex strings', () => {
    assert.ok(DARK_THEME.colors.text.startsWith('#'));
    assert.ok(DARK_THEME.colors.background.startsWith('#'));
    assert.ok(DARK_THEME.colors.primary.startsWith('#'));
  });
});

describe('LIGHT_THEME', () => {
  test('has valid shape', () => {
    validateThemeShape(LIGHT_THEME);
  });

  test('is light mode', () => {
    assert.equal(LIGHT_THEME.mode, 'light');
  });

  test('background is lighter than dark theme', () => {
    assert.notEqual(LIGHT_THEME.colors.background, DARK_THEME.colors.background);
  });
});

describe('defaultTheme', () => {
  test('dark returns DARK_THEME', () => {
    assert.equal(defaultTheme('dark'), DARK_THEME);
  });

  test('light returns LIGHT_THEME', () => {
    assert.equal(defaultTheme('light'), LIGHT_THEME);
  });
});

describe('fromOpenCodeTheme', () => {
  test('empty overrides returns default theme', () => {
    const theme = fromOpenCodeTheme('dark', {});
    assert.equal(theme.mode, 'dark');
    assert.equal(theme.colors.text, DARK_THEME.colors.text);
    assert.equal(theme.input.text, DARK_THEME.input.text);
  });

  test('borderColor override applies to colors.border', () => {
    const theme = fromOpenCodeTheme('dark', { borderColor: '#FF0000' });
    assert.equal(theme.colors.border, '#FF0000');
    assert.equal(theme.colors.text, DARK_THEME.colors.text);
  });

  test('focusedBorderColor override applies to colors and input', () => {
    const theme = fromOpenCodeTheme('dark', { focusedBorderColor: '#00FF00' });
    assert.equal(theme.colors.borderFocused, '#00FF00');
    assert.equal(theme.input.focusedBorder, '#00FF00');
  });

  test('input color overrides', () => {
    const theme = fromOpenCodeTheme('light', {
      inputTextColor: '#111',
      inputPlaceholderColor: '#222',
      inputCursorColor: '#333',
    });
    assert.equal(theme.input.text, '#111');
    assert.equal(theme.input.placeholder, '#222');
    assert.equal(theme.input.cursor, '#333');
  });

  test('select color overrides', () => {
    const theme = fromOpenCodeTheme('dark', {
      selectTextColor: '#AAA',
      selectSelectedTextColor: '#BBB',
      selectSelectedBackgroundColor: '#CCC',
      selectDescriptionColor: '#DDD',
      selectSelectedDescriptionColor: '#EEE',
    });
    assert.equal(theme.select.text, '#AAA');
    assert.equal(theme.select.selectedText, '#BBB');
    assert.equal(theme.select.selectedBackground, '#CCC');
    assert.equal(theme.select.description, '#DDD');
    assert.equal(theme.select.selectedDescription, '#EEE');
  });

  test('selectTextColor also maps to colors.text', () => {
    const theme = fromOpenCodeTheme('dark', { selectTextColor: '#AABBCC' });
    assert.equal(theme.colors.text, '#AABBCC');
  });

  test('instructionsColor maps to textMuted', () => {
    const theme = fromOpenCodeTheme('dark', { instructionsColor: '#999' });
    assert.equal(theme.colors.textMuted, '#999');
  });

  test('modal and terminal stay at defaults', () => {
    const theme = fromOpenCodeTheme('dark', { borderColor: '#FFF' });
    assert.equal(theme.modal.frame, DARK_THEME.modal.frame);
    assert.equal(theme.terminal.foreground, DARK_THEME.terminal.foreground);
  });

  test('light mode base with overrides', () => {
    const theme = fromOpenCodeTheme('light', { borderColor: '#000' });
    assert.equal(theme.mode, 'light');
    assert.equal(theme.colors.border, '#000');
    assert.equal(theme.colors.background, LIGHT_THEME.colors.background);
  });

  test('resulting theme has valid shape', () => {
    const theme = fromOpenCodeTheme('dark', {
      borderColor: '#FF0000',
      inputTextColor: '#00FF00',
      selectTextColor: '#0000FF',
    });
    validateThemeShape(theme);
  });
});
