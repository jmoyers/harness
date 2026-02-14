import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';

type CodeKind = 'regular' | 'tests';

interface Counts {
  files: number;
  lines: number;
  loc: number;
}

interface ReportJson {
  root: string;
  totals: Counts;
  byKind: Record<CodeKind, Counts>;
  byLanguage: Record<string, Counts>;
  byKindLanguage: Record<CodeKind, Record<string, Counts>>;
}

interface CliOptions {
  json: boolean;
  root: string;
}

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
  'out'
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.rs': 'Rust',
  '.py': 'Python',
  '.go': 'Go',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.scala': 'Scala',
  '.swift': 'Swift',
  '.c': 'C',
  '.h': 'C/C++',
  '.cc': 'C/C++',
  '.cpp': 'C/C++',
  '.cxx': 'C/C++',
  '.hpp': 'C/C++',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.lua': 'Lua',
  '.dart': 'Dart',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.ps1': 'PowerShell',
  '.sql': 'SQL'
};

const SUPPORTED_EXTENSIONS = new Set<string>(Object.keys(LANGUAGE_BY_EXTENSION));

function usage(): string {
  return [
    'Usage: node --experimental-strip-types scripts/loc-report.ts [--json] [--root <path>]',
    '',
    'Reports code volume split by regular/tests/language.',
    'Only known code extensions are counted.'
  ].join('\n');
}

function createCounts(): Counts {
  return { files: 0, lines: 0, loc: 0 };
}

function addCounts(target: Counts, delta: Counts): void {
  target.files += delta.files;
  target.lines += delta.lines;
  target.loc += delta.loc;
}

function parseArgs(argv: string[]): CliOptions | null {
  let json = false;
  let root = process.cwd();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--root') {
      const value = argv[index + 1];
      if (value === undefined) {
        process.stderr.write('missing value for --root\n');
        return null;
      }
      root = resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exitCode = 0;
      return null;
    }
    process.stderr.write(`unknown argument: ${arg}\n`);
    return null;
  }

  return { json, root };
}

function shouldIncludeFile(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(extension);
}

function walkCodeFiles(rootPath: string): string[] {
  const files: string[] = [];
  const directories: string[] = [rootPath];

  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory === undefined) {
      continue;
    }

    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        directories.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (shouldIncludeFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function countLines(content: string): Counts {
  if (content.length === 0) {
    return { files: 1, lines: 0, loc: 0 };
  }
  const rows = content.split(/\r?\n/u);
  let loc = 0;
  for (const row of rows) {
    if (row.trim().length > 0) {
      loc += 1;
    }
  }
  return { files: 1, lines: rows.length, loc };
}

function classifyCodeKind(relativePath: string): CodeKind {
  const normalized = relativePath.replaceAll('\\', '/').toLowerCase();
  const name = basename(normalized);

  if (
    normalized.startsWith('test/') ||
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/__tests__/')
  ) {
    return 'tests';
  }

  if (/\.(test|spec)\.[^.]+$/u.test(name) || /_test\.[^.]+$/u.test(name)) {
    return 'tests';
  }

  return 'regular';
}

function languageForFile(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  const language = LANGUAGE_BY_EXTENSION[extension];
  if (language !== undefined) {
    return language;
  }
  return extension.length > 0 ? extension.slice(1).toUpperCase() : 'Unknown';
}

function compareLanguageRows(left: [string, Counts], right: [string, Counts]): number {
  if (left[1].loc !== right[1].loc) {
    return right[1].loc - left[1].loc;
  }
  return left[0].localeCompare(right[0]);
}

function renderCounts(label: string, counts: Counts): string {
  return `${label}: files=${counts.files} loc=${counts.loc} lines=${counts.lines}`;
}

function buildReport(rootPath: string): ReportJson {
  const totals = createCounts();
  const byKind: Record<CodeKind, Counts> = {
    regular: createCounts(),
    tests: createCounts()
  };
  const byLanguage = new Map<string, Counts>();
  const byKindLanguage = new Map<CodeKind, Map<string, Counts>>([
    ['regular', new Map<string, Counts>()],
    ['tests', new Map<string, Counts>()]
  ]);

  const files = walkCodeFiles(rootPath);
  for (const filePath of files) {
    const relPath = relative(rootPath, filePath);
    const codeKind = classifyCodeKind(relPath);
    const language = languageForFile(filePath);

    const content = readFileSync(filePath, 'utf8');
    const counts = countLines(content);

    addCounts(totals, counts);
    addCounts(byKind[codeKind], counts);

    const languageTotal = byLanguage.get(language) ?? createCounts();
    addCounts(languageTotal, counts);
    byLanguage.set(language, languageTotal);

    const kindLanguageMap = byKindLanguage.get(codeKind);
    if (kindLanguageMap === undefined) {
      continue;
    }
    const kindLanguageTotal = kindLanguageMap.get(language) ?? createCounts();
    addCounts(kindLanguageTotal, counts);
    kindLanguageMap.set(language, kindLanguageTotal);
  }

  const languageRecord: Record<string, Counts> = {};
  for (const [language, counts] of [...byLanguage.entries()].sort(compareLanguageRows)) {
    languageRecord[language] = counts;
  }

  const byKindLanguageRecord: Record<CodeKind, Record<string, Counts>> = {
    regular: {},
    tests: {}
  };
  for (const kind of ['regular', 'tests'] as const) {
    const rows = [...(byKindLanguage.get(kind)?.entries() ?? [])].sort(compareLanguageRows);
    for (const [language, counts] of rows) {
      byKindLanguageRecord[kind][language] = counts;
    }
  }

  return {
    root: rootPath,
    totals,
    byKind,
    byLanguage: languageRecord,
    byKindLanguage: byKindLanguageRecord
  };
}

function renderHuman(report: ReportJson): string {
  const lines: string[] = [];
  lines.push(`LOC report (${report.root})`);
  lines.push(renderCounts('total', report.totals));
  lines.push('');
  lines.push('by kind');
  lines.push(renderCounts('regular', report.byKind.regular));
  lines.push(renderCounts('tests', report.byKind.tests));
  lines.push('');
  lines.push('by language (all code)');
  for (const [language, counts] of Object.entries(report.byLanguage)) {
    lines.push(renderCounts(language, counts));
  }
  lines.push('');
  lines.push('by kind + language');
  for (const kind of ['regular', 'tests'] as const) {
    lines.push(`${kind}:`);
    const rows = Object.entries(report.byKindLanguage[kind]);
    if (rows.length === 0) {
      lines.push('none');
      continue;
    }
    for (const [language, counts] of rows) {
      lines.push(renderCounts(language, counts));
    }
  }
  return `${lines.join('\n')}\n`;
}

function main(): number {
  const options = parseArgs(process.argv.slice(2));
  if (options === null) {
    if (process.exitCode === undefined) {
      process.stderr.write(`${usage()}\n`);
      return 1;
    }
    return process.exitCode;
  }

  const report = buildReport(options.root);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderHuman(report));
  }

  return 0;
}

process.exitCode = main();
