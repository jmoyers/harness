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
  assert.equal(parsed.debug.enabled, true);
  assert.equal(parsed.debug.perf.enabled, true);
  assert.equal(parsed.debug.perf.filePath, '.harness/perf-startup.jsonl');
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
  assert.equal(parsed.debug.enabled, true);
  assert.equal(parsed.debug.perf.enabled, true);
  assert.equal(parsed.debug.perf.filePath, '.harness/perf-startup.jsonl');
});

void test('parseHarnessConfigText falls back for invalid root shapes', () => {
  assert.deepEqual(parseHarnessConfigText('[]'), DEFAULT_HARNESS_CONFIG);
  assert.deepEqual(parseHarnessConfigText('{"mux":[] }'), DEFAULT_HARNESS_CONFIG);
  assert.deepEqual(parseHarnessConfigText('{"mux":{"keybindings":"bad"}}'), {
    mux: {
      keybindings: {}
    },
    debug: {
      enabled: true,
      overwriteArtifactsOnStart: true,
      perf: {
        enabled: true,
        filePath: '.harness/perf-startup.jsonl'
      },
      mux: {
        debugPath: '.harness/mux-debug.jsonl',
        validateAnsi: false,
        resizeMinIntervalMs: 33,
        ptyResizeSettleMs: 75,
        startupSettleQuietMs: 300,
      serverSnapshotModelEnabled: true
      }
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
    debug: {
      enabled: true,
      overwriteArtifactsOnStart: true,
      perf: {
        enabled: true,
        filePath: '.harness/perf-startup.jsonl'
      },
      mux: {
        debugPath: '.harness/mux-debug.jsonl',
        validateAnsi: false,
        resizeMinIntervalMs: 33,
        ptyResizeSettleMs: 75,
        startupSettleQuietMs: 300,
      serverSnapshotModelEnabled: true
      }
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
      debug: {
        enabled: false,
        overwriteArtifactsOnStart: false,
        perf: {
          enabled: false,
          filePath: '.harness/perf.jsonl'
        },
        mux: {
          debugPath: null,
          validateAnsi: true,
          resizeMinIntervalMs: 1,
          ptyResizeSettleMs: 2,
          startupSettleQuietMs: 3,
      serverSnapshotModelEnabled: true
        }
      }
    }
  });
  assert.deepEqual(loaded.config, {
    mux: {
      keybindings: {
        'mux.conversation.new': ['ctrl+t']
      }
    },
    debug: {
      enabled: false,
      overwriteArtifactsOnStart: false,
      perf: {
        enabled: false,
        filePath: '.harness/perf.jsonl'
      },
      mux: {
        debugPath: null,
        validateAnsi: true,
        resizeMinIntervalMs: 1,
        ptyResizeSettleMs: 2,
        startupSettleQuietMs: 3,
      serverSnapshotModelEnabled: true
      }
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
    debug: {
      enabled: true,
      overwriteArtifactsOnStart: true,
      perf: {
        enabled: true,
        filePath: '.harness/perf-startup.jsonl'
      },
      mux: {
        debugPath: '.harness/mux-debug.jsonl',
        validateAnsi: false,
        resizeMinIntervalMs: 33,
        ptyResizeSettleMs: 75,
        startupSettleQuietMs: 300,
      serverSnapshotModelEnabled: true
      }
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
      debug: {
        enabled: true,
        overwriteArtifactsOnStart: true,
        perf: {
          enabled: true,
          filePath: '.harness/perf-startup.jsonl'
        },
        mux: {
          debugPath: '.harness/mux-debug.jsonl',
          validateAnsi: false,
          resizeMinIntervalMs: 33,
          ptyResizeSettleMs: 75,
          startupSettleQuietMs: 300,
      serverSnapshotModelEnabled: true
        }
      }
    });
  } finally {
    process.chdir(previousCwd);
  }
});

void test('parseHarnessConfigText parses debug perf and mux toggles', () => {
  const parsed = parseHarnessConfigText(`
    {
      "debug": {
        "enabled": false,
        "overwriteArtifactsOnStart": false,
        "perf": {
          "enabled": false,
          "filePath": " .harness/custom-perf.jsonl "
        },
        "mux": {
          "debugPath": " .harness/custom-mux.jsonl ",
          "validateAnsi": true,
          "resizeMinIntervalMs": 12,
          "ptyResizeSettleMs": 34,
          "startupSettleQuietMs": 56,
          "serverSnapshotModelEnabled": false
        }
      }
    }
  `);
  assert.deepEqual(parsed.debug, {
    enabled: false,
    overwriteArtifactsOnStart: false,
    perf: {
      enabled: false,
      filePath: '.harness/custom-perf.jsonl'
    },
    mux: {
      debugPath: '.harness/custom-mux.jsonl',
      validateAnsi: true,
      resizeMinIntervalMs: 12,
      ptyResizeSettleMs: 34,
      startupSettleQuietMs: 56,
      serverSnapshotModelEnabled: false
    }
  });
});

void test('parseHarnessConfigText supports legacy top-level perf shape', () => {
  const parsed = parseHarnessConfigText(`
    {
      "perf": {
        "enabled": false,
        "filePath": " .harness/legacy-perf.jsonl "
      }
    }
  `);
  assert.deepEqual(parsed.debug.perf, {
    enabled: false,
    filePath: '.harness/legacy-perf.jsonl'
  });
});

void test('parseHarnessConfigText falls back for invalid debug shapes and values', () => {
  const parsedFromArray = parseHarnessConfigText(`
    {
      "debug": []
    }
  `);
  assert.deepEqual(parsedFromArray.debug, {
    enabled: true,
    overwriteArtifactsOnStart: true,
    perf: {
      enabled: true,
      filePath: '.harness/perf-startup.jsonl'
    },
    mux: {
      debugPath: '.harness/mux-debug.jsonl',
      validateAnsi: false,
      resizeMinIntervalMs: 33,
      ptyResizeSettleMs: 75,
      startupSettleQuietMs: 300,
      serverSnapshotModelEnabled: true
    }
  });

  const parsedFromInvalidValues = parseHarnessConfigText(`
    {
      "debug": {
        "enabled": "yes",
        "overwriteArtifactsOnStart": "no",
        "perf": {
          "enabled": "yes",
          "filePath": "   "
        },
        "mux": {
          "debugPath": "   ",
          "validateAnsi": "no",
          "resizeMinIntervalMs": -1,
          "ptyResizeSettleMs": -2,
          "startupSettleQuietMs": -3,
          "serverSnapshotModelEnabled": "no"
        }
      }
    }
  `);
  assert.deepEqual(parsedFromInvalidValues.debug, {
    enabled: true,
    overwriteArtifactsOnStart: true,
    perf: {
      enabled: true,
      filePath: '.harness/perf-startup.jsonl'
    },
    mux: {
      debugPath: '.harness/mux-debug.jsonl',
      validateAnsi: false,
      resizeMinIntervalMs: 33,
      ptyResizeSettleMs: 75,
      startupSettleQuietMs: 300,
      serverSnapshotModelEnabled: true
    }
  });
});

void test('parseHarnessConfigText normalizes null mux debug path and falls back for non-finite numbers', () => {
  const parsed = parseHarnessConfigText(`
    {
      "debug": {
        "mux": {
          "debugPath": null,
          "resizeMinIntervalMs": 1.8,
          "ptyResizeSettleMs": null,
          "startupSettleQuietMs": "x"
        }
      }
    }
  `);
  assert.deepEqual(parsed.debug.mux, {
    debugPath: '.harness/mux-debug.jsonl',
    validateAnsi: false,
    resizeMinIntervalMs: 1,
    ptyResizeSettleMs: 75,
    startupSettleQuietMs: 300,
      serverSnapshotModelEnabled: true
  });
});

void test('parseHarnessConfigText prefers explicit debug section over legacy top-level perf', () => {
  const parsed = parseHarnessConfigText(`
    {
      "perf": {
        "enabled": true,
        "filePath": " .harness/custom-perf.jsonl "
      },
      "debug": {
        "enabled": true
      }
    }
  `);
  assert.deepEqual(parsed.debug.perf, {
    enabled: true,
    filePath: '.harness/perf-startup.jsonl'
  });
});
