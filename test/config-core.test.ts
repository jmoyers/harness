import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test } from 'bun:test';
import {
  DEFAULT_HARNESS_CONFIG,
  HARNESS_CONFIG_VERSION,
  HARNESS_CONFIG_FILE_NAME,
  loadHarnessConfig,
  parseHarnessConfigText,
  resolveHarnessConfigDirectory,
  resolveHarnessConfigPath,
  updateHarnessConfig,
  updateHarnessMuxUiConfig,
} from '../src/config/config-core.ts';

const DEFAULT_UI = {
  paneWidthPercent: null,
  repositoriesCollapsed: false,
  shortcutsCollapsed: false,
  theme: null,
} as const;
const DEFAULT_GIT = DEFAULT_HARNESS_CONFIG.mux.git;
const DEFAULT_GITHUB = DEFAULT_HARNESS_CONFIG.github;
const TEST_MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function testEnvWithHome(homeDirectory: string): NodeJS.ProcessEnv {
  return {
    HOME: homeDirectory,
    XDG_CONFIG_HOME: undefined,
  };
}

void test('parseHarnessConfigText migrates legacy unversioned configs to current config version', () => {
  const parsed = parseHarnessConfigText(`
    {
      "mux": {
        "keybindings": {
          "mux.app.quit": ["ctrl+q"]
        }
      }
    }
  `);
  assert.equal(parsed.configVersion, HARNESS_CONFIG_VERSION);
  assert.deepEqual(parsed.mux.keybindings, {
    'mux.app.quit': ['ctrl+q'],
  });
});

void test('parseHarnessConfigText accepts current configVersion', () => {
  const parsed = parseHarnessConfigText(`
    {
      "configVersion": ${String(HARNESS_CONFIG_VERSION)},
      "mux": {
        "keybindings": {
          "mux.app.quit": ["ctrl+q"]
        }
      }
    }
  `);
  assert.equal(parsed.configVersion, HARNESS_CONFIG_VERSION);
  assert.deepEqual(parsed.mux.keybindings, {
    'mux.app.quit': ['ctrl+q'],
  });
});

void test('parseHarnessConfigText rejects invalid and unsupported configVersion values', () => {
  assert.throws(() => parseHarnessConfigText(`{"configVersion":"1"}`), /invalid configVersion/i);
  assert.throws(() => parseHarnessConfigText('{"configVersion":0}'), /invalid configVersion/i);
  assert.throws(
    () => parseHarnessConfigText(`{"configVersion":${String(HARNESS_CONFIG_VERSION + 1)}}`),
    /unsupported configVersion/i,
  );
});

void test('checked-in config template exists and matches default config snapshot', () => {
  const templatePath = resolve(TEST_MODULE_DIR, '../src/config/harness.config.template.jsonc');
  assert.equal(existsSync(templatePath), true);
  const parsedTemplate = parseHarnessConfigText(readFileSync(templatePath, 'utf8'));
  assert.deepEqual(parsedTemplate, DEFAULT_HARNESS_CONFIG);
});

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
    'bad.value': ['alt+n'],
  });
  assert.deepEqual(parsed.mux.ui, DEFAULT_UI);
  assert.equal(parsed.debug.enabled, true);
  assert.equal(parsed.debug.perf.enabled, true);
  assert.equal(parsed.debug.perf.filePath, '.harness/perf-startup.jsonl');
});

void test('parseHarnessConfigText preserves escaped strings and ignores comment markers inside strings', () => {
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
    'mux.literal': ['text /* not a comment */ tail'],
  });
  assert.deepEqual(parsed.mux.ui, DEFAULT_UI);
});

void test('parseHarnessConfigText normalizes mux ui and falls back for invalid values', () => {
  const parsed = parseHarnessConfigText(`
    {
      "mux": {
        "ui": {
          "paneWidthPercent": 37.375,
          "repositoriesCollapsed": true,
          "shortcutsCollapsed": true
        }
      }
    }
  `);
  assert.deepEqual(parsed.mux.ui, {
    paneWidthPercent: 37.375,
    repositoriesCollapsed: true,
    shortcutsCollapsed: true,
    theme: null,
  });

  const invalid = parseHarnessConfigText(`
    {
      "mux": {
        "ui": {
          "paneWidthPercent": 0,
          "shortcutsCollapsed": "nope"
        }
      }
    }
  `);
  assert.deepEqual(invalid.mux.ui, DEFAULT_UI);

  const nonNumeric = parseHarnessConfigText(`
    {
      "mux": {
        "ui": {
          "paneWidthPercent": "wide"
        }
      }
    }
  `);
  assert.deepEqual(nonNumeric.mux.ui, DEFAULT_UI);
});

void test('parseHarnessConfigText parses mux ui theme selection and normalizes invalid theme values', () => {
  const parsed = parseHarnessConfigText(`
    {
      "mux": {
        "ui": {
          "theme": {
            "preset": "tokyonight",
            "mode": "light",
            "customThemePath": " themes/custom.json "
          }
        }
      }
    }
  `);
  assert.deepEqual(parsed.mux.ui.theme, {
    preset: 'tokyonight',
    mode: 'light',
    customThemePath: 'themes/custom.json',
  });

  const invalid = parseHarnessConfigText(`
    {
      "mux": {
        "ui": {
          "theme": {
            "preset": " ",
            "mode": "invalid",
            "customThemePath": "   "
          }
        }
      }
    }
  `);
  assert.equal(invalid.mux.ui.theme, null);

  const invalidMode = parseHarnessConfigText(`
    {
      "mux": {
        "ui": {
          "theme": {
            "preset": "github",
            "mode": "not-a-mode"
          }
        }
      }
    }
  `);
  assert.deepEqual(invalidMode.mux.ui.theme, {
    preset: 'github',
    mode: 'dark',
    customThemePath: null,
  });

  const explicitNull = parseHarnessConfigText(`
    {
      "mux": {
        "ui": {
          "theme": null
        }
      }
    }
  `);
  assert.equal(explicitNull.mux.ui.theme, null);
});

