import { describe, test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';
import { Widget, resetAutoIdCounter } from '../../packages/harness-ui/src/widget/widget.ts';
import {
  Markdown,
  MarkdownWidget,
  parseMarkdown,
} from '../../packages/harness-ui/src/widgets/markdown.ts';
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

beforeEach(() => {
  resetAutoIdCounter();
});

describe('parseMarkdown', () => {
  test('headings', () => {
    const blocks = parseMarkdown('# Title\n## Subtitle');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.kind, 'heading');
    assert.equal(blocks[0]!.level, 1);
    assert.equal(blocks[1]!.kind, 'heading');
    assert.equal(blocks[1]!.level, 2);
  });

  test('paragraph text', () => {
    const blocks = parseMarkdown('Hello world');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.kind, 'paragraph');
    assert.equal(blocks[0]!.spans[0]!.text, 'Hello world');
  });

  test('bold inline', () => {
    const blocks = parseMarkdown('some **bold** text');
    const spans = blocks[0]!.spans;
    assert.ok(spans.some((s) => s.kind === 'bold' && s.text === 'bold'));
  });

  test('italic inline', () => {
    const blocks = parseMarkdown('some *italic* text');
    const spans = blocks[0]!.spans;
    assert.ok(spans.some((s) => s.kind === 'italic' && s.text === 'italic'));
  });

  test('code inline', () => {
    const blocks = parseMarkdown('use `foo()` here');
    const spans = blocks[0]!.spans;
    assert.ok(spans.some((s) => s.kind === 'code' && s.text === 'foo()'));
  });

  test('link', () => {
    const blocks = parseMarkdown('click [here](http://example.com)');
    const spans = blocks[0]!.spans;
    assert.ok(spans.some((s) => s.kind === 'link-text' && s.text === 'here'));
  });

  test('fenced code block', () => {
    const blocks = parseMarkdown('```typescript\nconst x = 1;\nconsole.log(x);\n```');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.kind, 'code-block');
    assert.equal(blocks[0]!.language, 'typescript');
    assert.equal(blocks[0]!.rawLines!.length, 2);
    assert.equal(blocks[0]!.rawLines![0], 'const x = 1;');
  });

  test('blockquote', () => {
    const blocks = parseMarkdown('> quoted text');
    assert.equal(blocks[0]!.kind, 'blockquote');
    assert.ok(blocks[0]!.spans.some((s) => s.text === 'quoted text'));
  });

  test('list items', () => {
    const blocks = parseMarkdown('- item one\n- item two\n  - nested');
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.kind, 'list-item');
    assert.equal(blocks[2]!.kind, 'list-item');
    assert.equal(blocks[2]!.level, 1);
  });

  test('numbered list', () => {
    const blocks = parseMarkdown('1. first\n2. second');
    assert.equal(blocks[0]!.kind, 'list-item');
    assert.equal(blocks[1]!.kind, 'list-item');
  });

  test('horizontal rule', () => {
    const blocks = parseMarkdown('---');
    assert.equal(blocks[0]!.kind, 'horizontal-rule');
  });

  test('blank lines', () => {
    const blocks = parseMarkdown('a\n\nb');
    assert.equal(blocks.length, 3);
    assert.equal(blocks[1]!.kind, 'blank');
  });

  test('empty string', () => {
    const blocks = parseMarkdown('');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.kind, 'blank');
  });

  test('mixed content', () => {
    const md =
      '# Title\n\nSome **bold** and *italic* text.\n\n```js\nlet x = 1;\n```\n\n- item\n\n> quote\n\n---';
    const blocks = parseMarkdown(md);
    const kinds = blocks.map((b) => b.kind);
    assert.ok(kinds.includes('heading'));
    assert.ok(kinds.includes('paragraph'));
    assert.ok(kinds.includes('code-block'));
    assert.ok(kinds.includes('list-item'));
    assert.ok(kinds.includes('blockquote'));
    assert.ok(kinds.includes('horizontal-rule'));
  });
});

