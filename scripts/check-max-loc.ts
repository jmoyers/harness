import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

interface CliOptions {
  root: string;
  maxLoc: number;
  json: boolean;
  enforce: boolean;
  baselinePath: string | null;
}

interface FileLoc {
  path: string;
  lines: number;
  loc: number;
}

interface VerifyReport {
  root: string;
  maxLoc: number;
  checkedFiles: number;
  violations: FileLoc[];
  enforce: boolean;
}

interface LocBaseline {
  allow: Record<string, number>;
}

interface BaselineEvaluation {
  effectiveViolations: FileLoc[];
  toleratedViolations: FileLoc[];
  baselinePath: string | null;
}

const DEFAULT_MAX_LOC = 2000;

const EXCLUDED_DIRS = new Set<string>([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.harness',
  'target',
  'out',
]);

const SUPPORTED_EXTENSIONS = new Set<string>([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.rs',
  '.py',
  '.go',
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.swift',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cxx',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.lua',
  '.dart',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.sql',
]);

function usage(): string {
  return [
    'Usage: bun scripts/check-max-loc.ts [--max-loc <number>] [--root <path>] [--json] [--enforce] [--baseline <path>]',
    '',
    'Reports files with LOC strictly greater than --max-loc.',
    'Use --enforce to fail when violations are present.',
    'Use --baseline with --enforce to allow a frozen set of known violations while preventing new ones and LOC growth.',
    'LOC is counted as non-empty lines.',
  ].join('\n');
}

