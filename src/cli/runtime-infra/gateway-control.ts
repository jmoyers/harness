import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  clearDefaultGatewayPointerForRecordPath,
  writeDefaultGatewayPointerFromGatewayRecord,
} from '../default-gateway-pointer.ts';
import {
  parseGatewayRecordText,
  serializeGatewayRecord,
  type GatewayRecord,
} from '../gateway-record.ts';
import { resolveHarnessWorkspaceDirectory } from '../../config/harness-paths.ts';

const DEFAULT_GATEWAY_STOP_POLL_MS = 50;
const DEFAULT_GATEWAY_LOCK_TIMEOUT_MS = 7000;
const DEFAULT_GATEWAY_LOCK_POLL_MS = 40;
const GATEWAY_LOCK_VERSION = 1;

interface ProcessTableEntry {
  pid: number;
  ppid: number;
  command: string;
}

interface GatewayProcessIdentity {
  pid: number;
  startedAt: string;
}

interface GatewayControlLockRecord {
  version: number;
  owner: GatewayProcessIdentity;
  acquiredAt: string;
  workspaceRoot: string;
  token: string;
}

interface GatewayControlLockHandle {
  lockPath: string;
  record: GatewayControlLockRecord;
  release: () => void;
}

export interface ParsedGatewayDaemonEntry {
  pid: number;
  host: string;
  port: number;
  authToken: string | null;
  stateDbPath: string;
}

interface OrphanProcessCleanupResult {
  matchedPids: readonly number[];
  terminatedPids: readonly number[];
  failedPids: readonly number[];
  errorMessage: string | null;
}

interface GatewayStopProcessOptions {
  force: boolean;
  timeoutMs: number;
}

interface GatewayControlInfraOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
}

export class GatewayControlInfra {
  constructor(private readonly options: GatewayControlInfraOptions = {}) {}

  private env(): NodeJS.ProcessEnv {
    return this.options.env ?? process.env;
  }

  private cwd(): string {
    return this.options.cwd ?? process.cwd();
  }

  public readGatewayRecord(recordPath: string): GatewayRecord | null {
    if (!existsSync(recordPath)) {
      return null;
    }
    try {
      const raw = readFileSync(recordPath, 'utf8');
      return parseGatewayRecordText(raw);
    } catch {
      return null;
    }
  }

