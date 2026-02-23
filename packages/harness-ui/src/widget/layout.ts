import type { Widget } from './widget.ts';
import { ZERO_RECT, type LayoutValue } from './widget.ts';

function resolveLayoutValue(value: LayoutValue, parentSize: number): number | null {
  if (value === 'auto') return null;
  if (typeof value === 'number') return Math.max(0, Math.floor(value));
  const match = value.match(/^(\d+(?:\.\d+)?)%$/);
  if (match === null) return null;
  return Math.max(0, Math.floor((parseFloat(match[1]!) / 100) * parentSize));
}

interface LayoutChild {
  widget: Widget;
  resolvedWidth: number | null;
  resolvedHeight: number | null;
  grow: number;
  shrink: number;
  mainSize: number;
  crossSize: number;
}

export function computeLayout(root: Widget, availableWidth: number, availableHeight: number): void {
  const w = Math.max(0, Math.floor(availableWidth));
  const h = Math.max(0, Math.floor(availableHeight));
  root.computedRect = { x: 0, y: 0, width: w, height: h };
  root.absoluteRect = { x: 0, y: 0, width: w, height: h };
  layoutChildren(root, w, h, 0, 0);
}

function layoutChildren(
  parent: Widget,
  containerWidth: number,
  containerHeight: number,
  absX: number,
  absY: number,
): void {
  const padding = parent.padding;
  const innerWidth = Math.max(0, containerWidth - padding.left - padding.right);
  const innerHeight = Math.max(0, containerHeight - padding.top - padding.bottom);
  const innerX = absX + padding.left;
  const innerY = absY + padding.top;

  const relativeChildren: Widget[] = [];
  const absoluteChildren: Widget[] = [];

  for (const child of parent.children) {
    if (!child.visible) {
      child.computedRect = ZERO_RECT;
      child.absoluteRect = ZERO_RECT;
      continue;
    }
    if (child.position === 'absolute') {
      absoluteChildren.push(child);
    } else {
      relativeChildren.push(child);
    }
  }

  layoutRelativeChildren(parent, relativeChildren, innerWidth, innerHeight, innerX, innerY);
  layoutAbsoluteChildren(absoluteChildren, innerWidth, innerHeight, innerX, innerY);
}