void test('parseHarnessConfigText falls back for invalid root shapes', () => {
  assert.deepEqual(parseHarnessConfigText('[]'), DEFAULT_HARNESS_CONFIG);
  assert.deepEqual(parseHarnessConfigText('{"mux":[] }'), DEFAULT_HARNESS_CONFIG);
  assert.deepEqual(parseHarnessConfigText('{"mux":{"keybindings":"bad"}}'), {
    ...DEFAULT_HARNESS_CONFIG,
    mux: {
      keybindings: {},
      ui: DEFAULT_UI,
      git: DEFAULT_GIT,
    },
  });
});

void test('resolveHarnessConfigPath resolves XDG and HOME user config directories', () => {
  const xdgEnv: NodeJS.ProcessEnv = {
    XDG_CONFIG_HOME: '/tmp/xdg-home',
    HOME: '/tmp/home-ignored',
  };
  assert.equal(resolveHarnessConfigDirectory('/tmp/cwd', xdgEnv), '/tmp/xdg-home/harness');
  assert.equal(
    resolveHarnessConfigPath('/tmp/cwd', xdgEnv),
    '/tmp/xdg-home/harness/harness.config.jsonc',
  );

  const homeEnv = testEnvWithHome('/tmp/home-only');
  assert.equal(resolveHarnessConfigDirectory('/tmp/cwd', homeEnv), '/tmp/home-only/.harness');
  assert.equal(
    resolveHarnessConfigPath('/tmp/cwd', homeEnv),
    '/tmp/home-only/.harness/harness.config.jsonc',
  );

  const fallbackEnv: NodeJS.ProcessEnv = {
    HOME: undefined,
    XDG_CONFIG_HOME: undefined,
  };
  assert.equal(
    resolveHarnessConfigPath('/tmp/cwd', fallbackEnv),
    '/tmp/cwd/.harness/harness.config.jsonc',
  );

  const blankEnv: NodeJS.ProcessEnv = {
    HOME: '   ',
    XDG_CONFIG_HOME: ' ',
  };
  assert.equal(
    resolveHarnessConfigPath('/tmp/cwd', blankEnv),
    '/tmp/cwd/.harness/harness.config.jsonc',
  );
});

void test('loadHarnessConfig bootstraps from template when file is missing', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-missing-'));
  const env = testEnvWithHome(baseDir);
  const expectedPath = resolveHarnessConfigPath(baseDir, env);
  const loaded = loadHarnessConfig({
    cwd: baseDir,
    env,
  });
  assert.equal(loaded.filePath, expectedPath);
  assert.deepEqual(loaded.config, DEFAULT_HARNESS_CONFIG);
  assert.equal(loaded.fromLastKnownGood, false);
  assert.equal(loaded.error, null);
  assert.equal(existsSync(expectedPath), true);
  const persisted = parseHarnessConfigText(readFileSync(expectedPath, 'utf8'));
  assert.deepEqual(persisted, DEFAULT_HARNESS_CONFIG);
});

void test('loadHarnessConfig falls back atomically when template bootstrap write fails', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-bootstrap-fail-'));
  const readOnlyHome = join(baseDir, 'readonly-home');
  mkdirSync(readOnlyHome, { recursive: true, mode: 0o500 });
  const env = testEnvWithHome(readOnlyHome);
  const lastKnownGood: typeof DEFAULT_HARNESS_CONFIG = {
    ...DEFAULT_HARNESS_CONFIG,
    debug: {
      ...DEFAULT_HARNESS_CONFIG.debug,
      enabled: false,
    },
  };
  try {
    const loaded = loadHarnessConfig({
      cwd: baseDir,
      env,
      lastKnownGood,
    });
    assert.deepEqual(loaded.config, lastKnownGood);
    assert.equal(loaded.fromLastKnownGood, true);
    assert.match(loaded.error ?? '', /EACCES|EPERM|permission denied/i);
  } finally {
    chmodSync(readOnlyHome, 0o700);
  }
});

void test('loadHarnessConfig reads valid config file', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-valid-'));
  const env = testEnvWithHome(baseDir);
  const filePath = resolveHarnessConfigPath(baseDir, env);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    JSON.stringify({
      mux: {
        keybindings: {
          'mux.app.quit': ['ctrl+q'],
        },
        ui: {
          paneWidthPercent: 41,
          repositoriesCollapsed: false,
          shortcutsCollapsed: true,
        },
      },
    }),
    'utf8',
  );

  const loaded = loadHarnessConfig({
    cwd: baseDir,
    env,
  });
  assert.deepEqual(loaded.config.mux, {
    keybindings: {
      'mux.app.quit': ['ctrl+q'],
    },
    ui: {
      paneWidthPercent: 41,
      repositoriesCollapsed: false,
      shortcutsCollapsed: true,
      theme: null,
    },
    git: DEFAULT_GIT,
  });
  assert.equal(loaded.fromLastKnownGood, false);
  assert.equal(loaded.error, null);
});