describe('Markdown rendering', () => {
  test('renders heading text', () => {
    const md = Markdown({ id: 'md', content: '# Hello', flexGrow: 1 });
    const pilot = createTestPilot(root([md]), { cols: 30, rows: 5 });
    pilot.expectScreen().toContainRow('Hello');
    pilot.expectRow(0).toContain('#');
  });

  test('renders bold with bold style', () => {
    const md = Markdown({ id: 'md', content: 'some **bold** word', flexGrow: 1 });
    const pilot = createTestPilot(root([md]), { cols: 30, rows: 3 });
    pilot.expectScreen().toContainRow('bold');
    pilot.expectCell(5, 0).toHaveStyle({ bold: true });
  });

  test('renders italic with italic style', () => {
    const md = Markdown({ id: 'md', content: 'some *italic* word', flexGrow: 1 });
    const pilot = createTestPilot(root([md]), { cols: 30, rows: 3 });
    pilot.expectScreen().toContainRow('italic');
    pilot.expectCell(5, 0).toHaveStyle({ italic: true });
  });

  test('renders code block lines', () => {
    const md = Markdown({ id: 'md', content: '```ts\nconst x = 1;\n```', flexGrow: 1 });
    const pilot = createTestPilot(root([md]), { cols: 30, rows: 5 });
    pilot.expectScreen().toContainRow('const x = 1;');
  });

  test('renders code block with language label', () => {
    const md = Markdown({ id: 'md', content: '```typescript\ncode\n```', flexGrow: 1 });
    const pilot = createTestPilot(root([md]), { cols: 30, rows: 5 });
    pilot.expectScreen().toContainRow('typescript');
  });

  test('renders blockquote with marker', () => {
    const md = Markdown({ id: 'md', content: '> quoted', flexGrow: 1 });
    const pilot = createTestPilot(root([md]), { cols: 30, rows: 3 });
    pilot.expectScreen().toContainRow('quoted');
    pilot.expectRow(0).toContain('▌');
  });

  test('renders list with bullet marker', () => {
    const md = Markdown({ id: 'md', content: '- item one\n- item two', flexGrow: 1 });
    const pilot = createTestPilot(root([md]), { cols: 30, rows: 5 });
    pilot.expectScreen().toContainRow('item one');
    pilot.expectScreen().toContainRow('item two');
    pilot.expectRow(0).toContain('•');
  });

  test('renders horizontal rule', () => {
    const md = Markdown({ id: 'md', content: '---', flexGrow: 1 });
    const pilot = createTestPilot(root([md]), { cols: 20, rows: 3 });
    pilot.expectRow(0).toContain('─');
  });

  test('renders link text with underline', () => {
    const md = Markdown({ id: 'md', content: 'click [here](http://x.com)', flexGrow: 1 });
    const pilot = createTestPilot(root([md]), { cols: 30, rows: 3 });
    pilot.expectScreen().toContainRow('here');
    const hereCol = pilot.rowText(0).indexOf('here');
    pilot.expectCell(hereCol, 0).toHaveStyle({ underline: true });
  });

  test('renders inline code', () => {
    const md = Markdown({ id: 'md', content: 'use `foo()`', flexGrow: 1 });
    const pilot = createTestPilot(root([md]), { cols: 30, rows: 3 });
    pilot.expectScreen().toContainRow('foo()');
  });

  test('empty content renders blank', () => {
    const md = Markdown({ id: 'md', content: '', flexGrow: 1 });
    const pilot = createTestPilot(root([md]), { cols: 20, rows: 3 });
    pilot.expectRow(0).toEqual('                    ');
  });
});

describe('Markdown streaming', () => {
  test('append adds content incrementally', () => {
    const md = Markdown({ id: 'md', flexGrow: 1 });
    md.append('# Title');
    const pilot = createTestPilot(root([md]), { cols: 30, rows: 5 });
    pilot.expectScreen().toContainRow('Title');
    md.append('\n\nMore text');
    pilot.resize(pilot.cols, pilot.rows);
    pilot.expectScreen().toContainRow('More text');
  });

  test('auto-scrolls to bottom on long content', () => {
    const md = Markdown({ id: 'md', flexGrow: 1 });
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i}`).join('\n');
    md.content = lines;
    const pilot = createTestPilot(root([md]), { cols: 30, rows: 5 });
    pilot.expectScreen().toContainRow('Line 19');
    pilot.expectScreen().not.toContainRow('Line 0');
  });
});

describe('Markdown with custom colors', () => {
  test('heading uses custom color', () => {
    const md = Markdown({ id: 'md', content: '# Hi', colors: { heading: '#FF0000' }, flexGrow: 1 });
    const pilot = createTestPilot(root([md]), { cols: 20, rows: 3 });
    pilot.expectCell(2, 0).toHaveStyle({ fg: { kind: 'rgb', r: 255, g: 0, b: 0 } });
  });
});

describe('Markdown factory', () => {
  test('returns MarkdownWidget', () => {
    const md = Markdown({});
    if (!(md instanceof MarkdownWidget)) throw new Error('should be MarkdownWidget');
    if (!(md instanceof Widget)) throw new Error('should be Widget');
  });
});