  public writeTextFileAtomically(filePath: string, text: string): void {
    mkdirSync(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
    try {
      writeFileSync(tempPath, text, 'utf8');
      renameSync(tempPath, filePath);
    } catch (error: unknown) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Best-effort cleanup only.
      }
      throw error;
    }
  }

  public writeGatewayRecord(recordPath: string, record: GatewayRecord): void {
    this.writeTextFileAtomically(recordPath, serializeGatewayRecord(record));
    writeDefaultGatewayPointerFromGatewayRecord(recordPath, record, this.env());
  }

  public removeGatewayRecord(recordPath: string): void {
    try {
      unlinkSync(recordPath);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
    clearDefaultGatewayPointerForRecordPath(recordPath, this.cwd(), this.env());
  }

  private readProcessStartedAt(pid: number): string | null {
    if (!Number.isInteger(pid) || pid <= 0) {
      return null;
    }
    try {
      const output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
      }).trim();
      return output.length > 0 ? output : null;
    } catch {
      return null;
    }
  }

  private resolveCurrentProcessIdentity(): GatewayProcessIdentity {
    const startedAt = this.readProcessStartedAt(process.pid);
    if (startedAt === null) {
      throw new Error(
        `failed to resolve current process start timestamp for pid=${String(process.pid)}`,
      );
    }
    return {
      pid: process.pid,
      startedAt,
    };
  }

  private parseGatewayControlLockText(text: string): GatewayControlLockRecord | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (candidate['version'] !== GATEWAY_LOCK_VERSION) {
      return null;
    }
    if (
      typeof candidate['acquiredAt'] !== 'string' ||
      candidate['acquiredAt'].trim().length === 0
    ) {
      return null;
    }
    if (
      typeof candidate['workspaceRoot'] !== 'string' ||
      candidate['workspaceRoot'].trim().length === 0
    ) {
      return null;
    }
    if (typeof candidate['token'] !== 'string' || candidate['token'].trim().length === 0) {
      return null;
    }
    const owner = candidate['owner'];
    if (typeof owner !== 'object' || owner === null || Array.isArray(owner)) {
      return null;
    }
    const ownerRecord = owner as Record<string, unknown>;
    const pid = ownerRecord['pid'];
    const startedAt = ownerRecord['startedAt'];
    if (!Number.isInteger(pid) || (pid as number) <= 0) {
      return null;
    }
    if (typeof startedAt !== 'string' || startedAt.trim().length === 0) {
      return null;
    }
    return {
      version: GATEWAY_LOCK_VERSION,
      owner: {
        pid: pid as number,
        startedAt,
      },
      acquiredAt: candidate['acquiredAt'] as string,
      workspaceRoot: candidate['workspaceRoot'] as string,
      token: candidate['token'] as string,
    };
  }

  private readGatewayControlLock(lockPath: string): GatewayControlLockRecord | null {
    if (!existsSync(lockPath)) {
      return null;
    }
    try {
      return this.parseGatewayControlLockText(readFileSync(lockPath, 'utf8'));
    } catch {
      return null;
    }
  }

  private removeGatewayControlLock(lockPath: string): void {
    try {
      unlinkSync(lockPath);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }

  public isPidRunning(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') {
        return false;
      }
      return true;
    }
  }

  private isGatewayControlLockOwnerAlive(record: GatewayControlLockRecord): boolean {
    if (!this.isPidRunning(record.owner.pid)) {
      return false;
    }
    const startedAt = this.readProcessStartedAt(record.owner.pid);
    if (startedAt === null) {
      return false;
    }
    return startedAt === record.owner.startedAt;
  }

  private createGatewayControlLockHandle(
    lockPath: string,
    record: GatewayControlLockRecord,
  ): GatewayControlLockHandle {
    return {
      lockPath,
      record,
      release: () => {
        const current = this.readGatewayControlLock(lockPath);
        if (current === null) {
          return;
        }
        if (
          current.token !== record.token ||
          current.owner.pid !== record.owner.pid ||
          current.owner.startedAt !== record.owner.startedAt
        ) {
          return;
        }
        this.removeGatewayControlLock(lockPath);
      },
    };
  }

  public async acquireGatewayControlLock(
    lockPath: string,
    workspaceRoot: string,
    timeoutMs = DEFAULT_GATEWAY_LOCK_TIMEOUT_MS,
  ): Promise<GatewayControlLockHandle> {
    const owner = this.resolveCurrentProcessIdentity();
    const deadlineMs = Date.now() + timeoutMs;
    const candidate: GatewayControlLockRecord = {
      version: GATEWAY_LOCK_VERSION,
      owner,
      acquiredAt: new Date().toISOString(),
      workspaceRoot,
      token: randomUUID(),
    };

    while (true) {
      mkdirSync(dirname(lockPath), { recursive: true });
      try {
        const fd = openSync(lockPath, 'wx');
        try {
          writeFileSync(fd, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
        } finally {
          closeSync(fd);
        }
        return this.createGatewayControlLockHandle(lockPath, candidate);
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          throw error;
        }
      }

      const existing = this.readGatewayControlLock(lockPath);
      if (existing === null) {
        this.removeGatewayControlLock(lockPath);
        continue;
      }

      if (existing.owner.pid === owner.pid && existing.owner.startedAt === owner.startedAt) {
        return this.createGatewayControlLockHandle(lockPath, existing);
      }

      if (!this.isGatewayControlLockOwnerAlive(existing)) {
        this.removeGatewayControlLock(lockPath);
        continue;
      }

      if (Date.now() >= deadlineMs) {
        throw new Error(
          `timed out waiting for gateway control lock: lockPath=${lockPath} ownerPid=${String(existing.owner.pid)} acquiredAt=${existing.acquiredAt}`,
        );
      }
      await delay(DEFAULT_GATEWAY_LOCK_POLL_MS);
    }
  }

  public async withGatewayControlLock<T>(
    lockPath: string,
    workspaceRoot: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const handle = await this.acquireGatewayControlLock(lockPath, workspaceRoot);
    try {
      return await operation();
    } finally {
      handle.release();
    }
  }

  public async waitForPidExit(
    pid: number,
    timeoutMs: number,
    pollMs = DEFAULT_GATEWAY_STOP_POLL_MS,
  ): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (!this.isPidRunning(pid)) {
        return true;
      }
      await delay(pollMs);
    }
    return !this.isPidRunning(pid);
  }

  public async waitForFileExists(
    filePath: string,
    timeoutMs: number,
    pollMs = DEFAULT_GATEWAY_STOP_POLL_MS,
  ): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (existsSync(filePath)) {
        return true;
      }
      await delay(pollMs);
    }
    return existsSync(filePath);
  }

  public signalPidWithOptionalProcessGroup(
    pid: number,
    signal: NodeJS.Signals,
    includeProcessGroup: boolean,
  ): boolean {
    let sent = false;
    if (includeProcessGroup && pid > 1) {
      try {
        process.kill(-pid, signal);
        sent = true;
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ESRCH') {
          throw error;
        }
      }
    }

    try {
      process.kill(pid, signal);
      sent = true;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH') {
        throw error;
      }
    }

    return sent;
  }

  private readProcessTable(): readonly ProcessTableEntry[] {
    const output = execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,command='], {
      encoding: 'utf8',
    });
    const lines = output.split('\n');
    const entries: ProcessTableEntry[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const match = /^(\d+)\s+(\d+)\s+(.*)$/u.exec(trimmed);
      if (match === null) {
        continue;
      }
      const pid = Number.parseInt(match[1] ?? '', 10);
      const ppid = Number.parseInt(match[2] ?? '', 10);
      const command = match[3] ?? '';
      if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(ppid) || ppid < 0) {
        continue;
      }
      entries.push({
        pid,
        ppid,
        command,
      });
    }
    return entries;
  }

  private tokenizeProcessCommand(command: string): readonly string[] {
    const trimmed = command.trim();
    return trimmed.length === 0 ? [] : trimmed.split(/\s+/u);
  }

  private readCommandFlagValue(tokens: readonly string[], flag: string): string | null {
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token === flag) {
        const value = tokens[index + 1];
        return value === undefined ? null : value;
      }
      if (token.startsWith(`${flag}=`)) {
        const value = token.slice(flag.length + 1);
        return value.length === 0 ? null : value;
      }
    }
    return null;
  }

  private parseGatewayDaemonProcessEntry(
    entry: ProcessTableEntry,
  ): ParsedGatewayDaemonEntry | null {
    if (!/\bcontrol-plane-daemon\.(?:ts|js)\b/u.test(entry.command)) {
      return null;
    }
    const tokens = this.tokenizeProcessCommand(entry.command);
    const host = this.readCommandFlagValue(tokens, '--host');
    const portRaw = this.readCommandFlagValue(tokens, '--port');
    const stateDbPath = this.readCommandFlagValue(tokens, '--state-db-path');
    const authToken = this.readCommandFlagValue(tokens, '--auth-token');
    if (host === null || portRaw === null || stateDbPath === null) {
      return null;
    }
    const port = Number.parseInt(portRaw, 10);
    if (!Number.isFinite(port) || !Number.isInteger(port) || port <= 0 || port > 65535) {
      return null;
    }
    return {
      pid: entry.pid,
      host,
      port,
      authToken,
      stateDbPath: resolve(stateDbPath),
    };
  }

  public listGatewayDaemonProcesses(): readonly ParsedGatewayDaemonEntry[] {
    const parsed: ParsedGatewayDaemonEntry[] = [];
    for (const entry of this.readProcessTable()) {
      const daemon = this.parseGatewayDaemonProcessEntry(entry);
      if (daemon !== null) {
        parsed.push(daemon);
      }
    }
    return parsed;
  }

  public isPathWithinWorkspaceRuntimeScope(
    pathValue: string,
    invocationDirectory: string,
  ): boolean {
    const runtimeRoot = resolveHarnessWorkspaceDirectory(invocationDirectory, this.env());
    const normalizedRoot = resolve(runtimeRoot);
    const normalizedPath = resolve(pathValue);
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
  }

  private findOrphanSqlitePidsForDbPath(stateDbPath: string): readonly number[] {
    const normalizedDbPath = resolve(stateDbPath);
    return this.readProcessTable()
      .filter((entry) => entry.ppid === 1)
      .filter((entry) => entry.pid !== process.pid)
      .filter((entry) => /\bsqlite3\b/u.test(entry.command))
      .filter((entry) => entry.command.includes(normalizedDbPath))
      .map((entry) => entry.pid);
  }

  private dedupePids(pids: readonly number[]): readonly number[] {
    return [...new Set(pids)];
  }

  private resolvePtyHelperPathCandidates(invocationDirectory: string): readonly string[] {
    return [
      resolve(invocationDirectory, 'native/ptyd/target/release/ptyd'),
      resolve(invocationDirectory, 'bin/ptyd'),
    ];
  }

  private findOrphanGatewayDaemonPids(
    stateDbPath: string,
    daemonScriptPath: string,
  ): readonly number[] {
    const normalizedDbPath = resolve(stateDbPath);
    const normalizedDaemonScriptPath = resolve(daemonScriptPath);
    return this.dedupePids(
      this.readProcessTable()
        .filter((entry) => entry.ppid === 1)
        .filter((entry) => entry.pid !== process.pid)
        .filter((entry) => entry.command.includes('--state-db-path'))
        .filter((entry) => {
          if (entry.command.includes(normalizedDaemonScriptPath)) {
            return true;
          }
          return (
            /\bcontrol-plane-daemon\.(?:ts|js)\b/u.test(entry.command) &&
            entry.command.includes(normalizedDbPath)
          );
        })
        .map((entry) => entry.pid),
    );
  }

  private findOrphanPtyHelperPidsForWorkspace(invocationDirectory: string): readonly number[] {
    const helperPathCandidates = this.resolvePtyHelperPathCandidates(invocationDirectory);
    return this.readProcessTable()
      .filter((entry) => entry.ppid === 1)
      .filter((entry) => entry.pid !== process.pid)
      .filter((entry) =>
        helperPathCandidates.some((candidate) => entry.command.includes(candidate)),
      )
      .map((entry) => entry.pid);
  }

  private findOrphanRelayLinkedAgentPidsForWorkspace(
    invocationDirectory: string,
  ): readonly number[] {
    const relayScriptPath = resolve(invocationDirectory, 'scripts/codex-notify-relay.ts');
    return this.readProcessTable()
      .filter((entry) => entry.ppid === 1)
      .filter((entry) => entry.pid !== process.pid)
      .filter((entry) => entry.command.includes(relayScriptPath))
      .map((entry) => entry.pid);
  }

  public formatOrphanProcessCleanupResult(
    label: string,
    result: OrphanProcessCleanupResult,
  ): string {
    if (result.errorMessage !== null) {
      return `${label} cleanup error: ${result.errorMessage}`;
    }
    if (result.matchedPids.length === 0) {
      return `${label} cleanup: none found`;
    }
    if (result.failedPids.length === 0) {
      return `${label} cleanup: terminated ${String(result.terminatedPids.length)} process(es)`;
    }
    return [
      `${label} cleanup:`,
      `matched=${String(result.matchedPids.length)}`,
      `terminated=${String(result.terminatedPids.length)}`,
      `failed=${String(result.failedPids.length)}`,
    ].join(' ');
  }

  private async cleanupOrphanPids(
    matchedPids: readonly number[],
    options: GatewayStopProcessOptions,
    killProcessGroup = false,
  ): Promise<OrphanProcessCleanupResult> {
    const terminatedPids: number[] = [];
    const failedPids: number[] = [];

    for (const pid of matchedPids) {
      if (!this.isPidRunning(pid)) {
        continue;
      }
      const signaledTerm = this.signalPidWithOptionalProcessGroup(pid, 'SIGTERM', killProcessGroup);
      if (!signaledTerm) {
        terminatedPids.push(pid);
        continue;
      }

      const exitedAfterTerm = await this.waitForPidExit(pid, options.timeoutMs);
      if (exitedAfterTerm) {
        terminatedPids.push(pid);
        continue;
      }

      if (!options.force) {
        failedPids.push(pid);
        continue;
      }

      const signaledKill = this.signalPidWithOptionalProcessGroup(pid, 'SIGKILL', killProcessGroup);
      if (!signaledKill) {
        terminatedPids.push(pid);
        continue;
      }

      if (await this.waitForPidExit(pid, options.timeoutMs)) {
        terminatedPids.push(pid);
      } else {
        failedPids.push(pid);
      }
    }

    return {
      matchedPids,
      terminatedPids,
      failedPids,
      errorMessage: null,
    };
  }

  public async cleanupOrphanSqliteProcessesForDbPath(
    stateDbPath: string,
    options: GatewayStopProcessOptions,
  ): Promise<OrphanProcessCleanupResult> {
    let matchedPids: readonly number[] = [];
    try {
      matchedPids = this.findOrphanSqlitePidsForDbPath(stateDbPath);
    } catch (error: unknown) {
      return {
        matchedPids: [],
        terminatedPids: [],
        failedPids: [],
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
    return await this.cleanupOrphanPids(matchedPids, options, false);
  }

  public async cleanupOrphanGatewayDaemons(
    stateDbPath: string,
    daemonScriptPath: string,
    options: GatewayStopProcessOptions,
  ): Promise<OrphanProcessCleanupResult> {
    let matchedPids: readonly number[] = [];
    try {
      matchedPids = this.findOrphanGatewayDaemonPids(stateDbPath, daemonScriptPath);
    } catch (error: unknown) {
      return {
        matchedPids: [],
        terminatedPids: [],
        failedPids: [],
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
    return await this.cleanupOrphanPids(matchedPids, options, true);
  }

  public async cleanupOrphanPtyHelpersForWorkspace(
    invocationDirectory: string,
    options: GatewayStopProcessOptions,
  ): Promise<OrphanProcessCleanupResult> {
    let matchedPids: readonly number[] = [];
    try {
      matchedPids = this.findOrphanPtyHelperPidsForWorkspace(invocationDirectory);
    } catch (error: unknown) {
      return {
        matchedPids: [],
        terminatedPids: [],
        failedPids: [],
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
    return await this.cleanupOrphanPids(matchedPids, options, false);
  }

  public async cleanupOrphanRelayLinkedAgentsForWorkspace(
    invocationDirectory: string,
    options: GatewayStopProcessOptions,
  ): Promise<OrphanProcessCleanupResult> {
    let matchedPids: readonly number[] = [];
    try {
      matchedPids = this.findOrphanRelayLinkedAgentPidsForWorkspace(invocationDirectory);
    } catch (error: unknown) {
      return {
        matchedPids: [],
        terminatedPids: [],
        failedPids: [],
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
    return await this.cleanupOrphanPids(matchedPids, options, false);
  }
}
