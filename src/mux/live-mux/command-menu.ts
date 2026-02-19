export const COMMAND_MENU_MAX_RESULTS = 8;

export type CommandMenuScope = 'all' | 'thread-start' | 'theme-select';

export interface CommandMenuState {
  readonly scope: CommandMenuScope;
  readonly query: string;
  readonly selectedIndex: number;
}

export interface CommandMenuActionDescriptor {
  readonly id: string;
  readonly title: string;
  readonly aliases?: readonly string[];
  readonly keywords?: readonly string[];
  readonly detail?: string;
}

export function filterThemePresetActionsForScope<TAction extends CommandMenuActionDescriptor>(
  actions: readonly TAction[],
  scope: CommandMenuScope,
  themeActionIdPrefix: string,
): readonly TAction[] {
  if (scope === 'theme-select') {
    return actions.filter((action) => action.id.startsWith(themeActionIdPrefix));
  }
  return actions.filter((action) => !action.id.startsWith(themeActionIdPrefix));
}

export interface RegisteredCommandMenuAction<TContext> extends CommandMenuActionDescriptor {
  readonly when?: (context: TContext) => boolean;
  readonly run: (context: TContext) => Promise<void> | void;
}

interface CommandMenuMatch<TAction extends CommandMenuActionDescriptor> {
  readonly action: TAction;
  readonly score: number;
}

type CommandMenuActionProvider<TContext> = (
  context: TContext,
) => readonly RegisteredCommandMenuAction<TContext>[];