void test('loadHarnessConfig falls back atomically on parse errors', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-bad-'));
  const env = testEnvWithHome(baseDir);
  const filePath = resolveHarnessConfigPath(baseDir, env);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, '{ "mux": {', 'utf8');

  const loaded = loadHarnessConfig({
    cwd: baseDir,
    env,
    lastKnownGood: {
      ...DEFAULT_HARNESS_CONFIG,
      mux: {
        keybindings: {
          'mux.conversation.new': ['ctrl+t'],
        },
        ui: {
          paneWidthPercent: 30,
          repositoriesCollapsed: false,
          shortcutsCollapsed: true,
          theme: null,
        },
        git: DEFAULT_GIT,
      },
      debug: {
        ...DEFAULT_HARNESS_CONFIG.debug,
        enabled: false,
      },
    },
  });
  assert.deepEqual(loaded.config, {
    ...DEFAULT_HARNESS_CONFIG,
    mux: {
      keybindings: {
        'mux.conversation.new': ['ctrl+t'],
      },
      ui: {
        paneWidthPercent: 30,
        repositoriesCollapsed: false,
        shortcutsCollapsed: true,
        theme: null,
      },
      git: DEFAULT_GIT,
    },
    debug: {
      ...DEFAULT_HARNESS_CONFIG.debug,
      enabled: false,
    },
  });
  assert.equal(loaded.fromLastKnownGood, true);
  assert.equal(typeof loaded.error, 'string');
});

void test('loadHarnessConfig falls back atomically on unsupported configVersion', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-unsupported-version-'));
  const env = testEnvWithHome(baseDir);
  const filePath = resolveHarnessConfigPath(baseDir, env);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, '{"configVersion":999}', 'utf8');

  const loaded = loadHarnessConfig({
    cwd: baseDir,
    env,
    lastKnownGood: DEFAULT_HARNESS_CONFIG,
  });
  assert.deepEqual(loaded.config, DEFAULT_HARNESS_CONFIG);
  assert.equal(loaded.fromLastKnownGood, true);
  assert.match(loaded.error ?? '', /unsupported configVersion/i);
});

void test('loadHarnessConfig supports explicit file path override', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-override-'));
  const filePath = join(baseDir, 'custom.jsonc');
  writeFileSync(filePath, '{"mux":{"keybindings":{"mux.app.quit":"ctrl+q"}}}', 'utf8');

  const loaded = loadHarnessConfig({
    cwd: '/tmp/ignored',
    filePath,
    lastKnownGood: DEFAULT_HARNESS_CONFIG,
  });
  assert.deepEqual(loaded.config.mux, {
    keybindings: {
      'mux.app.quit': ['ctrl+q'],
    },
    ui: DEFAULT_UI,
    git: DEFAULT_GIT,
  });
  assert.equal(loaded.fromLastKnownGood, false);
  assert.equal(loaded.error, null);
});

void test('loadHarnessConfig resolves defaults from process cwd when options are omitted', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-default-'));
  const filePath = resolve(baseDir, '.harness', HARNESS_CONFIG_FILE_NAME);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, '{"mux":{"keybindings":{"mux.conversation.next":["ctrl+j"]}}}', 'utf8');

  const previousCwd = process.cwd();
  const previousHome = process.env.HOME;
  const previousXdg = process.env.XDG_CONFIG_HOME;
  process.chdir(baseDir);
  process.env.HOME = baseDir;
  delete process.env.XDG_CONFIG_HOME;
  try {
    const loaded = loadHarnessConfig();
    assert.equal(loaded.filePath, filePath);
    assert.deepEqual(loaded.config.mux, {
      keybindings: {
        'mux.conversation.next': ['ctrl+j'],
      },
      ui: DEFAULT_UI,
      git: DEFAULT_GIT,
    });
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousXdg;
    }
  }
});

void test('parseHarnessConfigText normalizes mux git refresh settings', () => {
  const parsed = parseHarnessConfigText(`
    {
      "mux": {
        "git": {
          "enabled": true,
          "activePollMs": 300,
          "idlePollMs": 7000,
          "burstPollMs": 150,
          "burstWindowMs": 3200,
          "triggerDebounceMs": 90,
          "maxConcurrency": 3
        }
      }
    }
  `);
  assert.deepEqual(parsed.mux.git, {
    enabled: true,
    activePollMs: 300,
    idlePollMs: 7000,
    burstPollMs: 150,
    burstWindowMs: 3200,
    triggerDebounceMs: 90,
    maxConcurrency: 3,
  });

  const invalid = parseHarnessConfigText(`
    {
      "mux": {
        "git": {
          "enabled": "yes",
          "activePollMs": -1,
          "idlePollMs": null,
          "burstPollMs": "fast",
          "burstWindowMs": -9,
          "triggerDebounceMs": -10,
          "maxConcurrency": 0
        }
      }
    }
  `);
  assert.deepEqual(invalid.mux.git, {
    ...DEFAULT_GIT,
    maxConcurrency: 1,
  });
});

