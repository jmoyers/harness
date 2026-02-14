import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  DEFAULT_HARNESS_CONFIG,
  HARNESS_CONFIG_FILE_NAME,
  loadHarnessConfig,
  parseHarnessConfigText,
  resolveHarnessConfigPath
} from '../src/config/config-core.ts';

void test('parseHarnessConfigText supports jsonc comments and trailing commas', () => {
  const parsed = parseHarnessConfigText(`
    {
      // comment
      "mux": {
        "keybindings": {
          "mux.conversation.next": "ctrl+j",
          "mux.conversation.previous": ["ctrl+k", "ctrl+p",],
          "bad.value": [true, "  ", "alt+n"]
        },
      },
    }
  `);

  assert.deepEqual(parsed.mux.keybindings, {
    'mux.conversation.next': ['ctrl+j'],
    'mux.conversation.previous': ['ctrl+k', 'ctrl+p'],
    'bad.value': ['alt+n']
  });
  assert.equal(parsed.perf.enabled, false);
  assert.equal(parsed.perf.filePath, '.harness/perf.jsonl');
});

void test('parseHarnessConfigText preserves escaped strings and ignores inline/block comment markers in strings', () => {
  const parsed = parseHarnessConfigText(`
    {
      "mux": {
        "keybindings": {
          "  ": "ctrl+x",
          "mux.conversation.new": "ctrl+\\\\",
          "mux.app.quit": "cmd+q // literal",
          "mux.conversation.next": ["shift+tab", 5, "ctrl+j"],
          "mux.conversation.previous": {"bad":"shape"},
          "mux.app.interrupt-all": "ctrl+\\"c\\"",
          "mux.literal": "text /* not a comment */ tail"
        }
      },
      "commentLike": "http://example.com//x",
      /* block comment */
      "escaped": "quote: \\" and slash: \\\\"
    }
  `);

  assert.deepEqual(parsed.mux.keybindings, {
    'mux.conversation.new': ['ctrl+\\'],
    'mux.app.quit': ['cmd+q // literal'],
    'mux.conversation.next': ['shift+tab', 'ctrl+j'],
    'mux.app.interrupt-all': ['ctrl+"c"'],
    'mux.literal': ['text /* not a comment */ tail']
  });
  assert.equal(parsed.perf.enabled, false);
  assert.equal(parsed.perf.filePath, '.harness/perf.jsonl');
});

void test('parseHarnessConfigText falls back for invalid root shapes', () => {
  assert.deepEqual(parseHarnessConfigText('[]'), DEFAULT_HARNESS_CONFIG);
  assert.deepEqual(parseHarnessConfigText('{"mux":[] }'), DEFAULT_HARNESS_CONFIG);
  assert.deepEqual(parseHarnessConfigText('{"mux":{"keybindings":"bad"}}'), {
    mux: {
      keybindings: {}
    },
    perf: {
      enabled: false,
      filePath: '.harness/perf.jsonl'
    }
  });
});

void test('resolveHarnessConfigPath uses canonical file name', () => {
  assert.equal(resolveHarnessConfigPath('/tmp/abc'), `/tmp/abc/${HARNESS_CONFIG_FILE_NAME}`);
});

void test('loadHarnessConfig returns last-known-good when file is missing', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-missing-'));
  const loaded = loadHarnessConfig({
    cwd: baseDir
  });
  assert.equal(loaded.filePath, join(baseDir, HARNESS_CONFIG_FILE_NAME));
  assert.deepEqual(loaded.config, DEFAULT_HARNESS_CONFIG);
  assert.equal(loaded.fromLastKnownGood, false);
  assert.equal(loaded.error, null);
});

