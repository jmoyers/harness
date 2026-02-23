export type Color =
  | { readonly kind: 'default' }
  | { readonly kind: 'indexed'; readonly index: number }
  | { readonly kind: 'rgb'; readonly r: number; readonly g: number; readonly b: number };

export const DEFAULT_COLOR: Color = { kind: 'default' };

export function indexedColor(index: number): Color {
  return { kind: 'indexed', index: Math.max(0, Math.min(255, Math.floor(index))) };
}

export function rgbColor(r: number, g: number, b: number): Color {
  return {
    kind: 'rgb',
    r: clampByte(r),
    g: clampByte(g),
    b: clampByte(b),
  };
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.floor(value)));
}

function hexCharValue(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

export function parseHexColor(hex: string): Color | null {
  if (hex.length === 0) return null;
  const start = hex.charCodeAt(0) === 35 ? 1 : 0;
  const len = hex.length - start;

  if (len === 3 || len === 4) {
    const r = hexCharValue(hex[start]!);
    const g = hexCharValue(hex[start + 1]!);
    const b = hexCharValue(hex[start + 2]!);
    if (r < 0 || g < 0 || b < 0) return null;
    return rgbColor(r * 17, g * 17, b * 17);
  }

  if (len === 6 || len === 8) {
    const r1 = hexCharValue(hex[start]!);
    const r2 = hexCharValue(hex[start + 1]!);
    const g1 = hexCharValue(hex[start + 2]!);
    const g2 = hexCharValue(hex[start + 3]!);
    const b1 = hexCharValue(hex[start + 4]!);
    const b2 = hexCharValue(hex[start + 5]!);
    if (r1 < 0 || r2 < 0 || g1 < 0 || g2 < 0 || b1 < 0 || b2 < 0) return null;
    return rgbColor(r1 * 16 + r2, g1 * 16 + g2, b1 * 16 + b2);
  }

  return null;
}

export function colorEqual(a: Color, b: Color): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'default') return true;
  if (a.kind === 'indexed') return a.index === (b as Extract<Color, { kind: 'indexed' }>).index;
  const rb = b as Extract<Color, { kind: 'rgb' }>;
  return a.r === rb.r && a.g === rb.g && a.b === rb.b;
}

export function colorToHex(color: Color): string | null {
  if (color.kind === 'default') return null;
  if (color.kind === 'indexed') return null;
  const r = color.r.toString(16).padStart(2, '0');
  const g = color.g.toString(16).padStart(2, '0');
  const b = color.b.toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function colorSgrParams(color: Color, target: 'fg' | 'bg'): readonly string[] {
  const prefix = target === 'fg' ? '38' : '48';
  if (color.kind === 'default') return [target === 'fg' ? '39' : '49'];
  if (color.kind === 'indexed') return [prefix, '5', String(color.index)];
  return [prefix, '2', String(color.r), String(color.g), String(color.b)];
}

export interface CellStyle {
  readonly fg: Color;
  readonly bg: Color;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
}

export const DEFAULT_CELL_STYLE: CellStyle = {
  fg: DEFAULT_COLOR,
  bg: DEFAULT_COLOR,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
};

export function cellStyleEqual(a: CellStyle, b: CellStyle): boolean {
  return (
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse &&
    colorEqual(a.fg, b.fg) &&
    colorEqual(a.bg, b.bg)
  );
}

export function cellStyleToSgr(style: CellStyle): string {
  const codes: string[] = ['0'];
  if (style.bold) codes.push('1');
  if (style.dim) codes.push('2');
  if (style.italic) codes.push('3');
  if (style.underline) codes.push('4');
  if (style.inverse) codes.push('7');
  codes.push(...colorSgrParams(style.fg, 'fg'));
  codes.push(...colorSgrParams(style.bg, 'bg'));
  return `\u001b[${codes.join(';')}m`;
}