interface CommandMenuInputReduction {
  readonly nextState: CommandMenuState;
  readonly submit: boolean;
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizedTokens(query: string): readonly string[] {
  const normalized = normalizeQuery(query);
  if (normalized.length === 0) {
    return [];
  }
  return normalized.split(' ');
}

function normalizedAliases(action: CommandMenuActionDescriptor): readonly string[] {
  return (action.aliases ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function normalizedKeywords(action: CommandMenuActionDescriptor): readonly string[] {
  return (action.keywords ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function searchableParts(action: CommandMenuActionDescriptor): readonly string[] {
  const parts = [
    action.title.trim().toLowerCase(),
    ...normalizedAliases(action),
    ...normalizedKeywords(action),
  ].filter((value) => value.length > 0);
  return parts;
}

function actionScore(action: CommandMenuActionDescriptor, query: string): number | null {
  const tokens = normalizedTokens(query);
  if (tokens.length === 0) {
    return 0;
  }
  const title = action.title.trim().toLowerCase();
  const aliases = normalizedAliases(action);
  const keywords = normalizedKeywords(action);
  const haystack = searchableParts(action).join(' ');

  for (const token of tokens) {
    if (!haystack.includes(token)) {
      return null;
    }
  }

  const normalizedQuery = tokens.join(' ');
  if (title.startsWith(normalizedQuery)) {
    return 0;
  }
  const aliasPrefix = aliases.findIndex((alias) => alias.startsWith(normalizedQuery));
  if (aliasPrefix >= 0) {
    return 10 + aliasPrefix;
  }

  const titleContains = title.indexOf(normalizedQuery);
  if (titleContains >= 0) {
    return 100 + titleContains;
  }
  const aliasContains = aliases
    .map((alias) => alias.indexOf(normalizedQuery))
    .find((index) => index >= 0);
  if (aliasContains !== undefined) {
    return 200 + aliasContains;
  }
  const keywordContains = keywords
    .map((keyword) => keyword.indexOf(normalizedQuery))
    .find((index) => index >= 0);
  if (keywordContains !== undefined) {
    return 300 + keywordContains;
  }
  return 1000;
}

function clampSelectedIndex(selectedIndex: number, resultCount: number): number {
  if (resultCount <= 0) {
    return 0;
  }
  if (selectedIndex < 0) {
    return 0;
  }
  if (selectedIndex >= resultCount) {
    return resultCount - 1;
  }
  return selectedIndex;
}

function moveSelectionByDelta(selectedIndex: number, resultCount: number, delta: number): number {
  if (resultCount <= 0) {
    return 0;
  }
  const normalized = (selectedIndex + delta + resultCount * 4) % resultCount;
  return normalized;
}

function isCsiArrowSequence(text: string, final: 'A' | 'B'): boolean {
  if (!text.startsWith('\u001b[') || !text.endsWith(final)) {
    return false;
  }
  const payload = text.slice(2, -1);
  for (const char of payload) {
    const isDigit = char >= '0' && char <= '9';
    if (!isDigit && char !== ';') {
      return false;
    }
  }
  return true;
}

function isUpArrowSequence(text: string): boolean {
  return isCsiArrowSequence(text, 'A') || text === '\u001bOA';
}

function isDownArrowSequence(text: string): boolean {
  return isCsiArrowSequence(text, 'B') || text === '\u001bOB';
}

export function createCommandMenuState(options?: {
  readonly scope?: CommandMenuScope;
  readonly query?: string;
}): CommandMenuState {
  const query = options?.query ?? '';
  return {
    scope: options?.scope ?? 'all',
    query,
    selectedIndex: 0,
  };
}

export function resolveCommandMenuMatches<TAction extends CommandMenuActionDescriptor>(
  actions: readonly TAction[],
  query: string,
  limit: number | null = COMMAND_MENU_MAX_RESULTS,
): readonly CommandMenuMatch<TAction>[] {
  const scored = actions
    .flatMap((action) => {
      const score = actionScore(action, query);
      return score === null ? [] : [{ action, score }];
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return left.action.title.localeCompare(right.action.title);
    });
  if (limit === null) {
    return scored;
  }
  return scored.slice(0, Math.max(0, limit));
}

export function reduceCommandMenuInput(
  state: CommandMenuState,
  input: Buffer,
  visibleResultCount: number,
): CommandMenuInputReduction {
  const text = input.toString('utf8');
  if (isUpArrowSequence(text)) {
    return {
      nextState: {
        scope: state.scope,
        query: state.query,
        selectedIndex: moveSelectionByDelta(state.selectedIndex, visibleResultCount, -1),
      },
      submit: false,
    };
  }
  if (isDownArrowSequence(text)) {
    return {
      nextState: {
        scope: state.scope,
        query: state.query,
        selectedIndex: moveSelectionByDelta(state.selectedIndex, visibleResultCount, 1),
      },
      submit: false,
    };
  }

  let query = state.query;
  let selectedIndex = clampSelectedIndex(state.selectedIndex, visibleResultCount);
  let submit = false;
  for (const byte of input) {
    if (byte === 0x0d || byte === 0x0a) {
      submit = true;
      break;
    }
    if (byte === 0x09 || byte === 0x0e) {
      selectedIndex = moveSelectionByDelta(selectedIndex, visibleResultCount, 1);
      continue;
    }
    if (byte === 0x10) {
      selectedIndex = moveSelectionByDelta(selectedIndex, visibleResultCount, -1);
      continue;
    }
    if (byte === 0x7f || byte === 0x08) {
      if (query.length > 0) {
        query = query.slice(0, -1);
        selectedIndex = 0;
      }
      continue;
    }
    if (byte >= 32 && byte <= 126) {
      query += String.fromCharCode(byte);
      selectedIndex = 0;
    }
  }

  return {
    nextState: {
      scope: state.scope,
      query,
      selectedIndex: clampSelectedIndex(selectedIndex, visibleResultCount),
    },
    submit,
  };
}

export function clampCommandMenuState(
  state: CommandMenuState,
  visibleResultCount: number,
): CommandMenuState {
  return {
    scope: state.scope,
    query: state.query,
    selectedIndex: clampSelectedIndex(state.selectedIndex, visibleResultCount),
  };
}

export class CommandMenuRegistry<TContext> {
  private readonly staticActions = new Map<string, RegisteredCommandMenuAction<TContext>>();
  private readonly providers = new Map<string, CommandMenuActionProvider<TContext>>();

  constructor() {}

  registerAction(action: RegisteredCommandMenuAction<TContext>): () => void {
    this.staticActions.set(action.id, action);
    return () => {
      this.staticActions.delete(action.id);
    };
  }

  registerProvider(providerId: string, provider: CommandMenuActionProvider<TContext>): () => void {
    this.providers.set(providerId, provider);
    return () => {
      this.providers.delete(providerId);
    };
  }

  resolveActions(context: TContext): readonly RegisteredCommandMenuAction<TContext>[] {
    const resolved: RegisteredCommandMenuAction<TContext>[] = [];
    const seenIds = new Set<string>();
    for (const action of this.staticActions.values()) {
      if (action.when !== undefined && !action.when(context)) {
        continue;
      }
      resolved.push(action);
      seenIds.add(action.id);
    }
    for (const provider of this.providers.values()) {
      for (const action of provider(context)) {
        if (seenIds.has(action.id)) {
          continue;
        }
        if (action.when !== undefined && !action.when(context)) {
          continue;
        }
        resolved.push(action);
        seenIds.add(action.id);
      }
    }
    return resolved;
  }
}
