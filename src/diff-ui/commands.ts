import type { DiffUiCommand, DiffUiStateAction } from './types.ts';

export function parseDiffUiCommand(value: unknown): DiffUiCommand | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const type = record['type'];
  if (typeof type !== 'string') {
    return null;
  }

  if (type === 'view.setMode') {
    const mode = record['mode'];
    if (mode === 'auto' || mode === 'split' || mode === 'unified') {
      return { type, mode };
    }
    return null;
  }
  if (type === 'nav.scroll') {
    const delta = record['delta'];
    return typeof delta === 'number' && Number.isFinite(delta) ? { type, delta } : null;
  }
  if (type === 'nav.page') {
    const delta = record['delta'];
    return typeof delta === 'number' && Number.isFinite(delta) ? { type, delta } : null;
  }
  if (type === 'nav.gotoFile' || type === 'nav.gotoHunk') {
    const index = record['index'];
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      return null;
    }
    if (type === 'nav.gotoFile') {
      return { type, index };
    }
    return { type, index };
  }
  if (type === 'finder.open' || type === 'finder.close' || type === 'finder.accept') {
    return { type };
  }
  if (type === 'finder.query' || type === 'search.set') {
    const query = record['query'];
    if (typeof query !== 'string') {
      return null;
    }
    if (type === 'finder.query') {
      return { type, query };
    }
    return { type, query };
  }
  if (type === 'finder.move') {
    const delta = record['delta'];
    return typeof delta === 'number' && Number.isFinite(delta) ? { type, delta } : null;
  }
  if (type === 'session.quit') {
    return { type };
  }

  return null;
}

type DiffUiActionCommand = Exclude<DiffUiCommand, { readonly type: 'session.quit' }>;

export function diffUiCommandToStateAction(
  command: DiffUiActionCommand,
  pageSize: number,
): DiffUiStateAction {
  switch (command.type) {
    case 'view.setMode':
      return {
        type: 'view.setMode',
        mode: command.mode,
      };
    case 'nav.scroll':
      return {
        type: 'nav.scroll',
        delta: Math.trunc(command.delta),
      };
    case 'nav.page':
      return {
        type: 'nav.page',
        delta: Math.trunc(command.delta),
        pageSize,
      };
    case 'nav.gotoFile':
      return {
        type: 'nav.gotoFile',
        fileIndex: Math.trunc(command.index),
      };
    case 'nav.gotoHunk':
      return {
        type: 'nav.gotoHunk',
        hunkIndex: Math.trunc(command.index),
      };
    case 'finder.open':
      return {
        type: 'finder.open',
      };
    case 'finder.close':
      return {
        type: 'finder.close',
      };
    case 'finder.query':
      return {
        type: 'finder.query',
        query: command.query,
      };
    case 'finder.move':
      return {
        type: 'finder.move',
        delta: Math.trunc(command.delta),
      };
    case 'finder.accept':
      return {
        type: 'finder.accept',
      };
    case 'search.set':
      return {
        type: 'search.set',
        query: command.query,
      };
  }
}
