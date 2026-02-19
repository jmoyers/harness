import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  resolveGatewayLogPath,
  resolveGatewayRecordPath,
  resolveInvocationDirectory,
} from '../src/cli/gateway-record.ts';
import { resolveHarnessWorkspaceDirectory } from '../src/config/harness-paths.ts';

interface StressOptions {
  iterations: number;
  port: number;
  authToken: string;
  concurrentStarts: number;
  simulateMissingRecord: boolean;
  pauseMs: number;
  sessionName: string;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface IterationSummary {
  iteration: number;
  startFailures: number;
  statusCode: number;
  stopCode: number;
  econResetCount: number;
  dbClosedCount: number;
  scopeKindErrorCount: number;
}

const HARNESS_SCRIPT_PATH = resolve(process.cwd(), 'scripts/harness.ts');

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`invalid ${flag} value: ${value}`);
  }
  return parsed;
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`invalid --port value: ${value}`);
  }
  return parsed;
}

function parseOptions(argv: readonly string[]): StressOptions {
  const defaultSessionName = `diag-${Date.now().toString(36)}-${String(process.pid)}`;
  const options: StressOptions = {
    iterations: 20,
    port: 7789,
    authToken: `stress-token-${process.pid}`,
    concurrentStarts: 2,
    simulateMissingRecord: false,
    pauseMs: 40,
    sessionName: defaultSessionName,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--iterations') {
      options.iterations = parsePositiveInt(argv[index + 1] ?? '', '--iterations');
      index += 1;
      continue;
    }
    if (arg === '--port') {
      options.port = parsePort(argv[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (arg === '--auth-token') {
      const value = argv[index + 1];
      if (value === undefined || value.trim().length === 0) {
        throw new Error('invalid --auth-token value');
      }
      options.authToken = value;
      index += 1;
      continue;
    }
    if (arg === '--concurrent-starts') {
      options.concurrentStarts = parsePositiveInt(argv[index + 1] ?? '', '--concurrent-starts');
      index += 1;
      continue;
    }
    if (arg === '--pause-ms') {
      options.pauseMs = parsePositiveInt(argv[index + 1] ?? '', '--pause-ms');
      index += 1;
      continue;
    }
    if (arg === '--simulate-missing-record') {
      options.simulateMissingRecord = true;
      continue;
    }
    if (arg === '--session') {
      const value = argv[index + 1];
      if (value === undefined || value.trim().length === 0) {
        throw new Error('invalid --session value');
      }
      options.sessionName = value.trim();
      index += 1;
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }

  return options;
}

async function runHarness(
  invocationDirectory: string,
  args: readonly string[],
  extraEnv: Record<string, string> = {},
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [HARNESS_SCRIPT_PATH, ...args], {
      cwd: invocationDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HARNESS_INVOKE_CWD: invocationDirectory,
        ...extraEnv,
      },
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (signal !== null) {
        rejectRun(new Error(`harness command exited via signal ${signal}`));
        return;
      }
      resolveRun({
        code: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });
}

function buildGatewayArgs(sessionName: string | null, args: readonly string[]): string[] {
  if (sessionName === null) {
    return [...args];
  }
  return ['--session', sessionName, ...args];
}

function resolveSessionGatewayPaths(
  invocationDirectory: string,
  sessionName: string,
): {
  recordPath: string;
  logPath: string;
} {
  const workspaceDirectory = resolveHarnessWorkspaceDirectory(invocationDirectory, process.env);
  if (sessionName.length === 0) {
    return {
      recordPath: resolveGatewayRecordPath(invocationDirectory, process.env),
      logPath: resolveGatewayLogPath(invocationDirectory, process.env),
    };
  }
  const sessionRoot = resolve(workspaceDirectory, 'sessions', sessionName);
  return {
    recordPath: resolve(sessionRoot, 'gateway.json'),
    logPath: resolve(sessionRoot, 'gateway.log'),
  };
}

function countMatches(haystack: string, pattern: RegExp): number {
  const matches = haystack.match(pattern);
  return matches === null ? 0 : matches.length;
}

function readGatewayLog(logPath: string): string {
  if (!existsSync(logPath)) {
    return '';
  }
  return readFileSync(logPath, 'utf8');
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  const invocationDirectory = resolveInvocationDirectory(process.env, process.cwd());
  const { recordPath, logPath } = resolveSessionGatewayPaths(
    invocationDirectory,
    options.sessionName,
  );
  const summaries: IterationSummary[] = [];

  process.stdout.write(
    `[gateway-stress] iterations=${String(options.iterations)} port=${String(options.port)} concurrentStarts=${String(options.concurrentStarts)} simulateMissingRecord=${String(options.simulateMissingRecord)} session=${options.sessionName}\n`,
  );
  process.stdout.write(`[gateway-stress] record=${recordPath}\n`);
  process.stdout.write(`[gateway-stress] log=${logPath}\n`);

  const env = {
    HARNESS_CONTROL_PLANE_PORT: String(options.port),
  };

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    const initialStart = await runHarness(
      invocationDirectory,
      buildGatewayArgs(options.sessionName, [
        'gateway',
        'start',
        '--port',
        String(options.port),
        '--auth-token',
        options.authToken,
      ]),
      env,
    );

    if (options.simulateMissingRecord && existsSync(recordPath)) {
      unlinkSync(recordPath);
    }

    const concurrentRuns = await Promise.all(
      Array.from(
        { length: options.concurrentStarts },
        async () =>
          await runHarness(
            invocationDirectory,
            buildGatewayArgs(options.sessionName, [
              'gateway',
              'start',
              '--port',
              String(options.port),
              '--auth-token',
              options.authToken,
            ]),
            env,
          ),
      ),
    );

    const statusResult = await runHarness(
      invocationDirectory,
      buildGatewayArgs(options.sessionName, ['gateway', 'status']),
      env,
    );
    const stopResult = await runHarness(
      invocationDirectory,
      buildGatewayArgs(options.sessionName, ['gateway', 'stop', '--force']),
      env,
    );

    const logText = readGatewayLog(logPath);
    const startFailures =
      (initialStart.code === 0 ? 0 : 1) +
      concurrentRuns.filter((result) => result.code !== 0).length;
    const summary: IterationSummary = {
      iteration,
      startFailures,
      statusCode: statusResult.code,
      stopCode: stopResult.code,
      econResetCount: countMatches(logText, /ECONNRESET/gu),
      dbClosedCount: countMatches(logText, /Database has closed/gu),
      scopeKindErrorCount: countMatches(logText, /no such column: scope_kind/gu),
    };
    summaries.push(summary);

    process.stdout.write(
      `[gateway-stress] iteration=${String(iteration)} startFailures=${String(summary.startFailures)} status=${String(summary.statusCode)} stop=${String(summary.stopCode)} econReset=${String(summary.econResetCount)} dbClosed=${String(summary.dbClosedCount)} scopeKind=${String(summary.scopeKindErrorCount)}\n`,
    );

    if (options.pauseMs > 0 && iteration < options.iterations) {
      await delay(options.pauseMs);
    }
  }

  const failedIterations = summaries.filter(
    (summary) => summary.startFailures > 0 || summary.statusCode !== 0 || summary.stopCode !== 0,
  );
  process.stdout.write(
    `[gateway-stress] complete failedIterations=${String(failedIterations.length)}/${String(summaries.length)}\n`,
  );
  return failedIterations.length === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  process.stderr.write(
    `gateway-stress fatal error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
