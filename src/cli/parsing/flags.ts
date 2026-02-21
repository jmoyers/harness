export function readCliValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

export function parsePortFlag(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`invalid ${flag} value: ${value}`);
  }
  return parsed;
}

export function parsePositiveIntFlag(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`invalid ${flag} value: ${value}`);
  }
  return parsed;
}
