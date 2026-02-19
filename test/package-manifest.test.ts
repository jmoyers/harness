import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

interface PackageJsonShape {
  readonly files?: readonly string[];
}

function normalizeManifestPath(path: string): string {
  if (path.startsWith('./')) {
    return path.slice(2);
  }
  return path;
}

function isPathPublished(files: readonly string[], targetPath: string): boolean {
  const normalizedTarget = normalizeManifestPath(targetPath);
  for (const entry of files) {
    const normalizedEntry = normalizeManifestPath(entry).replace(/\/+$/u, '');
    if (
      normalizedTarget === normalizedEntry ||
      normalizedTarget.startsWith(`${normalizedEntry}/`)
    ) {
      return true;
    }
  }
  return false;
}

function extractRelativeSpecifiers(source: string): string[] {
  const results: string[] = [];
  const importFromPattern = /\b(?:import|export)\s+[^'"]*?\sfrom\s+['"](\.[^'"]+)['"]/gu;
  const dynamicImportPattern = /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/gu;
  for (const pattern of [importFromPattern, dynamicImportPattern]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        results.push(specifier);
      }
    }
  }
  return results;
}

function resolveLocalImport(fromPath: string, specifier: string): string | null {
  const fromAbsolutePath = resolve(process.cwd(), fromPath);
  const candidatePath = resolve(dirname(fromAbsolutePath), specifier);
  const explicitCandidates = [candidatePath, `${candidatePath}.ts`, `${candidatePath}.js`];
  for (const candidate of explicitCandidates) {
    if (existsSync(candidate)) {
      return normalizeManifestPath(relative(process.cwd(), candidate));
    }
  }
  return null;
}

test('package publish manifest covers local relative imports for published script entries', () => {
  const packageJsonPath = resolve(process.cwd(), 'package.json');
  const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJsonShape;
  const files = parsed.files ?? [];
  const scriptEntries = files
    .map((entry) => normalizeManifestPath(entry))
    .filter(
      (entry) => entry.startsWith('scripts/') && (entry.endsWith('.ts') || entry.endsWith('.js')),
    );
  assert.equal(
    scriptEntries.length > 0,
    true,
    'package.json files has no published script entries',
  );

  const visited = new Set<string>();
  const queue = [...scriptEntries];
  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (currentPath === undefined || visited.has(currentPath)) {
      continue;
    }
    visited.add(currentPath);
    const absolutePath = resolve(process.cwd(), currentPath);
    const source = readFileSync(absolutePath, 'utf8');
    const relativeSpecifiers = extractRelativeSpecifiers(source);
    for (const specifier of relativeSpecifiers) {
      const resolved = resolveLocalImport(currentPath, specifier);
      assert.notEqual(
        resolved,
        null,
        `cannot resolve local import "${specifier}" from published file ${currentPath}`,
      );
      const resolvedPath = resolved as string;
      assert.equal(
        isPathPublished(files, resolvedPath),
        true,
        `published file ${currentPath} depends on local path missing from package files: ${resolvedPath}`,
      );
      if (visited.has(resolvedPath) === false) {
        queue.push(resolvedPath);
      }
    }
  }
});
