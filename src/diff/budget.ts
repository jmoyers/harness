import type { DiffBudget, DiffCoverageReason } from './types.ts';

interface DiffBudgetUsage {
  readonly files: number;
  readonly hunks: number;
  readonly lines: number;
  readonly bytes: number;
}

interface MutableDiffBudgetUsage {
  files: number;
  hunks: number;
  lines: number;
  bytes: number;
}

interface DiffBudgetCheckpoint {
  readonly allowed: boolean;
  readonly reason: DiffCoverageReason;
}

function takeReason(current: DiffCoverageReason, next: DiffCoverageReason): DiffCoverageReason {
  if (current !== 'none') {
    return current;
  }
  return next;
}

export class DiffBudgetTracker {
  private reason: DiffCoverageReason = 'none';
  private readonly usageMutable: MutableDiffBudgetUsage = {
    files: 0,
    hunks: 0,
    lines: 0,
    bytes: 0,
  };
  private readonly startedAtMs: number;

  constructor(
    private readonly budget: DiffBudget,
    nowMs = Date.now(),
  ) {
    this.startedAtMs = nowMs;
  }

  usage(): DiffBudgetUsage {
    return {
      files: this.usageMutable.files,
      hunks: this.usageMutable.hunks,
      lines: this.usageMutable.lines,
      bytes: this.usageMutable.bytes,
    };
  }

  limitReason(): DiffCoverageReason {
    return this.reason;
  }

  elapsedMs(nowMs = Date.now()): number {
    return Math.max(0, nowMs - this.startedAtMs);
  }

  checkRuntime(nowMs = Date.now()): DiffBudgetCheckpoint {
    if (this.elapsedMs(nowMs) >= this.budget.maxRuntimeMs) {
      this.reason = takeReason(this.reason, 'max-runtime-ms');
      return {
        allowed: false,
        reason: this.reason,
      };
    }
    return {
      allowed: true,
      reason: this.reason,
    };
  }

  addBytes(value: number): DiffBudgetCheckpoint {
    this.usageMutable.bytes += Math.max(0, Math.floor(value));
    if (this.usageMutable.bytes > this.budget.maxBytes) {
      this.reason = takeReason(this.reason, 'max-bytes');
      return {
        allowed: false,
        reason: this.reason,
      };
    }
    return {
      allowed: true,
      reason: this.reason,
    };
  }

  takeFile(): DiffBudgetCheckpoint {
    if (this.usageMutable.files >= this.budget.maxFiles) {
      this.reason = takeReason(this.reason, 'max-files');
      return {
        allowed: false,
        reason: this.reason,
      };
    }
    this.usageMutable.files += 1;
    return {
      allowed: true,
      reason: this.reason,
    };
  }

  takeHunk(): DiffBudgetCheckpoint {
    if (this.usageMutable.hunks >= this.budget.maxHunks) {
      this.reason = takeReason(this.reason, 'max-hunks');
      return {
        allowed: false,
        reason: this.reason,
      };
    }
    this.usageMutable.hunks += 1;
    return {
      allowed: true,
      reason: this.reason,
    };
  }

  takeLine(): DiffBudgetCheckpoint {
    if (this.usageMutable.lines >= this.budget.maxLines) {
      this.reason = takeReason(this.reason, 'max-lines');
      return {
        allowed: false,
        reason: this.reason,
      };
    }
    this.usageMutable.lines += 1;
    return {
      allowed: true,
      reason: this.reason,
    };
  }
}