void test('parseHarnessConfigText normalizes github integration settings', () => {
  const parsed = parseHarnessConfigText(`
    {
      "github": {
        "enabled": false,
        "apiBaseUrl": " https://github.enterprise.example/api/v3/ ",
        "tokenEnvVar": " GH_ENTERPRISE_TOKEN ",
        "pollMs": 2500,
        "maxConcurrency": 4,
        "branchStrategy": "current-only",
        "viewerLogin": " octocat "
      }
    }
  `);
  assert.deepEqual(parsed.github, {
    enabled: false,
    apiBaseUrl: 'https://github.enterprise.example/api/v3',
    tokenEnvVar: 'GH_ENTERPRISE_TOKEN',
    pollMs: 2500,
    maxConcurrency: 4,
    branchStrategy: 'current-only',
    viewerLogin: 'octocat',
  });

  const invalid = parseHarnessConfigText(`
    {
      "github": {
        "enabled": "yes",
        "apiBaseUrl": "",
        "tokenEnvVar": " ",
        "pollMs": 25,
        "maxConcurrency": 0,
        "branchStrategy": "unsupported",
        "viewerLogin": " "
      }
    }
  `);
  assert.deepEqual(invalid.github, {
    ...DEFAULT_GITHUB,
    pollMs: 1000,
    maxConcurrency: 1,
  });
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
        },
        "inspect": {
          "enabled": true,
          "gatewayPort": 9330,
          "clientPort": 9331
        }
      }
    }
  `);
  assert.deepEqual(parsed.debug, {
    enabled: false,
    overwriteArtifactsOnStart: false,
    perf: {
      enabled: false,
      filePath: '.harness/custom-perf.jsonl',
    },
    mux: {
      debugPath: '.harness/custom-mux.jsonl',
      validateAnsi: true,
      resizeMinIntervalMs: 12,
      ptyResizeSettleMs: 34,
      startupSettleQuietMs: 56,
      serverSnapshotModelEnabled: false,
    },
    inspect: {
      enabled: true,
      gatewayPort: 9330,
      clientPort: 9331,
    },
  });
});

void test('parseHarnessConfigText normalizes inspect ports and falls back for invalid values', () => {
  const parsed = parseHarnessConfigText(`
    {
      "debug": {
        "inspect": {
          "enabled": true,
          "gatewayPort": 6499.9,
          "clientPort": 6500.1
        }
      }
    }
  `);
  assert.deepEqual(parsed.debug.inspect, {
    enabled: true,
    gatewayPort: 6499,
    clientPort: 6500,
  });

  const invalid = parseHarnessConfigText(`
    {
      "debug": {
        "inspect": {
          "enabled": "yes",
          "gatewayPort": 0,
          "clientPort": 65536
        }
      }
    }
  `);
  assert.deepEqual(invalid.debug.inspect, DEFAULT_HARNESS_CONFIG.debug.inspect);

  const nonNumeric = parseHarnessConfigText(`
    {
      "debug": {
        "inspect": {
          "enabled": true,
          "gatewayPort": "6499",
          "clientPort": null
        }
      }
    }
  `);
  assert.deepEqual(nonNumeric.debug.inspect, {
    enabled: true,
    gatewayPort: DEFAULT_HARNESS_CONFIG.debug.inspect.gatewayPort,
    clientPort: DEFAULT_HARNESS_CONFIG.debug.inspect.clientPort,
  });
});

void test('parseHarnessConfigText parses codex telemetry and history settings', () => {
  const parsed = parseHarnessConfigText(`
    {
      "codex": {
        "telemetry": {
          "enabled": false,
          "host": " 0.0.0.0 ",
          "port": 4318,
          "logUserPrompt": false,
          "captureLogs": true,
          "captureMetrics": false,
          "captureTraces": false,
          "captureVerboseEvents": true,
          "ingestMode": "full"
        },
        "history": {
          "enabled": true,
          "filePath": " ~/.codex/custom-history.jsonl ",
          "pollMs": 275
        },
        "launch": {
          "defaultMode": "standard",
          "directoryModes": {
            ".": "yolo",
            "./sandbox": "standard"
          }
        }
      }
    }
  `);
  assert.deepEqual(parsed.codex, {
    telemetry: {
      enabled: false,
      host: '0.0.0.0',
      port: 4318,
      logUserPrompt: false,
      captureLogs: true,
      captureMetrics: false,
      captureTraces: false,
      captureVerboseEvents: true,
      ingestMode: 'full',
    },
    history: {
      enabled: true,
      filePath: '~/.codex/custom-history.jsonl',
      pollMs: 275,
    },
    launch: {
      defaultMode: 'standard',
      directoryModes: {
        '.': 'yolo',
        './sandbox': 'standard',
      },
    },
    install: {
      command: null,
    },
  });
});

void test('parseHarnessConfigText falls back for invalid codex settings', () => {
  const parsed = parseHarnessConfigText(`
    {
      "codex": {
        "telemetry": {
          "enabled": "yes",
          "host": " ",
          "port": -1,
          "logUserPrompt": "on",
          "captureLogs": "1",
          "captureMetrics": "0",
          "captureTraces": "0",
          "captureVerboseEvents": "verbose",
          "ingestMode": "fast"
        },
        "history": {
          "enabled": "true",
          "filePath": "   ",
          "pollMs": -100
        },
        "launch": {
          "defaultMode": "unsafe",
          "directoryModes": {
            ".": "unsafe",
            "": "yolo",
            "./safe": "standard"
          }
        }
      }
    }
  `);
  assert.deepEqual(parsed.codex, {
    ...DEFAULT_HARNESS_CONFIG.codex,
    launch: {
      defaultMode: DEFAULT_HARNESS_CONFIG.codex.launch.defaultMode,
      directoryModes: {
        './safe': 'standard',
      },
    },
  });

  const parsedWithBadShapes = parseHarnessConfigText(`
    {
      "codex": []
    }
  `);
  assert.deepEqual(parsedWithBadShapes.codex, DEFAULT_HARNESS_CONFIG.codex);

  const parsedWithNullSections = parseHarnessConfigText(`
    {
      "codex": {
        "telemetry": null,
        "history": null
      }
    }
  `);
  assert.deepEqual(parsedWithNullSections.codex, DEFAULT_HARNESS_CONFIG.codex);

  const parsedWithBadHostAndPort = parseHarnessConfigText(`
    {
      "codex": {
        "telemetry": {
          "host": {},
          "port": "4318"
        }
      }
    }
  `);
  assert.equal(
    parsedWithBadHostAndPort.codex.telemetry.host,
    DEFAULT_HARNESS_CONFIG.codex.telemetry.host,
  );
  assert.equal(
    parsedWithBadHostAndPort.codex.telemetry.port,
    DEFAULT_HARNESS_CONFIG.codex.telemetry.port,
  );

  const parsedWithBadLaunchShapes = parseHarnessConfigText(`
    {
      "codex": {
        "launch": {
          "defaultMode": 7,
          "directoryModes": null
        }
      }
    }
  `);
  assert.deepEqual(parsedWithBadLaunchShapes.codex.launch, DEFAULT_HARNESS_CONFIG.codex.launch);
});

void test('parseHarnessConfigText parses claude launch settings', () => {
  const parsed = parseHarnessConfigText(`
    {
      "claude": {
        "launch": {
          "defaultMode": "standard",
          "directoryModes": {
            ".": "yolo",
            "./sandbox": "standard"
          }
        }
      }
    }
  `);
  assert.deepEqual(parsed.claude, {
    launch: {
      defaultMode: 'standard',
      directoryModes: {
        '.': 'yolo',
        './sandbox': 'standard',
      },
    },
    install: {
      command: null,
    },
  });
});

void test('parseHarnessConfigText parses critique launch/install command settings', () => {
  const parsed = parseHarnessConfigText(`
    {
      "critique": {
        "launch": {
          "defaultArgs": ["--watch", "--help"]
        },
        "install": {
          "command": " bunx critique@next "
        }
      }
    }
  `);
  assert.deepEqual(parsed.critique, {
    launch: {
      defaultArgs: ['--watch', '--help'],
    },
    install: {
      command: 'bunx critique@next',
    },
  });
});

void test('parseHarnessConfigText preserves legacy critique install autoInstall/package settings', () => {
  const parsed = parseHarnessConfigText(`
    {
      "critique": {
        "install": {
          "autoInstall": true,
          "package": " critique@next "
        }
      }
    }
  `);
  assert.equal(parsed.critique.install.command, 'bunx critique@next');
});

void test('parseHarnessConfigText falls back for invalid critique settings', () => {
  const parsed = parseHarnessConfigText(`
    {
      "critique": {
        "launch": {
          "defaultArgs": [true, "   "]
        },
        "install": {
          "autoInstall": "yes",
          "package": " "
        }
      }
    }
  `);
  assert.deepEqual(parsed.critique, DEFAULT_HARNESS_CONFIG.critique);
});

void test('parseHarnessConfigText falls back when critique install command is non-string and legacy fields are invalid', () => {
  const parsed = parseHarnessConfigText(`
      {
        "critique": {
          "install": {
            "command": 42,
            "autoInstall": "yes",
            "package": true
          }
        }
      }
    `);
  assert.deepEqual(parsed.critique.install, DEFAULT_HARNESS_CONFIG.critique.install);
});

void test('parseHarnessConfigText critique fallback handles non-object launch/install and non-array defaultArgs', () => {
  const parsedWithNullSections = parseHarnessConfigText(`
    {
      "critique": {
        "launch": true,
        "install": 7
      }
    }
  `);
  assert.deepEqual(parsedWithNullSections.critique, DEFAULT_HARNESS_CONFIG.critique);

  const parsedWithBadDefaultArgs = parseHarnessConfigText(`
    {
      "critique": {
        "launch": {
          "defaultArgs": "not-an-array"
        }
      }
    }
  `);
  assert.deepEqual(
    parsedWithBadDefaultArgs.critique.launch,
    DEFAULT_HARNESS_CONFIG.critique.launch,
  );
});

void test('parseHarnessConfigText falls back for invalid claude settings', () => {
  const parsed = parseHarnessConfigText(`
    {
      "claude": {
        "launch": {
          "defaultMode": "unsafe",
          "directoryModes": {
            ".": "unsafe",
            "": "yolo",
            "./safe": "standard"
          }
        }
      }
    }
  `);
  assert.deepEqual(parsed.claude, {
    launch: {
      defaultMode: DEFAULT_HARNESS_CONFIG.claude.launch.defaultMode,
      directoryModes: {
        './safe': 'standard',
      },
    },
    install: {
      command: null,
    },
  });

  const parsedWithBadShapes = parseHarnessConfigText(`
    {
      "claude": []
    }
  `);
  assert.deepEqual(parsedWithBadShapes.claude, DEFAULT_HARNESS_CONFIG.claude);

  const parsedWithBadLaunchShapes = parseHarnessConfigText(`
    {
      "claude": {
        "launch": {
          "defaultMode": 7,
          "directoryModes": null
        }
      }
    }
  `);
  assert.deepEqual(parsedWithBadLaunchShapes.claude.launch, DEFAULT_HARNESS_CONFIG.claude.launch);

  const parsedWithNullLaunch = parseHarnessConfigText(`
    {
      "claude": {
        "launch": null
      }
    }
  `);
  assert.deepEqual(parsedWithNullLaunch.claude.launch, DEFAULT_HARNESS_CONFIG.claude.launch);
});

void test('parseHarnessConfigText parses cursor launch settings', () => {
  const parsed = parseHarnessConfigText(`
    {
      "cursor": {
        "launch": {
          "defaultMode": "standard",
          "directoryModes": {
            ".": "yolo",
            "./sandbox": "standard"
          }
        }
      }
    }
  `);
  assert.deepEqual(parsed.cursor, {
    launch: {
      defaultMode: 'standard',
      directoryModes: {
        '.': 'yolo',
        './sandbox': 'standard',
      },
    },
    install: {
      command: null,
    },
  });
});

void test('parseHarnessConfigText falls back for invalid cursor settings', () => {
  const parsed = parseHarnessConfigText(`
    {
      "cursor": {
        "launch": {
          "defaultMode": "unsafe",
          "directoryModes": {
            ".": "unsafe",
            "": "yolo",
            "./safe": "standard"
          }
        }
      }
    }
  `);
  assert.deepEqual(parsed.cursor, {
    launch: {
      defaultMode: DEFAULT_HARNESS_CONFIG.cursor.launch.defaultMode,
      directoryModes: {
        './safe': 'standard',
      },
    },
    install: {
      command: null,
    },
  });

  const parsedWithBadShapes = parseHarnessConfigText(`
    {
      "cursor": []
    }
  `);
  assert.deepEqual(parsedWithBadShapes.cursor, DEFAULT_HARNESS_CONFIG.cursor);

  const parsedWithBadLaunchShapes = parseHarnessConfigText(`
    {
      "cursor": {
        "launch": {
          "defaultMode": 7,
          "directoryModes": null
        }
      }
    }
  `);
  assert.deepEqual(parsedWithBadLaunchShapes.cursor.launch, DEFAULT_HARNESS_CONFIG.cursor.launch);

  const parsedWithNullLaunch = parseHarnessConfigText(`
    {
      "cursor": {
        "launch": null
      }
    }
  `);
  assert.deepEqual(parsedWithNullLaunch.cursor.launch, DEFAULT_HARNESS_CONFIG.cursor.launch);
});

void test('parseHarnessConfigText parses codex/claude/cursor install command settings', () => {
  const parsed = parseHarnessConfigText(`
    {
      "codex": {
        "install": {
          "command": "bunx @openai/codex@latest"
        }
      },
      "claude": {
        "install": {
          "command": "bunx @anthropic-ai/claude-code@latest"
        }
      },
      "cursor": {
        "install": {
          "command": null
        }
      }
    }
  `);
  assert.equal(parsed.codex.install.command, 'bunx @openai/codex@latest');
  assert.equal(parsed.claude.install.command, 'bunx @anthropic-ai/claude-code@latest');
  assert.equal(parsed.cursor.install.command, null);
});

void test('parseHarnessConfigText parses lifecycle hook connectors and event filters', () => {
  const parsed = parseHarnessConfigText(`
    {
      "hooks": {
        "lifecycle": {
          "enabled": true,
          "providers": {
            "codex": true,
            "claude": false,
            "controlPlane": true
          },
          "peonPing": {
            "enabled": true,
            "baseUrl": " http://127.0.0.1:19998/ ",
            "timeoutMs": 900,
            "eventCategoryMap": {
              "turn.started": "task.acknowledge",
              "turn.completed": "task.complete",
              "turn.failed": 7,
              "not-real": "ignored"
            }
          },
          "webhooks": [
            {
              "name": "status-feed",
              "enabled": true,
              "url": "http://127.0.0.1:9001/hooks/lifecycle",
              "method": "post",
              "timeoutMs": 1500,
              "headers": {
                "authorization": "Bearer test-token"
              },
              "eventTypes": ["turn.started", "turn.completed", "turn.started", "unknown"]
            }
          ]
        }
      }
    }
  `);
  assert.equal(parsed.hooks.lifecycle.enabled, true);
  assert.deepEqual(parsed.hooks.lifecycle.providers, {
    codex: true,
    claude: false,
    cursor: true,
    controlPlane: true,
  });
  assert.deepEqual(parsed.hooks.lifecycle.peonPing, {
    enabled: true,
    baseUrl: 'http://127.0.0.1:19998/',
    timeoutMs: 900,
    eventCategoryMap: {
      'turn.started': 'task.acknowledge',
      'turn.completed': 'task.complete',
    },
  });
  assert.equal(parsed.hooks.lifecycle.webhooks.length, 1);
  assert.deepEqual(parsed.hooks.lifecycle.webhooks[0], {
    name: 'status-feed',
    enabled: true,
    url: 'http://127.0.0.1:9001/hooks/lifecycle',
    method: 'POST',
    timeoutMs: 1500,
    headers: {
      authorization: 'Bearer test-token',
    },
    eventTypes: ['turn.started', 'turn.completed'],
  });
});

void test('parseHarnessConfigText falls back for invalid lifecycle hook shapes', () => {
  const parsed = parseHarnessConfigText(`
    {
      "hooks": {
        "lifecycle": {
          "enabled": "yes",
          "providers": {
            "codex": "true",
            "claude": null,
            "controlPlane": 1
          },
          "peonPing": {
            "enabled": "true",
            "baseUrl": "   ",
            "timeoutMs": -4,
            "eventCategoryMap": {
              "turn.started": "",
              "invalid": "bad"
            }
          },
          "webhooks": [
            {
              "name": "missing-url"
            },
            {
              "url": "http://127.0.0.1:9010/lifecycle",
              "method": "",
              "eventTypes": ["invalid", 4]
            }
          ]
        }
      }
    }
  `);
  assert.equal(parsed.hooks.lifecycle.enabled, DEFAULT_HARNESS_CONFIG.hooks.lifecycle.enabled);
  assert.deepEqual(
    parsed.hooks.lifecycle.providers,
    DEFAULT_HARNESS_CONFIG.hooks.lifecycle.providers,
  );
  assert.deepEqual(parsed.hooks.lifecycle.peonPing, {
    ...DEFAULT_HARNESS_CONFIG.hooks.lifecycle.peonPing,
    eventCategoryMap: {},
  });
  assert.deepEqual(parsed.hooks.lifecycle.webhooks, [
    {
      name: 'webhook-2',
      enabled: true,
      url: 'http://127.0.0.1:9010/lifecycle',
      method: 'POST',
      timeoutMs: 1200,
      headers: {},
      eventTypes: [],
    },
  ]);
});

void test('parseHarnessConfigText falls back to default peon categories when category map is not an object', () => {
  const parsed = parseHarnessConfigText(`
    {
      "hooks": {
        "lifecycle": {
          "peonPing": {
            "enabled": true,
            "eventCategoryMap": null
          }
        }
      }
    }
  `);
  assert.deepEqual(
    parsed.hooks.lifecycle.peonPing.eventCategoryMap,
    DEFAULT_HARNESS_CONFIG.hooks.lifecycle.peonPing.eventCategoryMap,
  );
});

void test('parseHarnessConfigText handles null lifecycle sub-sections and malformed webhook headers', () => {
  const parsed = parseHarnessConfigText(`
    {
      "hooks": {
        "lifecycle": {
          "providers": null,
          "peonPing": null,
          "webhooks": [
            null,
            {
              "url": "http://127.0.0.1:9020/lifecycle",
              "headers": {
                "": "ignored",
                "x-empty": "   ",
                "x-ok": " value ",
                "x-bad": 12
              },
              "eventTypes": "turn.started"
            }
          ]
        }
      }
    }
  `);

  assert.deepEqual(
    parsed.hooks.lifecycle.providers,
    DEFAULT_HARNESS_CONFIG.hooks.lifecycle.providers,
  );
  assert.deepEqual(
    parsed.hooks.lifecycle.peonPing,
    DEFAULT_HARNESS_CONFIG.hooks.lifecycle.peonPing,
  );
  assert.deepEqual(parsed.hooks.lifecycle.webhooks, [
    {
      name: 'webhook-2',
      enabled: true,
      url: 'http://127.0.0.1:9020/lifecycle',
      method: 'POST',
      timeoutMs: 1200,
      headers: {
        'x-ok': 'value',
      },
      eventTypes: [],
    },
  ]);
});

void test('parseHarnessConfigText supports legacy top-level perf and debug fallbacks', () => {
  const parsedLegacyPerf = parseHarnessConfigText(`
    {
      "perf": {
        "enabled": false,
        "filePath": " .harness/legacy-perf.jsonl "
      }
    }
  `);
  assert.deepEqual(parsedLegacyPerf.debug.perf, {
    enabled: false,
    filePath: '.harness/legacy-perf.jsonl',
  });

  const parsedFromArray = parseHarnessConfigText(`
    {
      "debug": []
    }
  `);
  assert.deepEqual(parsedFromArray.debug, DEFAULT_HARNESS_CONFIG.debug);

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
  assert.deepEqual(parsedFromInvalidValues.debug, DEFAULT_HARNESS_CONFIG.debug);

  const parsedExplicitDebug = parseHarnessConfigText(`
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
  assert.deepEqual(parsedExplicitDebug.debug.perf, DEFAULT_HARNESS_CONFIG.debug.perf);
});

