import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'bun:test';
import { Widget, resetAutoIdCounter } from '../../../packages/harness-ui/src/widget/widget.ts';
import { createTestPilot } from '../../../packages/harness-ui/src/testing/pilot.ts';
import {
  TurnActivityStrip,
  spinnerFrameAt,
  formatTurnActivityLine,
} from '../../../packages/harness-ui/src/widgets/turn-activity-strip.ts';
import {
  DataTableCompact,
  buildDataTableCompactLines,
} from '../../../packages/harness-ui/src/widgets/data-table-compact.ts';
import {
  MarkdownTranscript,
  buildMarkdownTranscriptLines,
} from '../../../packages/harness-ui/src/widgets/markdown-transcript.ts';
import {
  ToolCallTimeline,
  summarizeToolCalls,
  buildToolCallTimelineLines,
} from '../../../packages/harness-ui/src/widgets/tool-call-timeline.ts';
import {
  MessageCard,
  messageCardRoleLabel,
  formatMessageCardMetaLine,
} from '../../../packages/harness-ui/src/widgets/message-card.ts';

class RootWidget extends Widget {
  render(): void {}
}

function root(children: Widget[]): RootWidget {
  const value = new RootWidget('root');
  value.width = '100%';
  value.height = '100%';
  value.flexDirection = 'column';
  value.add(...children);
  return value;
}

beforeEach(() => {
  resetAutoIdCounter();
});

describe('turn activity strip', () => {
  test('formats in-progress and done activity lines', () => {
    assert.equal(spinnerFrameAt(0, ['a', 'b'], 10), 'a');
    assert.equal(spinnerFrameAt(15, ['a', 'b'], 10), 'b');
    assert.equal(
      formatTurnActivityLine({
        inProgress: true,
        state: 'tool-calling',
        summary: {
          totalTools: 3,
          completedTools: 1,
          failedTools: 0,
          latestToolName: 'thread.list',
        },
        nowMs: 0,
        spinnerFrames: ['*'],
      }),
      '* running tools... · 1/3 complete · thread.list',
    );
    assert.equal(
      formatTurnActivityLine({
        inProgress: false,
        summary: {
          totalTools: 2,
          completedTools: 2,
          failedTools: 1,
          latestToolName: 'directory.list',
        },
      }),
      '✓ 2 tool calls · 2/2 complete · 1 failed · latest directory.list',
    );
  });

  test('widget renders activity strip text', () => {
    const widget = TurnActivityStrip({
      inProgress: true,
      state: 'thinking',
      summary: { totalTools: 0 },
    });
    const pilot = createTestPilot(root([widget]), { cols: 50, rows: 1 });
    pilot.expectScreen().toContainRow('thinking');
  });
});

describe('data table compact', () => {
  test('builds bordered table and fallback meta', () => {
    const bordered = buildDataTableCompactLines({
      header: ['Name', 'Value'],
      rows: [
        ['Alpha', '100'],
        ['Beta', '200'],
      ],
      width: 40,
    });
    assert.equal(bordered[0]?.kind, 'border');
    assert.equal(bordered[1]?.kind, 'header');
    assert.equal(
      bordered.some((line) => line.text.includes('Alpha')),
      true,
    );

    const fallback = buildDataTableCompactLines({
      header: ['A', 'B', 'C', 'D'],
      rows: [['one', 'two', 'three', 'four']],
      width: 8,
    });
    assert.equal(fallback[0]?.kind, 'header');
  });

  test('widget renders compact table', () => {
    const widget = DataTableCompact({
      header: ['Name', 'Value'],
      rows: [['Alpha', '100']],
      height: 4,
    });
    const pilot = createTestPilot(root([widget]), { cols: 40, rows: 4 });
    pilot.expectScreen().toContainRow('Name');
    pilot.expectScreen().toContainRow('Alpha');
  });
});

describe('markdown transcript', () => {
  test('parses markdown lines including table blocks', () => {
    const lines = buildMarkdownTranscriptLines({
      text: ['# Heading', '- item', '| N | V |', '| --- | --- |', '| A | 1 |', '+ plus'].join('\n'),
      width: 50,
    });
    assert.equal(
      lines.some((line) => line.kind === 'heading'),
      true,
    );
    assert.equal(
      lines.some((line) => line.kind === 'list-item'),
      true,
    );
    assert.equal(
      lines.some((line) => line.kind === 'table-border'),
      true,
    );
    assert.equal(lines.filter((line) => line.kind === 'list-item').length >= 2, true);
  });

  test('widget renders markdown transcript', () => {
    const widget = MarkdownTranscript({
      content: ['# Results', '| Name |', '| --- |', '| Alpha |'].join('\n'),
      height: 6,
    });
    const pilot = createTestPilot(root([widget]), { cols: 50, rows: 6 });
    pilot.expectScreen().toContainRow('Results');
    pilot.expectScreen().toContainRow('Alpha');
  });
});

describe('tool call timeline', () => {
  test('summarizes and renders tool timeline lines', () => {
    const calls = [
      { id: 'a', name: 'directory.list', status: 'pending' as const, args: '{"path":"."}' },
      { id: 'b', name: 'thread.list', status: 'done' as const },
    ];
    const summary = summarizeToolCalls(calls);
    assert.deepEqual(summary, {
      total: 2,
      completed: 1,
      pending: 1,
      failed: 0,
      latestToolName: 'thread.list',
    });

    const lines = buildToolCallTimelineLines({
      calls,
      width: 80,
      inProgress: true,
      state: 'tool-calling',
      nowMs: 0,
    });
    assert.equal(lines[0]?.kind, 'summary');
    assert.equal(
      lines.some((line) => line.kind === 'call' && line.text.includes('directory.list')),
      true,
    );
  });

  test('widget renders timeline rows', () => {
    const widget = ToolCallTimeline({
      calls: [{ id: 'a', name: 'directory.list', status: 'done' }],
      inProgress: false,
      state: 'idle',
      height: 3,
    });
    const pilot = createTestPilot(root([widget]), { cols: 60, rows: 3 });
    pilot.expectScreen().toContainRow('directory.list');
  });
});

describe('message card', () => {
  test('formats role labels and meta line', () => {
    assert.equal(messageCardRoleLabel('assistant'), 'nim');
    assert.equal(
      formatMessageCardMetaLine({
        modeLabel: 'Build',
        modelLabel: 'claude-sonnet',
        durationMs: 12,
        inProgress: true,
      }),
      '▣ Build · claude-sonnet · 12ms · in progress',
    );
  });

  test('widget renders role body and meta', () => {
    const widget = MessageCard({
      role: 'assistant',
      body: ['line one', 'line two'],
      meta: '▣ Build · model',
      height: 5,
    });
    const pilot = createTestPilot(root([widget]), { cols: 40, rows: 5 });
    pilot.expectScreen().toContainRow('nim');
    pilot.expectScreen().toContainRow('line one');
    pilot.expectScreen().toContainRow('▣ Build');
  });
});