function parsePositiveInt(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`invalid ${flagName} value: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let root = process.cwd();
  let maxLoc = DEFAULT_MAX_LOC;
  let json = false;
  let enforce = false;
  let baselinePath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === '--root') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --root');
      }
      root = resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--max-loc') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --max-loc');
      }
      maxLoc = parsePositiveInt(value, '--max-loc');
      index += 1;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--enforce') {
      enforce = true;
      continue;
    }
    if (arg === '--baseline') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --baseline');
      }
      baselinePath = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return {
    root,
    maxLoc,
    json,
    enforce,
    baselinePath,
  };
}

function readBaseline(baselinePath: string): LocBaseline {
  const raw = readFileSync(baselinePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`invalid baseline file: ${baselinePath}`);
  }
  const allowValue = (parsed as { allow?: unknown }).allow;
  if (typeof allowValue !== 'object' || allowValue === null || Array.isArray(allowValue)) {
    throw new Error(`invalid baseline file (missing allow object): ${baselinePath}`);
  }

  const allow: Record<string, number> = {};
  for (const [rawPath, rawMaxLoc] of Object.entries(allowValue)) {
    if (rawPath.trim().length === 0) {
      throw new Error(`invalid baseline file (empty path): ${baselinePath}`);
    }
    if (
      typeof rawMaxLoc !== 'number' ||
      !Number.isFinite(rawMaxLoc) ||
      !Number.isInteger(rawMaxLoc) ||
      rawMaxLoc < 1
    ) {
      throw new Error(
        `invalid baseline file (max LOC must be a positive integer for "${rawPath}"): ${baselinePath}`,
      );
    }
    const normalizedPath = rawPath.replaceAll('\\', '/');
    allow[normalizedPath] = rawMaxLoc;
  }

  return { allow };
}

function evaluateViolationsAgainstBaseline(
  violations: readonly FileLoc[],
  baselinePath: string | null,
): BaselineEvaluation {
  if (baselinePath === null) {
    return {
      effectiveViolations: [...violations],
      toleratedViolations: [],
      baselinePath: null,
    };
  }

  const baseline = readBaseline(baselinePath);
  const effectiveViolations: FileLoc[] = [];
  const toleratedViolations: FileLoc[] = [];

  for (const violation of violations) {
    const allowedLoc = baseline.allow[violation.path];
    if (allowedLoc !== undefined && violation.loc <= allowedLoc) {
      toleratedViolations.push(violation);
      continue;
    }
    effectiveViolations.push(violation);
  }

  return {
    effectiveViolations,
    toleratedViolations,
    baselinePath,
  };
}

function shouldIncludeFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function walkCodeFiles(rootPath: string): string[] {
  const files: string[] = [];
  const directories: string[] = [rootPath];
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory === undefined) {
      continue;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        directories.push(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const filePath = join(directory, entry.name);
      if (shouldIncludeFile(filePath)) {
        files.push(filePath);
      }
    }
  }
  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function countFileLoc(content: string): { lines: number; loc: number } {
  if (content.length === 0) {
    return { lines: 0, loc: 0 };
  }
  const rows = content.split(/\r?\n/u);
  let loc = 0;
  for (const row of rows) {
    if (row.trim().length > 0) {
      loc += 1;
    }
  }
  return {
    lines: rows.length,
    loc,
  };
}

function compareByLocThenPath(left: FileLoc, right: FileLoc): number {
  if (left.loc !== right.loc) {
    return right.loc - left.loc;
  }
  return left.path.localeCompare(right.path);
}

function buildVerifyReport(rootPath: string, maxLoc: number, enforce: boolean): VerifyReport {
  const files = walkCodeFiles(rootPath);
  const violations: FileLoc[] = [];
  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf8');
    const counts = countFileLoc(content);
    if (counts.loc > maxLoc) {
      violations.push({
        path: relative(rootPath, filePath).replaceAll('\\', '/'),
        lines: counts.lines,
        loc: counts.loc,
      });
    }
  }
  violations.sort(compareByLocThenPath);
  return {
    root: rootPath,
    maxLoc,
    checkedFiles: files.length,
    violations,
    enforce,
  };
}

function renderSuccess(report: VerifyReport, evaluation?: BaselineEvaluation): string {
  const mode = report.enforce ? 'enforced' : 'advisory';
  if (evaluation !== undefined && evaluation.toleratedViolations.length > 0) {
    return `LOC verify (${mode}) passed: ${evaluation.toleratedViolations.length} baseline violation(s) tolerated; no new violations or LOC growth (checked ${report.checkedFiles} files).\n`;
  }
  return `LOC verify (${mode}) passed: ${report.checkedFiles} source files are <= ${report.maxLoc} non-empty LOC.\n`;
}

function renderAdvisory(report: VerifyReport): string {
  const lines: string[] = [];
  lines.push(
    `LOC verify advisory: ${report.violations.length} source files exceed ${report.maxLoc} non-empty LOC (checked ${report.checkedFiles} files).`,
  );
  lines.push('');
  lines.push('Violations:');
  for (const violation of report.violations) {
    lines.push(
      `- ${violation.path} (loc=${violation.loc}, lines=${violation.lines}, limit=${report.maxLoc})`,
    );
  }
  lines.push('');
  lines.push('Refactor guidance for agent-authored changes:');
  lines.push('- Split by responsibility, not by existing file boundaries.');
  lines.push('- Prefer clear module seams: domain vs service vs UI.');
  lines.push('- Favor class-based design where it improves ownership and lifecycle clarity.');
  lines.push('- DRY repeated logic before adding new branches or duplicate handlers.');
  lines.push('- Keep code human-friendly: clear names, short functions, readable control flow.');
  lines.push('');
  lines.push('No failure because --enforce was not set.');
  lines.push('Use: bun scripts/check-max-loc.ts --max-loc <number> --enforce');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderFailure(report: VerifyReport): string {
  const lines: string[] = [];
  lines.push(
    `LOC verify failed: ${report.violations.length} source files exceed ${report.maxLoc} non-empty LOC (checked ${report.checkedFiles} files).`,
  );
  lines.push('');
  lines.push('Violations:');
  for (const violation of report.violations) {
    lines.push(
      `- ${violation.path} (loc=${violation.loc}, lines=${violation.lines}, limit=${report.maxLoc})`,
    );
  }
  lines.push('');
  lines.push('Refactor guidance for agent-authored changes:');
  lines.push('- Split by responsibility, not by existing file boundaries.');
  lines.push('- Prefer clear module seams: domain vs service vs UI.');
  lines.push('- Favor class-based design where it improves ownership and lifecycle clarity.');
  lines.push('- DRY repeated logic before adding new branches or duplicate handlers.');
  lines.push('- Extract core functionality into focused modules with explicit interfaces.');
  lines.push('- Build better abstractions around stable domain seams instead of adding flags.');
  lines.push('- Keep code human-friendly: clear names, short functions, readable control flow.');
  lines.push(
    '- Treat exposed APIs as library-grade: typed, coherent, and consistent with project and open-source standards.',
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main(): number {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.stderr.write(`${usage()}\n`);
    return 1;
  }

  const report = buildVerifyReport(options.root, options.maxLoc, options.enforce);
  let evaluation: BaselineEvaluation;
  try {
    evaluation = evaluateViolationsAgainstBaseline(report.violations, options.baselinePath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    return 1;
  }

  const effectiveReport: VerifyReport = {
    ...report,
    violations: evaluation.effectiveViolations,
  };

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ...report,
          baselinePath: evaluation.baselinePath,
          toleratedViolations: evaluation.toleratedViolations,
          effectiveViolations: evaluation.effectiveViolations,
        },
        null,
        2,
      )}\n`,
    );
  } else if (effectiveReport.violations.length === 0) {
    process.stdout.write(renderSuccess(report, evaluation));
  } else if (effectiveReport.enforce) {
    process.stderr.write(renderFailure(effectiveReport));
  } else {
    process.stdout.write(renderAdvisory(report));
  }

  if (effectiveReport.violations.length === 0) {
    return 0;
  }
  return effectiveReport.enforce ? 1 : 0;
}

process.exitCode = main();
