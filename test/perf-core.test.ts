import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'bun:test';
import {
  configurePerfCore,
  isPerfCoreEnabled,
  perfNowNs,
  recordPerfDuration,
  recordPerfEvent,
  shutdownPerfCore,
  startPerfSpan
} from '../src/perf/perf-core.ts';

interface ParsedPerfRecord {
  [key: string]: unknown;
  type: string;
  name: string;
}

function readRecords(path: string): ParsedPerfRecord[] {
  const contents = readFileSync(path, 'utf8');
  return contents
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const record: unknown = JSON.parse(line);
      if (typeof record !== 'object' || record === null) {
        throw new Error('invalid record');
      }

      const candidate = record as Record<string, unknown>;
      if (typeof candidate.type !== 'string' || typeof candidate.name !== 'string') {
        throw new Error('invalid record');
      }

      return {
        ...candidate,
        type: candidate.type,
        name: candidate.name
      };
    });
}

afterEach(() => {
  configurePerfCore({ enabled: false });
  shutdownPerfCore();
});

void test('perf-core disabled mode is no-op and does not create output file', () => {
  const tempPath = mkdtempSync(join(tmpdir(), 'harness-perf-disabled-'));
  const outputPath = join(tempPath, 'perf.jsonl');

  try {
    configurePerfCore({
      enabled: false,
      filePath: outputPath
    });

    assert.equal(isPerfCoreEnabled(), false);

    const noopSpan = startPerfSpan('disabled.span');
    noopSpan.end();
    recordPerfEvent('disabled.event');
    recordPerfDuration('disabled.duration', perfNowNs());
    shutdownPerfCore();

    assert.equal(existsSync(outputPath), false);
  } finally {
    rmSync(tempPath, { recursive: true, force: true });
  }
});

void test('perf-core writes event and span records to configured file', () => {
  const tempPath = mkdtempSync(join(tmpdir(), 'harness-perf-enabled-'));
  const outputPath = join(tempPath, 'perf.jsonl');

  try {
    configurePerfCore({
      enabled: true,
      filePath: outputPath
    });

    assert.equal(isPerfCoreEnabled(), true);

    recordPerfEvent('perf.event', { mode: 'enabled' });

    const spanWithBaseAttrs = startPerfSpan('perf.span.base', { mode: 'base' });
    spanWithBaseAttrs.end();
    spanWithBaseAttrs.end();

    const spanWithEndAttrs = startPerfSpan('perf.span.end-attrs');
    spanWithEndAttrs.end({ mode: 'end-attrs' });

    const spanWithMergedAttrs = startPerfSpan('perf.span.merged-attrs', { stage: 'base' });
    spanWithMergedAttrs.end({ done: 'true' });

    const spanWithNoAttrs = startPerfSpan('perf.span.no-attrs');
    spanWithNoAttrs.end();

    const spanWithParent = startPerfSpan('perf.span.parent', undefined, 'span-root');
    spanWithParent.end();

    recordPerfDuration('perf.span.duration', perfNowNs(), { mode: 'duration' });
    shutdownPerfCore();

    const records = readRecords(outputPath);
    assert.ok(records.some((record) => record.type === 'event' && record.name === 'perf.event'));
    const eventRecord = records.find((record) => record.type === 'event' && record.name === 'perf.event');
    assert.equal(typeof eventRecord?.['ts-ms'], 'number');
    assert.ok(
      records.some((record) => record.type === 'span' && record.name === 'perf.span.base')
    );
    const spanRecord = records.find((record) => record.type === 'span' && record.name === 'perf.span.base');
    assert.equal(typeof spanRecord?.['end-ms'], 'number');
    assert.ok(
      records.some((record) => record.type === 'span' && record.name === 'perf.span.end-attrs')
    );
    assert.ok(
      records.some((record) => record.type === 'span' && record.name === 'perf.span.merged-attrs')
    );
    assert.ok(
      records.some((record) => record.type === 'span' && record.name === 'perf.span.no-attrs')
    );
    assert.ok(
      records.some((record) => record.type === 'span' && record.name === 'perf.span.duration')
    );
    assert.ok(
      records.some((record) => {
        return (
          record.type === 'span' &&
          record.name === 'perf.span.parent' &&
          record['parent-span-id'] === 'span-root'
        );
      })
    );
  } finally {
    rmSync(tempPath, { recursive: true, force: true });
  }
});

void test('perf-core supports file path rotation while enabled', () => {
  const tempPath = mkdtempSync(join(tmpdir(), 'harness-perf-rotate-'));
  const firstPath = join(tempPath, 'first.jsonl');
  const secondPath = join(tempPath, 'second.jsonl');

  try {
    configurePerfCore({
      enabled: true,
      filePath: firstPath
    });
    recordPerfEvent('first.event');

    configurePerfCore({
      enabled: true,
      filePath: secondPath
    });
    recordPerfEvent('second.event');
    shutdownPerfCore();

    const firstRecords = readRecords(firstPath);
    const secondRecords = readRecords(secondPath);
    assert.equal(firstRecords.some((record) => record.name === 'first.event'), true);
    assert.equal(secondRecords.some((record) => record.name === 'second.event'), true);
  } finally {
    rmSync(tempPath, { recursive: true, force: true });
  }
});