void test('parseHarnessConfigText normalizes non-finite and decimal debug values', () => {
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
    serverSnapshotModelEnabled: true,
  });
});

void test('updateHarnessMuxUiConfig persists mux ui state and rounds percentage', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-ui-update-'));
  const filePath = join(baseDir, HARNESS_CONFIG_FILE_NAME);
  writeFileSync(
    filePath,
    JSON.stringify({
      mux: {
        keybindings: {
          'mux.conversation.new': ['ctrl+t'],
        },
      },
    }),
    'utf8',
  );

  const updated = updateHarnessMuxUiConfig(
    {
      paneWidthPercent: 33.3333,
      repositoriesCollapsed: false,
      shortcutsCollapsed: true,
    },
    {
      filePath,
    },
  );
  assert.deepEqual(updated.mux.ui, {
    paneWidthPercent: 33.33,
    repositoriesCollapsed: false,
    shortcutsCollapsed: true,
    theme: null,
  });
  assert.deepEqual(updated.mux.keybindings, {
    'mux.conversation.new': ['ctrl+t'],
  });

  const reloaded = loadHarnessConfig({ filePath, cwd: baseDir });
  assert.deepEqual(reloaded.config.mux.ui, {
    paneWidthPercent: 33.33,
    repositoriesCollapsed: false,
    shortcutsCollapsed: true,
    theme: null,
  });
});