function layoutRelativeChildren(
  parent: Widget,
  children: Widget[],
  innerWidth: number,
  innerHeight: number,
  innerX: number,
  innerY: number,
): void {
  if (children.length === 0) return;

  const isRow = parent.flexDirection === 'row';
  const mainAxis = isRow ? innerWidth : innerHeight;
  const crossAxis = isRow ? innerHeight : innerWidth;
  const gap = Math.max(0, Math.floor(parent.gap));
  const totalGap = children.length > 1 ? gap * (children.length - 1) : 0;
  const availableMain = Math.max(0, mainAxis - totalGap);

  const items: LayoutChild[] = children.map((widget) => {
    const margin = widget.margin;
    const marginMain = isRow ? margin.left + margin.right : margin.top + margin.bottom;
    const marginCross = isRow ? margin.top + margin.bottom : margin.left + margin.right;

    const resolvedWidth = resolveLayoutValue(widget.width, innerWidth);
    const resolvedHeight = resolveLayoutValue(widget.height, innerHeight);

    const resolvedMain = isRow ? resolvedWidth : resolvedHeight;
    const resolvedCross = isRow ? resolvedHeight : resolvedWidth;

    const mainSize = resolvedMain !== null ? resolvedMain + marginMain : marginMain;
    const crossSize =
      resolvedCross !== null
        ? resolvedCross + marginCross
        : parent.alignItems === 'stretch'
          ? crossAxis
          : marginCross;

    return {
      widget,
      resolvedWidth,
      resolvedHeight,
      grow: Math.max(0, widget.flexGrow),
      shrink: Math.max(0, widget.flexShrink),
      mainSize,
      crossSize,
    };
  });

  let usedMain = 0;
  for (const item of items) {
    usedMain += item.mainSize;
  }

  const freeSpace = availableMain - usedMain;

  if (freeSpace > 0) {
    let totalGrow = 0;
    for (const item of items) totalGrow += item.grow;
    if (totalGrow > 0) {
      for (const item of items) {
        if (item.grow > 0) {
          const extra = Math.floor((freeSpace * item.grow) / totalGrow);
          item.mainSize += extra;
        }
      }
    }
  } else if (freeSpace < 0) {
    let totalShrink = 0;
    for (const item of items) totalShrink += item.shrink;
    if (totalShrink > 0) {
      const deficit = -freeSpace;
      for (const item of items) {
        if (item.shrink > 0) {
          const reduction = Math.floor((deficit * item.shrink) / totalShrink);
          item.mainSize = Math.max(0, item.mainSize - reduction);
        }
      }
    }
  }

  let totalUsed = 0;
  for (const item of items) totalUsed += item.mainSize;
  totalUsed += totalGap;
  const remainingSpace = Math.max(0, mainAxis - totalUsed);

  let mainOffset = 0;
  let gapBetween = gap;

  if (parent.justifyContent === 'center') {
    mainOffset = Math.floor(remainingSpace / 2);
  } else if (parent.justifyContent === 'end') {
    mainOffset = remainingSpace;
  } else if (parent.justifyContent === 'space-between' && items.length > 1) {
    gapBetween = gap + Math.floor(remainingSpace / (items.length - 1));
  }

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const margin = item.widget.margin;
    const marginMain = isRow ? margin.left + margin.right : margin.top + margin.bottom;
    const marginCross = isRow ? margin.top + margin.bottom : margin.left + margin.right;
    const marginMainStart = isRow ? margin.left : margin.top;
    const marginCrossStart = isRow ? margin.top : margin.left;

    const childMain = Math.max(0, item.mainSize - marginMain);
    let childCross: number;

    if (isRow) {
      childCross =
        item.resolvedHeight !== null
          ? item.resolvedHeight
          : parent.alignItems === 'stretch'
            ? Math.max(0, crossAxis - marginCross)
            : 0;
    } else {
      childCross =
        item.resolvedWidth !== null
          ? item.resolvedWidth
          : parent.alignItems === 'stretch'
            ? Math.max(0, crossAxis - marginCross)
            : 0;
    }

    let crossOffset = marginCrossStart;
    if (parent.alignItems === 'center') {
      crossOffset = Math.floor((crossAxis - childCross - marginCross) / 2) + marginCrossStart;
    } else if (parent.alignItems === 'end') {
      crossOffset = crossAxis - childCross - marginCross + marginCrossStart;
    }

    const x = isRow ? mainOffset + marginMainStart : crossOffset;
    const y = isRow ? crossOffset : mainOffset + marginMainStart;
    const w = isRow ? childMain : childCross;
    const h = isRow ? childCross : childMain;

    item.widget.computedRect = { x, y, width: w, height: h };
    item.widget.absoluteRect = {
      x: innerX + x,
      y: innerY + y,
      width: w,
      height: h,
    };

    layoutChildren(item.widget, w, h, innerX + x, innerY + y);

    mainOffset += item.mainSize + (i < items.length - 1 ? gapBetween : 0);
  }
}

function layoutAbsoluteChildren(
  children: Widget[],
  innerWidth: number,
  innerHeight: number,
  innerX: number,
  innerY: number,
): void {
  for (const child of children) {
    const x = child.left ?? 0;
    const y = child.top ?? 0;
    const w = resolveLayoutValue(child.width, innerWidth) ?? innerWidth;
    const h = resolveLayoutValue(child.height, innerHeight) ?? innerHeight;

    child.computedRect = { x, y, width: w, height: h };
    child.absoluteRect = {
      x: innerX + x,
      y: innerY + y,
      width: w,
      height: h,
    };

    layoutChildren(child, w, h, innerX + x, innerY + y);
  }
}
