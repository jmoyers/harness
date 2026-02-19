import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveHarnessConfigDirectory } from './config-core.ts';

interface HarnessSecretEntry {
  readonly key: string;
  readonly value: string;
}

interface LoadHarnessSecretsOptions {
  readonly cwd?: string;
  readonly filePath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly overrideExisting?: boolean;
}

interface LoadedHarnessSecrets {
  readonly filePath: string;
  readonly loaded: boolean;
  readonly loadedKeys: readonly string[];
  readonly skippedKeys: readonly string[];
}

interface UpsertHarnessSecretOptions {
  readonly key: string;
  readonly value: string;
  readonly cwd?: string;
  readonly filePath?: string;
  readonly env?: NodeJS.ProcessEnv;
}

interface UpsertHarnessSecretResult {
  readonly filePath: string;
  readonly createdFile: boolean;
  readonly replacedExisting: boolean;
}

function isValidSecretKey(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value);
}

function decodeDoubleQuotedValue(raw: string, _lineNumber: number): string {
  let out = '';
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const escaped = raw[index + 1]!;
    if (escaped === 'n') {
      out += '\n';
      index += 1;
      continue;
    }
    if (escaped === 'r') {
      out += '\r';
      index += 1;
      continue;
    }
    if (escaped === 't') {
      out += '\t';
      index += 1;
      continue;
    }
    if (escaped === '"' || escaped === '\\') {
      out += escaped;
      index += 1;
      continue;
    }
    out += `\\${escaped}`;
    index += 1;
  }
  return out;
}

function parseLineValue(rawValue: string, lineNumber: number): string {
  if (rawValue.length === 0) {
    return '';
  }
  if (rawValue.startsWith('"')) {
    let closingIndex = -1;
    let escaped = false;
    for (let index = 1; index < rawValue.length; index += 1) {
      const char = rawValue[index]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        closingIndex = index;
        break;
      }
    }
    if (closingIndex < 0) {
      throw new Error(`unterminated double-quoted value on line ${String(lineNumber)}`);
    }
    const trailing = rawValue.slice(closingIndex + 1);
    if (!/^\s*(#.*)?$/u.test(trailing)) {
      throw new Error(`unexpected trailing content on line ${String(lineNumber)}`);
    }
    return decodeDoubleQuotedValue(rawValue.slice(1, closingIndex), lineNumber);
  }
  if (rawValue.startsWith("'")) {
    const closingIndex = rawValue.indexOf("'", 1);
    if (closingIndex < 0) {
      throw new Error(`unterminated single-quoted value on line ${String(lineNumber)}`);
    }
    const trailing = rawValue.slice(closingIndex + 1);
    if (!/^\s*(#.*)?$/u.test(trailing)) {
      throw new Error(`unexpected trailing content on line ${String(lineNumber)}`);
    }
    return rawValue.slice(1, closingIndex);
  }
  return rawValue.replace(/\s+#.*$/u, '').trim();
}

function parseSecretLineKey(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return null;
  }
  const withoutExport = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length).trimStart()
    : trimmed;
  const equalIndex = withoutExport.indexOf('=');
  if (equalIndex <= 0) {
    return null;
  }
  const key = withoutExport.slice(0, equalIndex).trim();
  return isValidSecretKey(key) ? key : null;
}

function encodeSecretValue(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  if (/^[A-Za-z0-9._:@/+,-]+$/u.test(value)) {
    return value;
  }
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
  return `"${escaped}"`;
}

function parseHarnessSecretLine(line: string, lineNumber: number): HarnessSecretEntry | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return null;
  }
  const withoutExport = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length).trimStart()
    : trimmed;
  const equalIndex = withoutExport.indexOf('=');
  if (equalIndex <= 0) {
    throw new Error(`invalid secret entry on line ${String(lineNumber)}: expected KEY=VALUE`);
  }
  const key = withoutExport.slice(0, equalIndex).trim();
  if (!isValidSecretKey(key)) {
    throw new Error(`invalid secret key on line ${String(lineNumber)}: ${key}`);
  }
  const rawValue = withoutExport.slice(equalIndex + 1).trim();
  return {
    key,
    value: parseLineValue(rawValue, lineNumber),
  };
}

export function parseHarnessSecretsText(text: string): Readonly<Record<string, string>> {
  const entries: Record<string, string> = {};
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const parsed = parseHarnessSecretLine(line, index + 1);
    if (parsed === null) {
      continue;
    }
    entries[parsed.key] = parsed.value;
  }
  return entries;
}

export function resolveHarnessSecretsPath(
  cwd: string,
  filePath?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof filePath === 'string' && filePath.trim().length > 0) {
    return resolve(cwd, filePath);
  }
  return resolve(resolveHarnessConfigDirectory(cwd, env), 'secrets.env');
}

export function loadHarnessSecrets(options: LoadHarnessSecretsOptions = {}): LoadedHarnessSecrets {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const filePath = resolveHarnessSecretsPath(cwd, options.filePath, env);
  const overrideExisting = options.overrideExisting ?? false;
  if (!existsSync(filePath)) {
    return {
      filePath,
      loaded: false,
      loadedKeys: [],
      skippedKeys: [],
    };
  }
  const parsed = parseHarnessSecretsText(readFileSync(filePath, 'utf8'));
  const loadedKeys: string[] = [];
  const skippedKeys: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!overrideExisting && Object.prototype.hasOwnProperty.call(env, key)) {
      skippedKeys.push(key);
      continue;
    }
    env[key] = value;
    loadedKeys.push(key);
  }
  return {
    filePath,
    loaded: true,
    loadedKeys,
    skippedKeys,
  };
}

export function upsertHarnessSecret(
  options: UpsertHarnessSecretOptions,
): UpsertHarnessSecretResult {
  const key = options.key.trim();
  if (!isValidSecretKey(key)) {
    throw new Error(`invalid secret key: ${options.key}`);
  }
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const filePath = resolveHarnessSecretsPath(cwd, options.filePath, env);
  const hadFile = existsSync(filePath);
  const existingText = hadFile ? readFileSync(filePath, 'utf8') : '';
  const sourceLines = existingText.split(/\r?\n/u);
  if (sourceLines[sourceLines.length - 1] === '') {
    sourceLines.pop();
  }
  const nextLines: string[] = [];
  const encoded = encodeSecretValue(options.value);
  let replacedExisting = false;
  for (const line of sourceLines) {
    const lineKey = parseSecretLineKey(line);
    if (lineKey !== key) {
      nextLines.push(line);
      continue;
    }
    if (!replacedExisting) {
      nextLines.push(`${key}=${encoded}`);
      replacedExisting = true;
    }
  }
  if (!replacedExisting) {
    nextLines.push(`${key}=${encoded}`);
  }
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${String(process.pid)}`;
  writeFileSync(tempPath, `${nextLines.join('\n')}\n`, 'utf8');
  renameSync(tempPath, filePath);
  return {
    filePath,
    createdFile: !hadFile,
    replacedExisting,
  };
}
