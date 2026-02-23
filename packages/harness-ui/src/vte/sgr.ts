import {
  DEFAULT_COLOR,
  DEFAULT_CELL_STYLE,
  cloneColor,
  type TerminalColor,
  type TerminalCellStyle,
} from './types.ts';

export function colorToParams(color: TerminalColor, isBackground: boolean): number[] {
  if (color.kind === 'default') return [isBackground ? 49 : 39];
  if (color.kind === 'indexed') {
    if (color.index >= 0 && color.index <= 7) return [(isBackground ? 40 : 30) + color.index];
    if (color.index >= 8 && color.index <= 15)
      return [(isBackground ? 100 : 90) + (color.index - 8)];
    return [isBackground ? 48 : 38, 5, color.index];
  }
  return [isBackground ? 48 : 38, 2, color.r, color.g, color.b];
}

export function styleToAnsi(style: TerminalCellStyle): string {
  const params: number[] = [0];
  if (style.bold) params.push(1);
  if (style.dim) params.push(2);
  if (style.italic) params.push(3);
  if (style.underline) params.push(4);
  if (style.inverse) params.push(7);
  params.push(...colorToParams(style.fg, false));
  params.push(...colorToParams(style.bg, true));
  return `\u001b[${params.join(';')}m`;
}

export function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.trunc(value)));
}

export function parseOscHexComponent(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 4) return null;
  if (!/^[0-9A-Fa-f]+$/u.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 16);
  if (!Number.isFinite(parsed)) return null;
  const maxValue = (1 << (trimmed.length * 4)) - 1;
  if (maxValue <= 0) return null;
  return Math.round((parsed / maxValue) * 255);
}

export function parseOscRgbColor(value: string): { r: number; g: number; b: number } | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith('rgb:')) {
    const channels = trimmed.slice(4).split('/');
    if (channels.length !== 3) return null;
    const red = parseOscHexComponent(channels[0] ?? '');
    const green = parseOscHexComponent(channels[1] ?? '');
    const blue = parseOscHexComponent(channels[2] ?? '');
    if (red === null || green === null || blue === null) return null;
    return { r: red, g: green, b: blue };
  }

  if (trimmed.startsWith('#') && trimmed.length === 7) {
    const red = parseOscHexComponent(trimmed.slice(1, 3));
    const green = parseOscHexComponent(trimmed.slice(3, 5));
    const blue = parseOscHexComponent(trimmed.slice(5, 7));
    if (red === null || green === null || blue === null) return null;
    return { r: red, g: green, b: blue };
  }

  return null;
}

export function resolveIndexedColor(
  index: number,
  overrides: ReadonlyMap<number, { r: number; g: number; b: number }>,
): TerminalColor {
  const override = overrides.get(index);
  if (override !== undefined) return { kind: 'rgb', r: override.r, g: override.g, b: override.b };
  return { kind: 'indexed', index };
}

function mutableCloneStyle(style: TerminalCellStyle): TerminalCellStyle {
  return {
    bold: style.bold,
    dim: style.dim,
    italic: style.italic,
    underline: style.underline,
    inverse: style.inverse,
    fg: cloneColor(style.fg),
    bg: cloneColor(style.bg),
  };
}

export function applySgrParams(
  style: TerminalCellStyle,
  params: number[],
  overrides: ReadonlyMap<number, { r: number; g: number; b: number }>,
): TerminalCellStyle {
  let next = mutableCloneStyle(style);
  const queue = params.length === 0 ? [0] : [...params];

  for (let idx = 0; idx < queue.length; idx += 1) {
    const p = queue[idx]!;
    if (p === 0) {
      next = mutableCloneStyle(DEFAULT_CELL_STYLE);
      continue;
    }
    if (p === 1) {
      next.bold = true;
      continue;
    }
    if (p === 2) {
      next.dim = true;
      continue;
    }
    if (p === 3) {
      next.italic = true;
      continue;
    }
    if (p === 4) {
      next.underline = true;
      continue;
    }
    if (p === 7) {
      next.inverse = true;
      continue;
    }
    if (p === 21 || p === 22) {
      next.bold = false;
      next.dim = false;
      continue;
    }
    if (p === 23) {
      next.italic = false;
      continue;
    }
    if (p === 24) {
      next.underline = false;
      continue;
    }
    if (p === 27) {
      next.inverse = false;
      continue;
    }
    if (p >= 30 && p <= 37) {
      next.fg = resolveIndexedColor(p - 30, overrides);
      continue;
    }
    if (p >= 90 && p <= 97) {
      next.fg = resolveIndexedColor(8 + (p - 90), overrides);
      continue;
    }
    if (p === 39) {
      next.fg = DEFAULT_COLOR;
      continue;
    }
    if (p >= 40 && p <= 47) {
      next.bg = resolveIndexedColor(p - 40, overrides);
      continue;
    }
    if (p >= 100 && p <= 107) {
      next.bg = resolveIndexedColor(8 + (p - 100), overrides);
      continue;
    }
    if (p === 49) {
      next.bg = DEFAULT_COLOR;
      continue;
    }

    if (p !== 38 && p !== 48) continue;
    const isBg = p === 48;
    const mode = queue[idx + 1];
    if (mode === 5) {
      const value = queue[idx + 2];
      if (typeof value === 'number' && Number.isFinite(value)) {
        const resolved = resolveIndexedColor(clampColor(value), overrides);
        if (isBg) next.bg = resolved;
        else next.fg = resolved;
      }
      idx += 2;
      continue;
    }
    if (mode === 2) {
      const r = queue[idx + 2];
      const g = queue[idx + 3];
      const b = queue[idx + 4];
      if (
        typeof r === 'number' &&
        typeof g === 'number' &&
        typeof b === 'number' &&
        Number.isFinite(r) &&
        Number.isFinite(g) &&
        Number.isFinite(b)
      ) {
        const parsed: TerminalColor = {
          kind: 'rgb',
          r: clampColor(r),
          g: clampColor(g),
          b: clampColor(b),
        };
        if (isBg) next.bg = parsed;
        else next.fg = parsed;
      }
      idx += 4;
    }
  }
  return next;
}