void test('updateHarnessMuxUiConfig rejects invalid percent and preserves existing value on omitted fields', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-ui-invalid-'));
  const filePath = join(baseDir, HARNESS_CONFIG_FILE_NAME);
  writeFileSync(
    filePath,
    JSON.stringify({
      mux: {
        ui: {
          paneWidthPercent: 44,
          repositoriesCollapsed: false,
          shortcutsCollapsed: false,
        },
      },
    }),
    'utf8',
  );

  const updatedInvalid = updateHarnessMuxUiConfig(
    {
      paneWidthPercent: 200,
    },
    {
      filePath,
    },
  );
  assert.equal(updatedInvalid.mux.ui.paneWidthPercent, null);
  assert.equal(updatedInvalid.mux.ui.repositoriesCollapsed, false);
  assert.equal(updatedInvalid.mux.ui.shortcutsCollapsed, false);

  const updatedPartial = updateHarnessMuxUiConfig(
    {
      shortcutsCollapsed: true,
    },
    {
      filePath,
    },
  );
  assert.equal(updatedPartial.mux.ui.paneWidthPercent, null);
  assert.equal(updatedPartial.mux.ui.repositoriesCollapsed, false);
  assert.equal(updatedPartial.mux.ui.shortcutsCollapsed, true);
});

