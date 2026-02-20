import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { renderSyntaxAnsiLine } from '../src/diff-ui/highlight.ts';
import { DEFAULT_DIFF_UI_THEME } from '../src/diff-ui/render.ts';

void test('renderSyntaxAnsiLine tokenizes javascript-like lines and skips unsupported languages', () => {
  const highlighted = renderSyntaxAnsiLine({
    line: "const value = 42 // comment 'x'",
    language: 'typescript',
    theme: DEFAULT_DIFF_UI_THEME,
    colorEnabled: true,
    baseAnsi: DEFAULT_DIFF_UI_THEME.contextAnsi,
  });
  assert.equal(highlighted.includes('\u001b['), true);

  const noLanguage = renderSyntaxAnsiLine({
    line: 'const x = 1',
    language: null,
    theme: DEFAULT_DIFF_UI_THEME,
    colorEnabled: true,
    baseAnsi: DEFAULT_DIFF_UI_THEME.contextAnsi,
  });
  assert.equal(noLanguage, 'const x = 1');

  const markdown = renderSyntaxAnsiLine({
    line: '# hello',
    language: 'markdown',
    theme: DEFAULT_DIFF_UI_THEME,
    colorEnabled: true,
    baseAnsi: DEFAULT_DIFF_UI_THEME.contextAnsi,
  });
  assert.equal(markdown, '# hello');
});

void test('renderSyntaxAnsiLine applies ansi spans only when enabled and tokenized', () => {
  const line = "const value = 'text'";

  const disabled = renderSyntaxAnsiLine({
    line,
    language: 'typescript',
    theme: DEFAULT_DIFF_UI_THEME,
    colorEnabled: false,
    baseAnsi: DEFAULT_DIFF_UI_THEME.contextAnsi,
  });
  assert.equal(disabled, line);

  const enabled = renderSyntaxAnsiLine({
    line,
    language: 'typescript',
    theme: DEFAULT_DIFF_UI_THEME,
    colorEnabled: true,
    baseAnsi: DEFAULT_DIFF_UI_THEME.contextAnsi,
  });
  assert.equal(enabled.includes('\u001b['), true);

  const unsupported = renderSyntaxAnsiLine({
    line,
    language: 'markdown',
    theme: DEFAULT_DIFF_UI_THEME,
    colorEnabled: true,
    baseAnsi: DEFAULT_DIFF_UI_THEME.contextAnsi,
  });
  assert.equal(unsupported, line);
});
