import type { DiffUiRenderTheme } from './types.ts';

type DiffUiSyntaxTokenRole = 'keyword' | 'string' | 'comment' | 'number';

interface DiffUiSyntaxToken {
  readonly start: number;
  readonly end: number;
  readonly role: DiffUiSyntaxTokenRole;
}

const JAVASCRIPT_LIKE_LANGUAGES = new Set(['javascript', 'typescript', 'tsx', 'jsx', 'mjs', 'cjs']);

const KEYWORD_PATTERN =
  /\b(async|await|break|case|catch|class|const|continue|default|else|export|extends|finally|for|function|if|import|interface|let|new|return|switch|throw|try|type|var|while)\b/gu;
const NUMBER_PATTERN = /\b\d+(?:\.\d+)?\b/gu;
const STRING_PATTERN = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/gu;
const COMMENT_PATTERN = /\/\/.*$/u;

function hasOverlap(tokens: readonly DiffUiSyntaxToken[], start: number, end: number): boolean {
  for (const token of tokens) {
    if (start < token.end && end > token.start) {
      return true;
    }
  }
  return false;
}

function collectRegexMatches(
  line: string,
  regex: RegExp,
  role: DiffUiSyntaxTokenRole,
  tokens: DiffUiSyntaxToken[],
): void {
  const cloned = new RegExp(regex.source, regex.flags);
  let match = cloned.exec(line);
  while (match !== null) {
    const matched = match[0] ?? '';
    const start = match.index;
    const end = start + matched.length;
    if (matched.length > 0 && !hasOverlap(tokens, start, end)) {
      tokens.push({
        start,
        end,
        role,
      });
    }
    match = cloned.exec(line);
  }
}

function isSyntaxLanguage(language: string | null): boolean {
  if (language === null) {
    return false;
  }
  return JAVASCRIPT_LIKE_LANGUAGES.has(language.toLowerCase());
}

function tokenizeDiffUiSyntaxLine(
  line: string,
  language: string | null,
): readonly DiffUiSyntaxToken[] {
  if (!isSyntaxLanguage(language)) {
    return [];
  }

  const tokens: DiffUiSyntaxToken[] = [];

  const commentMatch = line.match(COMMENT_PATTERN);
  if (commentMatch !== null && commentMatch.index !== undefined) {
    tokens.push({
      start: commentMatch.index,
      end: line.length,
      role: 'comment',
    });
  }

  collectRegexMatches(line, STRING_PATTERN, 'string', tokens);
  collectRegexMatches(line, KEYWORD_PATTERN, 'keyword', tokens);
  collectRegexMatches(line, NUMBER_PATTERN, 'number', tokens);

  tokens.sort((left, right) => left.start - right.start || left.end - right.end);
  return tokens;
}

function ansiForRole(role: DiffUiSyntaxTokenRole, theme: DiffUiRenderTheme): string {
  if (role === 'keyword') {
    return theme.syntaxKeywordAnsi;
  }
  if (role === 'string') {
    return theme.syntaxStringAnsi;
  }
  if (role === 'comment') {
    return theme.syntaxCommentAnsi;
  }
  return theme.syntaxNumberAnsi;
}

export function renderSyntaxAnsiLine(input: {
  readonly line: string;
  readonly language: string | null;
  readonly theme: DiffUiRenderTheme;
  readonly colorEnabled: boolean;
  readonly baseAnsi: string;
}): string {
  if (!input.colorEnabled) {
    return input.line;
  }

  const tokens = tokenizeDiffUiSyntaxLine(input.line, input.language);
  if (tokens.length === 0) {
    return input.line;
  }

  let output = '';
  let cursor = 0;
  for (const token of tokens) {
    if (token.start > cursor) {
      output += input.line.slice(cursor, token.start);
    }
    output += `${ansiForRole(token.role, input.theme)}${input.line.slice(token.start, token.end)}${input.baseAnsi}`;
    cursor = token.end;
  }
  if (cursor < input.line.length) {
    output += input.line.slice(cursor);
  }
  return output;
}