void test('updateHarnessMuxUiConfig preserves existing theme configuration', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-ui-theme-preserve-'));
  const filePath = join(baseDir, HARNESS_CONFIG_FILE_NAME);
  writeFileSync(
    filePath,
    JSON.stringify({
      mux: {
        ui: {
          paneWidthPercent: 44,
          repositoriesCollapsed: false,
          shortcutsCollapsed: false,
          theme: {
            preset: 'tokyonight',
            mode: 'dark',
            customThemePath: 'themes/custom.json',
          },
        },
      },
    }),
    'utf8',
  );

  const updated = updateHarnessMuxUiConfig(
    {
      shortcutsCollapsed: true,
    },
    {
      filePath,
    },
  );
  assert.deepEqual(updated.mux.ui.theme, {
    preset: 'tokyonight',
    mode: 'dark',
    customThemePath: 'themes/custom.json',
  });
});

void test('updateHarnessConfig writes new config file when absent', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-write-missing-'));
  const filePath = join(baseDir, HARNESS_CONFIG_FILE_NAME);
  const updated = updateHarnessConfig({
    filePath,
    update: (current) => ({
      ...current,
      mux: {
        ...current.mux,
        keybindings: {
          'mux.app.quit': ['ctrl+q'],
        },
        ui: {
          paneWidthPercent: 25,
          repositoriesCollapsed: false,
          shortcutsCollapsed: true,
          theme: null,
        },
      },
    }),
  });
  assert.deepEqual(updated.mux, {
    keybindings: {
      'mux.app.quit': ['ctrl+q'],
    },
    ui: {
      paneWidthPercent: 25,
      repositoriesCollapsed: false,
      shortcutsCollapsed: true,
      theme: null,
    },
    git: DEFAULT_GIT,
  });
  assert.equal(updated.configVersion, HARNESS_CONFIG_VERSION);
  const loaded = loadHarnessConfig({ filePath, cwd: baseDir });
  assert.deepEqual(loaded.config.mux, updated.mux);
  assert.equal(loaded.config.configVersion, HARNESS_CONFIG_VERSION);
  const persistedRaw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  assert.equal(persistedRaw['configVersion'], HARNESS_CONFIG_VERSION);
});

