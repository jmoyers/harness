import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import ts from 'typescript';

type MetricKey = 'lines' | 'functions' | 'branches';

interface Thresholds {
  lines: number;
  functions: number;
  branches: number;
}

interface CoverageCheckConfig {
  include: string[];
  exclude: string[];
  global: Thresholds;
  perFileDefault: Thresholds;
  perFile: Record<string, Partial<Thresholds>>;
}

interface CoverageRecord {
  filePath: string;
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
  functionDetailFound: number;
  functionDetailHit: number;
  branchesFound: number;
  branchesHit: number;
  uncoveredLines: Set<number>;
  uncoveredBranches: Set<string>;
}

interface ParsedArgs {
  lcovPath: string;
  configPath: string;
}

const DEFAULT_THRESHOLDS: Thresholds = {
  lines: 100,
  functions: 100,
  branches: 100,
};

const DEFAULT_CONFIG: CoverageCheckConfig = {
  include: ['src/**/*.ts'],
  exclude: [],
  global: DEFAULT_THRESHOLDS,
  perFileDefault: DEFAULT_THRESHOLDS,
  perFile: {},
};

function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function normalizeRelativePath(value: string): string {
  const normalized = toPosixPath(value).replace(/^\.\/+/u, '');
  return normalized;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let lcovPath = '.harness/coverage-bun/lcov.info';
  let configPath = 'harness.coverage.jsonc';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--lcov') {
      const next = argv[index + 1];
      if (next === undefined) {
        throw new Error('missing value for --lcov');
      }
      lcovPath = next;
      index += 1;
      continue;
    }
    if (arg === '--config') {
      const next = argv[index + 1];
      if (next === undefined) {
        throw new Error('missing value for --config');
      }
      configPath = next;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return {
    lcovPath,
    configPath,
  };
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected object for ${context}`);
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`expected array for ${context}`);
  }
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error(`expected string entries for ${context}`);
    }
    output.push(normalizeRelativePath(entry));
  }
  return output;
}

function parseThresholds(value: unknown, context: string, fallback: Thresholds): Thresholds {
  if (value === undefined) {
    return fallback;
  }
  const source = asRecord(value, context);
  const read = (key: MetricKey): number => {
    const candidate = source[key];
    if (candidate === undefined) {
      return fallback[key];
    }
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
      throw new Error(`expected finite number for ${context}.${key}`);
    }
    if (candidate < 0 || candidate > 100) {
      throw new Error(`expected ${context}.${key} in range 0..100`);
    }
    return candidate;
  };
  return {
    lines: read('lines'),
    functions: read('functions'),
    branches: read('branches'),
  };
}

function loadConfig(configPath: string): CoverageCheckConfig {
  const resolved = resolve(configPath);
  if (!existsSync(resolved)) {
    return DEFAULT_CONFIG;
  }
  const text = readFileSync(resolved, 'utf8');
  const parsedResult = ts.parseConfigFileTextToJson(resolved, text);
  if (parsedResult.error !== undefined) {
    const message = ts.flattenDiagnosticMessageText(parsedResult.error.messageText, '\n');
    throw new Error(`failed to parse ${configPath}: ${message}`);
  }
  const root = asRecord(parsedResult.config, 'coverage config');
  const include =
    root.include === undefined ? DEFAULT_CONFIG.include : asStringArray(root.include, 'include');
  const exclude =
    root.exclude === undefined ? DEFAULT_CONFIG.exclude : asStringArray(root.exclude, 'exclude');
  const global = parseThresholds(root.global, 'global', DEFAULT_CONFIG.global);
  const perFileDefault = parseThresholds(
    root.perFileDefault,
    'perFileDefault',
    DEFAULT_CONFIG.perFileDefault,
  );
  const perFile: Record<string, Partial<Thresholds>> = {};
  if (root.perFile !== undefined) {
    const entries = asRecord(root.perFile, 'perFile');
    for (const [filePath, thresholdValue] of Object.entries(entries)) {
      perFile[normalizeRelativePath(filePath)] = parseThresholds(
        thresholdValue,
        `perFile.${filePath}`,
        perFileDefault,
      );
    }
  }
  return {
    include,
    exclude,
    global,
    perFileDefault,
    perFile,
  };
}

function globPatternToRegExp(pattern: string): RegExp {
  const normalized = normalizeRelativePath(pattern);
  let expression = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === undefined) {
      continue;
    }
    if (char === '*') {
      const next = normalized[index + 1];
      if (next === '*') {
        expression += '.*';
        index += 1;
      } else {
        expression += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      expression += '[^/]';
      continue;
    }
    if ('\\.[]{}()+^$|'.includes(char)) {
      expression += `\\${char}`;
      continue;
    }
    expression += char;
  }
  expression += '$';
  return new RegExp(expression, 'u');
}

function collectPathsRecursive(rootDir: string, output: string[]): void {
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.harness') {
      continue;
    }
    const absolutePath = resolve(rootDir, entry.name);
    if (entry.isDirectory()) {
      collectPathsRecursive(absolutePath, output);
      continue;
    }
    if (entry.isFile() && absolutePath.endsWith('.ts')) {
      output.push(absolutePath);
    }
  }
}

function listTargetedFiles(config: CoverageCheckConfig): readonly string[] {
  const cwd = process.cwd();
  const candidates: string[] = [];
  const includeRoots = new Set<string>();
  for (const pattern of config.include) {
    const normalized = normalizeRelativePath(pattern);
    const wildcardIndex = normalized.search(/[*?]/u);
    if (wildcardIndex === -1) {
      const directPath = resolve(cwd, normalized);
      if (existsSync(directPath) && statSync(directPath).isFile()) {
        candidates.push(directPath);
      }
      continue;
    }
    const prefix = normalized.slice(0, wildcardIndex);
    const rootSegment = prefix.split('/').find((segment) => segment.length > 0) ?? '.';
    includeRoots.add(resolve(cwd, rootSegment));
  }
  for (const root of includeRoots) {
    if (existsSync(root) && statSync(root).isDirectory()) {
      collectPathsRecursive(root, candidates);
    }
  }
  const includePatterns = config.include.map((pattern) => globPatternToRegExp(pattern));
  const excludePatterns = config.exclude.map((pattern) => globPatternToRegExp(pattern));
  const targeted = new Set<string>();
  for (const absolutePath of candidates) {
    const relativePath = normalizeRelativePath(relative(cwd, absolutePath));
    if (!includePatterns.some((pattern) => pattern.test(relativePath))) {
      continue;
    }
    if (excludePatterns.some((pattern) => pattern.test(relativePath))) {
      continue;
    }
    targeted.add(relativePath);
  }
  return [...targeted].sort((left, right) => left.localeCompare(right));
}

function createEmptyCoverageRecord(filePath: string): CoverageRecord {
  return {
    filePath,
    linesFound: 0,
    linesHit: 0,
    functionsFound: 0,
    functionsHit: 0,
    functionDetailFound: 0,
    functionDetailHit: 0,
    branchesFound: 0,
    branchesHit: 0,
    uncoveredLines: new Set<number>(),
    uncoveredBranches: new Set<string>(),
  };
}

function parseLcov(lcovPath: string): Map<string, CoverageRecord> {
  const cwd = process.cwd();
  const resolved = resolve(lcovPath);
  if (!existsSync(resolved)) {
    throw new Error(`coverage report not found: ${lcovPath}`);
  }
  const text = readFileSync(resolved, 'utf8');
  const records = new Map<string, CoverageRecord>();
  let current: CoverageRecord | null = null;
  let functionDetailNames: Set<string> = new Set<string>();
  let functionDetailHitNames: Set<string> = new Set<string>();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith('SF:')) {
      const sfPath = line.slice(3);
      const absolutePath = isAbsolute(sfPath) ? resolve(sfPath) : resolve(cwd, sfPath);
      const relativePath = normalizeRelativePath(relative(cwd, absolutePath));
      current = createEmptyCoverageRecord(relativePath);
      functionDetailNames = new Set<string>();
      functionDetailHitNames = new Set<string>();
      continue;
    }
    if (line === 'end_of_record') {
      if (current !== null) {
        current.functionDetailFound = functionDetailNames.size;
        let functionDetailHit = 0;
        for (const functionName of functionDetailHitNames) {
          if (functionDetailNames.has(functionName)) {
            functionDetailHit += 1;
          }
        }
        current.functionDetailHit = functionDetailHit;
        records.set(current.filePath, current);
      }
      current = null;
      functionDetailNames = new Set<string>();
      functionDetailHitNames = new Set<string>();
      continue;
    }
    if (current === null) {
      continue;
    }
    if (line.startsWith('LF:')) {
      current.linesFound = Number.parseInt(line.slice(3), 10);
      continue;
    }
    if (line.startsWith('LH:')) {
      current.linesHit = Number.parseInt(line.slice(3), 10);
      continue;
    }
    if (line.startsWith('FNF:')) {
      current.functionsFound = Number.parseInt(line.slice(4), 10);
      continue;
    }
    if (line.startsWith('FNH:')) {
      current.functionsHit = Number.parseInt(line.slice(4), 10);
      continue;
    }
    if (line.startsWith('FN:')) {
      const rawName = line.slice(3).split(',')[1] ?? '';
      const functionName = rawName.trim();
      if (functionName.length > 0) {
        functionDetailNames.add(functionName);
      }
      continue;
    }
    if (line.startsWith('FNDA:')) {
      const [countText, rawName] = line.slice(5).split(',');
      const hits = Number.parseInt(countText ?? '', 10);
      const functionName = (rawName ?? '').trim();
      if (Number.isInteger(hits) && hits > 0 && functionName.length > 0) {
        functionDetailHitNames.add(functionName);
      }
      continue;
    }
    if (line.startsWith('BRF:')) {
      current.branchesFound = Number.parseInt(line.slice(4), 10);
      continue;
    }
    if (line.startsWith('BRH:')) {
      current.branchesHit = Number.parseInt(line.slice(4), 10);
      continue;
    }
    if (line.startsWith('DA:')) {
      const [lineText, hitsText] = line.slice(3).split(',');
      const lineNumber = Number.parseInt(lineText ?? '', 10);
      const hits = Number.parseInt(hitsText ?? '', 10);
      if (Number.isInteger(lineNumber) && Number.isInteger(hits) && hits === 0) {
        current.uncoveredLines.add(lineNumber);
      }
      continue;
    }
    if (line.startsWith('BRDA:')) {
      const [lineText, blockText, branchText, takenText] = line.slice(5).split(',');
      const lineNumber = Number.parseInt(lineText ?? '', 10);
      const taken = takenText ?? '-';
      const covered = taken !== '-' && Number.parseInt(taken, 10) > 0;
      if (!covered && Number.isInteger(lineNumber)) {
        current.uncoveredBranches.add(`${lineNumber}:${blockText ?? '0'}:${branchText ?? '0'}`);
      }
    }
  }
  return records;
}

function percent(hit: number, found: number): number {
  if (found === 0) {
    return 100;
  }
  return (hit / found) * 100;
}

function thresholdsForFile(filePath: string, config: CoverageCheckConfig): Thresholds {
  const override = config.perFile[filePath];
  if (override === undefined) {
    return config.perFileDefault;
  }
  return {
    lines: override.lines ?? config.perFileDefault.lines,
    functions: override.functions ?? config.perFileDefault.functions,
    branches: override.branches ?? config.perFileDefault.branches,
  };
}

function formatMetric(value: number): string {
  return value.toFixed(2);
}

function functionMetricForRecord(record: CoverageRecord): { found: number; hit: number } {
  if (record.functionDetailFound > 0) {
    return {
      found: record.functionDetailFound,
      hit: Math.min(record.functionDetailHit, record.functionDetailFound),
    };
  }
  return {
    found: 0,
    hit: 0,
  };
}

function main(): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const config = loadConfig(args.configPath);
  const targetedFiles = listTargetedFiles(config);
  if (targetedFiles.length === 0) {
    process.stderr.write('no files matched coverage include patterns\n');
    return 1;
  }
  const coverageByFile = parseLcov(args.lcovPath);
  const missingFiles: string[] = [];
  const perFileFailures: string[] = [];

  let globalLinesFound = 0;
  let globalLinesHit = 0;
  let globalFunctionsFound = 0;
  let globalFunctionsHit = 0;
  let globalBranchesFound = 0;
  let globalBranchesHit = 0;

  for (const filePath of targetedFiles) {
    const record = coverageByFile.get(filePath);
    if (record === undefined) {
      missingFiles.push(filePath);
      continue;
    }
    globalLinesFound += record.linesFound;
    globalLinesHit += record.linesHit;
    const functionMetric = functionMetricForRecord(record);
    globalFunctionsFound += functionMetric.found;
    globalFunctionsHit += functionMetric.hit;
    globalBranchesFound += record.branchesFound;
    globalBranchesHit += record.branchesHit;

    const thresholds = thresholdsForFile(filePath, config);
    const linesPct = percent(record.linesHit, record.linesFound);
    const functionsPct = percent(functionMetric.hit, functionMetric.found);
    const branchesPct = percent(record.branchesHit, record.branchesFound);

    const deficits: string[] = [];
    if (linesPct < thresholds.lines) {
      deficits.push(`lines ${formatMetric(linesPct)} < ${formatMetric(thresholds.lines)}`);
    }
    if (functionsPct < thresholds.functions) {
      deficits.push(
        `functions ${formatMetric(functionsPct)} < ${formatMetric(thresholds.functions)}`,
      );
    }
    if (branchesPct < thresholds.branches) {
      deficits.push(`branches ${formatMetric(branchesPct)} < ${formatMetric(thresholds.branches)}`);
    }
    if (deficits.length > 0) {
      const uncoveredLineList = [...record.uncoveredLines]
        .sort((left, right) => left - right)
        .join(',');
      const uncoveredBranchList = [...record.uncoveredBranches]
        .sort((left, right) => left.localeCompare(right))
        .join(',');
      perFileFailures.push(
        [
          `per-file threshold failed: ${filePath}`,
          `  deficits: ${deficits.join('; ')}`,
          `  uncovered lines: ${uncoveredLineList.length > 0 ? uncoveredLineList : '(none reported)'}`,
          `  uncovered branches (line:block:branch): ${
            uncoveredBranchList.length > 0 ? uncoveredBranchList : '(none reported)'
          }`,
        ].join('\n'),
      );
    }
  }

  const globalLinesPct = percent(globalLinesHit, globalLinesFound);
  const globalFunctionsPct = percent(globalFunctionsHit, globalFunctionsFound);
  const globalBranchesPct = percent(globalBranchesHit, globalBranchesFound);

  const globalFailures: string[] = [];
  if (globalLinesPct < config.global.lines) {
    globalFailures.push(
      `global lines ${formatMetric(globalLinesPct)} < ${formatMetric(config.global.lines)}`,
    );
  }
  if (globalFunctionsPct < config.global.functions) {
    globalFailures.push(
      `global functions ${formatMetric(globalFunctionsPct)} < ${formatMetric(config.global.functions)}`,
    );
  }
  if (globalBranchesPct < config.global.branches) {
    globalFailures.push(
      `global branches ${formatMetric(globalBranchesPct)} < ${formatMetric(config.global.branches)}`,
    );
  }

  const hasFailures =
    missingFiles.length > 0 || perFileFailures.length > 0 || globalFailures.length > 0;
  if (!hasFailures) {
    process.stdout.write(
      [
        `coverage check passed for ${targetedFiles.length} files`,
        `global lines=${formatMetric(globalLinesPct)} functions=${formatMetric(globalFunctionsPct)} branches=${formatMetric(globalBranchesPct)}`,
      ].join('\n') + '\n',
    );
    return 0;
  }

  if (missingFiles.length > 0) {
    process.stderr.write(
      `files missing from coverage report (${missingFiles.length}):\n${missingFiles.map((filePath) => `  ${filePath}`).join('\n')}\n`,
    );
  }
  if (globalFailures.length > 0) {
    process.stderr.write(`${globalFailures.join('\n')}\n`);
  }
  if (perFileFailures.length > 0) {
    process.stderr.write(`${perFileFailures.join('\n')}\n`);
  }
  return 1;
}

process.exitCode = main();
