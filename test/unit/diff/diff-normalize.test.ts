import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  inferLanguageFromPath,
  isGeneratedPath,
  normalizeDiffPath,
  resolveFileChangeType,
} from '../../../src/diff/normalize.ts';

void test('normalize diff path handles null, dev-null, and prefixes', () => {
  assert.equal(normalizeDiffPath(null), null);
  assert.equal(normalizeDiffPath('/dev/null'), null);
  assert.equal(normalizeDiffPath(' src/main.ts '), 'src/main.ts');
});

void test('infer language from path supports common source extensions', () => {
  assert.equal(inferLanguageFromPath('src/main.ts'), 'typescript');
  assert.equal(inferLanguageFromPath('src/main.js'), 'javascript');
  assert.equal(inferLanguageFromPath('src/main.rs'), 'rust');
  assert.equal(inferLanguageFromPath('src/main.go'), 'go');
  assert.equal(inferLanguageFromPath('src/main.py'), 'python');
  assert.equal(inferLanguageFromPath('src/Main.java'), 'java');
  assert.equal(inferLanguageFromPath('src/Main.kt'), 'kotlin');
  assert.equal(inferLanguageFromPath('src/main.rb'), 'ruby');
  assert.equal(inferLanguageFromPath('src/main.c'), 'c');
  assert.equal(inferLanguageFromPath('src/main.cpp'), 'cpp');
  assert.equal(inferLanguageFromPath('src/main.json'), 'json');
  assert.equal(inferLanguageFromPath('src/main.jsonc'), 'jsonc');
  assert.equal(inferLanguageFromPath('README.md'), 'markdown');
  assert.equal(inferLanguageFromPath('config.yaml'), 'yaml');
  assert.equal(inferLanguageFromPath('config.toml'), 'toml');
  assert.equal(inferLanguageFromPath('scripts/main.sh'), 'shell');
  assert.equal(inferLanguageFromPath('schema.sql'), 'sql');
  assert.equal(inferLanguageFromPath('unknown.ext'), null);
  assert.equal(inferLanguageFromPath(null), null);
});

void test('generated path heuristics detect common generated artifacts', () => {
  assert.equal(isGeneratedPath('dist/index.js'), true);
  assert.equal(isGeneratedPath('build/index.js'), true);
  assert.equal(isGeneratedPath('coverage/lcov.info'), true);
  assert.equal(isGeneratedPath('.next/out.js'), true);
  assert.equal(isGeneratedPath('out/main.txt'), true);
  assert.equal(isGeneratedPath('vendor/pkg.txt'), true);
  assert.equal(isGeneratedPath('node_modules/pkg/index.js'), true);
  assert.equal(isGeneratedPath('src/app.min.js'), true);
  assert.equal(isGeneratedPath('src/app.min.css'), true);
  assert.equal(isGeneratedPath('bun.lock'), true);
  assert.equal(isGeneratedPath('deps.lock'), true);
  assert.equal(isGeneratedPath('src/model.generated.ts'), true);
  assert.equal(isGeneratedPath('src/model.gen.ts'), true);
  assert.equal(isGeneratedPath('src/index.ts'), false);
  assert.equal(isGeneratedPath(null), false);
});

void test('resolve file change type prefers explicit hint and fallback path state', () => {
  assert.equal(
    resolveFileChangeType({
      fromHeader: 'renamed',
      oldPath: 'a.ts',
      newPath: 'b.ts',
      isBinary: false,
    }),
    'renamed',
  );
  assert.equal(
    resolveFileChangeType({
      fromHeader: null,
      oldPath: null,
      newPath: 'new.ts',
      isBinary: false,
    }),
    'added',
  );
  assert.equal(
    resolveFileChangeType({
      fromHeader: null,
      oldPath: 'old.ts',
      newPath: null,
      isBinary: false,
    }),
    'deleted',
  );
  assert.equal(
    resolveFileChangeType({
      fromHeader: null,
      oldPath: 'a.ts',
      newPath: 'a.ts',
      isBinary: false,
    }),
    'modified',
  );
  assert.equal(
    resolveFileChangeType({
      fromHeader: null,
      oldPath: 'a.png',
      newPath: 'a.png',
      isBinary: true,
    }),
    'binary',
  );
});