void test('updateHarnessConfig cleans temporary file when rename fails', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-write-fail-'));
  const directoryAsFilePath = join(baseDir, 'not-a-file');
  mkdirSync(directoryAsFilePath, { recursive: true });
  assert.throws(
    () =>
      updateHarnessConfig({
        filePath: directoryAsFilePath,
        update: (current) => current,
      }),
    /EISDIR|illegal operation on a directory/i,
  );
  const leftovers = readdirSync(baseDir).filter((entry) => entry.includes('.tmp-'));
  assert.deepEqual(leftovers, []);
});

void test('updateHarnessConfig handles write failures and swallows temp cleanup errors', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-write-permissions-'));
  const readOnlyDir = join(baseDir, 'readonly');
  mkdirSync(readOnlyDir, { recursive: true, mode: 0o500 });
  const filePath = join(readOnlyDir, HARNESS_CONFIG_FILE_NAME);
  try {
    assert.throws(
      () =>
        updateHarnessConfig({
          filePath,
          update: (current) => current,
        }),
      /EACCES|EPERM|permission denied/i,
    );
  } finally {
    chmodSync(readOnlyDir, 0o700);
  }
});

void test('updateHarnessConfig throws when existing config cannot be parsed', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-update-invalid-existing-'));
  const filePath = join(baseDir, HARNESS_CONFIG_FILE_NAME);
  writeFileSync(filePath, '{ "mux": ', 'utf8');
  assert.throws(
    () =>
      updateHarnessConfig({
        filePath,
        update: (current) => current,
      }),
    /Unexpected end of JSON input|Unexpected EOF|JSON Parse error/i,
  );
  assert.equal(readFileSync(filePath, 'utf8'), '{ "mux": ');
});

void test('updateHarnessMuxUiConfig supports cwd-only config path resolution', () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'harness-config-ui-cwd-'));
  const env = testEnvWithHome(baseDir);
  const filePath = resolveHarnessConfigPath(baseDir, env);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    JSON.stringify({
      mux: {
        ui: {
          paneWidthPercent: 35,
          repositoriesCollapsed: false,
          shortcutsCollapsed: false,
          theme: null,
        },
      },
    }),
    'utf8',
  );
  const updated = updateHarnessMuxUiConfig(
    {
      shortcutsCollapsed: true,
    },
    {
      cwd: baseDir,
      env,
    },
  );
  assert.deepEqual(updated.mux.ui, {
    paneWidthPercent: 35,
    repositoriesCollapsed: false,
    shortcutsCollapsed: true,
    theme: null,
  });
});
