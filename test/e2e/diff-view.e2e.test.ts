import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import {
  DiffView,
  DiffViewWidget,
  parseDiffText,
} from '../../packages/harness-ui/src/widgets/diff-view.ts';
import { createTestPilot } from '../../packages/harness-ui/src/testing/pilot.ts';

class RootWidget extends Widget {
  render(): void {}
}
function root(children: Widget[]): RootWidget {
  const r = new RootWidget('root');
  r.flexDirection = 'column';
  r.add(...children);
  return r;
}

const SAMPLE_DIFF = `diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,5 +1,6 @@
 import { run } from './app';
-const old = true;
+const updated = true;
+const added = 'new';
 
 run();`;

beforeEach(() => {
  resetAutoIdCounter();
});

describe('parseDiffText', () => {
  test('parses unified diff into files', () => {
    const files = parseDiffText(SAMPLE_DIFF);
    assert.equal(files.length, 1);
    assert.equal(files[0]!.filename, 'src/main.ts');
  });

  test('counts additions and deletions', () => {
    const files = parseDiffText(SAMPLE_DIFF);
    assert.equal(files[0]!.additions, 2);
    assert.equal(files[0]!.deletions, 1);
  });

  test('identifies line kinds', () => {
    const files = parseDiffText(SAMPLE_DIFF);
    const kinds = files[0]!.lines.map((l) => l.kind);
    assert.ok(kinds.includes('hunk-header'));
    assert.ok(kinds.includes('context'));
    assert.ok(kinds.includes('add'));
    assert.ok(kinds.includes('remove'));
  });

  test('assigns line numbers', () => {
    const files = parseDiffText(SAMPLE_DIFF);
    const addLine = files[0]!.lines.find((l) => l.kind === 'add');
    assert.notEqual(addLine, undefined);
    assert.notEqual(addLine!.newLineNumber, null);
    assert.equal(addLine!.oldLineNumber, null);

    const removeLine = files[0]!.lines.find((l) => l.kind === 'remove');
    assert.notEqual(removeLine, undefined);
    assert.notEqual(removeLine!.oldLineNumber, null);
    assert.equal(removeLine!.newLineNumber, null);
  });

  test('empty diff returns empty array', () => {
    assert.deepEqual(parseDiffText(''), []);
  });

  test('multiple files', () => {
    const multi = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-old
+new
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,1 +1,2 @@
 keep
+added`;
    const files = parseDiffText(multi);
    assert.equal(files.length, 2);
    assert.equal(files[0]!.filename, 'a.ts');
    assert.equal(files[1]!.filename, 'b.ts');
  });
});

describe('DiffView rendering', () => {
  test('renders file header', () => {
    const files = parseDiffText(SAMPLE_DIFF);
    const dv = DiffView({ id: 'dv', files, flexGrow: 1 });
    const pilot = createTestPilot(root([dv]), { cols: 60, rows: 10 });
    pilot.expectScreen().toContainRow('src/main.ts');
  });

  test('renders added line with + prefix', () => {
    const files = parseDiffText(SAMPLE_DIFF);
    const dv = DiffView({ id: 'dv', files, flexGrow: 1 });
    const pilot = createTestPilot(root([dv]), { cols: 60, rows: 10 });
    pilot.expectScreen().toContainRow('+');
    pilot.expectScreen().toContainRow('updated');
  });

  test('renders removed line with - prefix', () => {
    const files = parseDiffText(SAMPLE_DIFF);
    const dv = DiffView({ id: 'dv', files, flexGrow: 1 });
    const pilot = createTestPilot(root([dv]), { cols: 60, rows: 10 });
    pilot.expectScreen().toContainRow('-');
    pilot.expectScreen().toContainRow('old');
  });

  test('renders hunk header', () => {
    const files = parseDiffText(SAMPLE_DIFF);
    const dv = DiffView({ id: 'dv', files, flexGrow: 1 });
    const pilot = createTestPilot(root([dv]), { cols: 60, rows: 10 });
    pilot.expectScreen().toContainRow('@@');
  });

  test('renders line numbers', () => {
    const files = parseDiffText(SAMPLE_DIFF);
    const dv = DiffView({ id: 'dv', files, flexGrow: 1 });
    const pilot = createTestPilot(root([dv]), { cols: 60, rows: 10 });
    pilot.expectScreen().toContainRow('1');
  });

  test('renders addition/deletion stats', () => {
    const files = parseDiffText(SAMPLE_DIFF);
    const dv = DiffView({ id: 'dv', files, flexGrow: 1 });
    const pilot = createTestPilot(root([dv]), { cols: 60, rows: 10 });
    pilot.expectScreen().toContainRow('+2');
    pilot.expectScreen().toContainRow('-1');
  });

  test('empty files renders blank', () => {
    const dv = DiffView({ id: 'dv', files: [], flexGrow: 1 });
    const pilot = createTestPilot(root([dv]), { cols: 40, rows: 5 });
    pilot.expectRow(0).toEqual(' '.repeat(40));
  });
});

describe('DiffView scrolling', () => {
  test('scroll down moves viewport', () => {
    const files = parseDiffText(SAMPLE_DIFF);
    const dv = DiffView({ id: 'dv', files, flexGrow: 1 });
    const pilot = createTestPilot(root([dv]), { cols: 60, rows: 3 });
    pilot.focusManager.focus(dv);
    pilot.pressKey('down');
    assert.equal(dv.scrollOffset, 1);
  });

  test('scroll up moves viewport back', () => {
    const files = parseDiffText(SAMPLE_DIFF);
    const dv = DiffView({ id: 'dv', files, flexGrow: 1 });
    dv.scrollOffset = 3;
    const pilot = createTestPilot(root([dv]), { cols: 60, rows: 3 });
    pilot.focusManager.focus(dv);
    pilot.pressKey('up');
    assert.equal(dv.scrollOffset, 2);
  });
});

describe('DiffView factory', () => {
  test('returns DiffViewWidget', () => {
    const dv = DiffView({ id: 'test' });
    if (!(dv instanceof DiffViewWidget)) throw new Error('should be DiffViewWidget');
    if (!(dv instanceof Widget)) throw new Error('should be Widget');
  });
});