void test('loadHarnessConfig reads valid config file', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-valid-'));
  const filePath = join(baseDir, HARNESS_CONFIG_FILE_NAME);
  writeFileSync(
    filePath,
    JSON.stringify({
      mux: {
        keybindings: {
          'mux.app.quit': ['ctrl+]']
        }
      }
    }),
    'utf8'
  );

  const loaded = loadHarnessConfig({
    cwd: baseDir
  });
  assert.deepEqual(loaded.config, {
    mux: {
      keybindings: {
        'mux.app.quit': ['ctrl+]']
      }
    },
    perf: {
      enabled: false,
      filePath: '.harness/perf.jsonl'
    }
  });
  assert.equal(loaded.fromLastKnownGood, false);
  assert.equal(loaded.error, null);
});

void test('loadHarnessConfig falls back atomically on parse errors', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-bad-'));
  const filePath = join(baseDir, HARNESS_CONFIG_FILE_NAME);
  writeFileSync(filePath, '{ "mux": {', 'utf8');

  const loaded = loadHarnessConfig({
    cwd: baseDir,
    lastKnownGood: {
      mux: {
        keybindings: {
          'mux.conversation.new': ['ctrl+t']
        }
      },
      perf: {
        enabled: false,
        filePath: '.harness/perf.jsonl'
      }
    }
  });
  assert.deepEqual(loaded.config, {
    mux: {
      keybindings: {
        'mux.conversation.new': ['ctrl+t']
      }
    },
    perf: {
      enabled: false,
      filePath: '.harness/perf.jsonl'
    }
  });
  assert.equal(loaded.fromLastKnownGood, true);
  assert.equal(typeof loaded.error, 'string');
});

void test('loadHarnessConfig supports explicit file path override', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-string-throw-'));
  const filePath = join(baseDir, 'custom.jsonc');
  writeFileSync(filePath, '{"mux":{"keybindings":{"mux.app.quit":"ctrl+q"}}}', 'utf8');

  const loaded = loadHarnessConfig({
    cwd: '/tmp/ignored',
    filePath,
    lastKnownGood: DEFAULT_HARNESS_CONFIG
  });
  assert.deepEqual(loaded.config, {
    mux: {
      keybindings: {
        'mux.app.quit': ['ctrl+q']
      }
    },
    perf: {
      enabled: false,
      filePath: '.harness/perf.jsonl'
    }
  });
  assert.equal(loaded.fromLastKnownGood, false);
  assert.equal(loaded.error, null);
});

void test('loadHarnessConfig resolves defaults from process cwd when options are omitted', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-default-'));
  const filePath = join(baseDir, HARNESS_CONFIG_FILE_NAME);
  writeFileSync(filePath, '{"mux":{"keybindings":{"mux.conversation.next":["ctrl+j"]}}}', 'utf8');

  const previousCwd = process.cwd();
  process.chdir(baseDir);
  try {
    const loaded = loadHarnessConfig();
    assert.equal(loaded.filePath.endsWith(`/${HARNESS_CONFIG_FILE_NAME}`), true);
    assert.deepEqual(loaded.config, {
      mux: {
        keybindings: {
          'mux.conversation.next': ['ctrl+j']
        }
      },
      perf: {
        enabled: false,
        filePath: '.harness/perf.jsonl'
      }
    });
  } finally {
    process.chdir(previousCwd);
  }
});

void test('parseHarnessConfigText parses perf toggles and file path', () => {
  const parsed = parseHarnessConfigText(`
    {
      "perf": {
        "enabled": true,
        "filePath": " .harness/custom-perf.jsonl "
      }
    }
  `);
  assert.deepEqual(parsed.perf, {
    enabled: true,
    filePath: '.harness/custom-perf.jsonl'
  });
});

void test('parseHarnessConfigText falls back for invalid perf shapes and values', () => {
  const parsedFromArray = parseHarnessConfigText(`
    {
      "perf": []
    }
  `);
  assert.deepEqual(parsedFromArray.perf, {
    enabled: false,
    filePath: '.harness/perf.jsonl'
  });

  const parsedFromInvalidValues = parseHarnessConfigText(`
    {
      "perf": {
        "enabled": "yes",
        "filePath": "   "
      }
    }
  `);
  assert.deepEqual(parsedFromInvalidValues.perf, {
    enabled: false,
    filePath: '.harness/perf.jsonl'
  });
});
