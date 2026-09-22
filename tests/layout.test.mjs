import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID, WIDGET_META, PRESET_LAYOUTS, itemsOverlap, withinGrid, hasCollision, isValidPlacement,
  firstFreeSpot, resizeFromCorner, defaultVariant,
} from '../web/layout.js';

test('itemsOverlap detects overlap and touching-but-not-overlapping cells', () => {
  const a = { col: 1, row: 1, w: 2, h: 2 };
  assert.equal(itemsOverlap(a, { col: 2, row: 2, w: 2, h: 2 }), true);   // corners overlap
  assert.equal(itemsOverlap(a, { col: 3, row: 1, w: 2, h: 2 }), false);  // adjacent, same row
  assert.equal(itemsOverlap(a, { col: 1, row: 3, w: 2, h: 2 }), false);  // adjacent, same column
  assert.equal(itemsOverlap(a, { col: 1, row: 1, w: 1, h: 1 }), true);   // identical top-left
});

test('withinGrid accepts anything inside the 12x8 grid and rejects anything that runs off an edge', () => {
  assert.equal(withinGrid({ col: 1, row: 1, w: 12, h: 8 }), true);   // exactly fills it
  assert.equal(withinGrid({ col: 12, row: 8, w: 1, h: 1 }), true);   // last cell
  assert.equal(withinGrid({ col: 1, row: 1, w: 13, h: 1 }), false);  // too wide
  assert.equal(withinGrid({ col: 0, row: 1, w: 1, h: 1 }), false);   // col is 1-based
  assert.equal(withinGrid({ col: 12, row: 8, w: 2, h: 1 }), false);  // runs off the right
});

test('hasCollision ignores the item at excludeIndex (checking a widget against the rest of the layout)', () => {
  const layout = [
    { col: 1, row: 1, w: 2, h: 2 },
    { col: 5, row: 1, w: 2, h: 2 },
  ];
  assert.equal(hasCollision(layout, layout[0], 0), false);   // excluded from the check: itself, in place
  assert.equal(hasCollision(layout, layout[0]), true);       // not excluded: collides with itself
  assert.equal(hasCollision(layout, { col: 3, row: 1, w: 2, h: 2 }), false);   // clear gap between the two
  assert.equal(hasCollision(layout, { col: 4, row: 1, w: 2, h: 2 }), true);    // overlaps the second item
});

test('isValidPlacement requires both fitting the grid and not colliding', () => {
  const layout = [{ col: 1, row: 1, w: 2, h: 2 }];
  assert.equal(isValidPlacement(layout, { col: 3, row: 1, w: 2, h: 2 }), true);
  assert.equal(isValidPlacement(layout, { col: 1, row: 1, w: 2, h: 2 }, 0), true);   // itself, excluded
  assert.equal(isValidPlacement(layout, { col: 2, row: 1, w: 2, h: 2 }), false);     // collides
  assert.equal(isValidPlacement(layout, { col: 12, row: 1, w: 2, h: 2 }), false);    // off the grid
});

test('firstFreeSpot finds the first row-major gap, and null when nothing fits', () => {
  assert.deepEqual(firstFreeSpot([], 2, 2), { col: 1, row: 1, w: 2, h: 2 });
  const layout = [{ col: 1, row: 1, w: 12, h: 1 }];   // blocks all of row 1
  assert.deepEqual(firstFreeSpot(layout, 2, 2), { col: 1, row: 2, w: 2, h: 2 });
  const full = [{ col: 1, row: 1, w: GRID.cols, h: GRID.rows }];
  assert.equal(firstFreeSpot(full, 1, 1), null);
});

test('resizeFromCorner grows from the dragged corner, keeping the opposite one fixed', () => {
  const item = { widget: 'x', col: 3, row: 3, w: 2, h: 2 };   // occupies col 3-4, row 3-4
  // se: top-left (3,3) fixed; dragging the bottom-right corner out to col 6, row 6.
  assert.deepEqual(resizeFromCorner(item, 'se', 6, 6), { widget: 'x', col: 3, row: 3, w: 4, h: 4 });
  // nw: bottom-right (4,4) fixed; dragging the top-left corner out to col 1, row 1.
  assert.deepEqual(resizeFromCorner(item, 'nw', 1, 1), { widget: 'x', col: 1, row: 1, w: 4, h: 4 });
  // ne: bottom-left (3,4) fixed; dragging the top-right corner to col 6, row 1.
  assert.deepEqual(resizeFromCorner(item, 'ne', 6, 1), { widget: 'x', col: 3, row: 1, w: 4, h: 4 });
  // sw: top-right (4,3) fixed; dragging the bottom-left corner to col 1, row 6.
  assert.deepEqual(resizeFromCorner(item, 'sw', 1, 6), { widget: 'x', col: 1, row: 3, w: 4, h: 4 });
});

test('resizeFromCorner never shrinks below the minimum, growing back from the fixed corner instead', () => {
  const item = { col: 3, row: 3, w: 4, h: 4 };
  // se, dragged inward past the minimum: right/bottom edge stops at col+minW-1 / row+minH-1.
  const shrunk = resizeFromCorner(item, 'se', 3, 3, 2, 2);
  assert.deepEqual(shrunk, { col: 3, row: 3, w: 2, h: 2 });
  // nw, dragged inward past the minimum: the fixed corner is bottom-right, so the box keeps that
  // corner and grows back up-left only as far as the minimum allows.
  const shrunkNw = resizeFromCorner(item, 'nw', 6, 6, 2, 2);
  assert.deepEqual(shrunkNw, { col: 5, row: 5, w: 2, h: 2 });
});

test('resizeFromCorner never leaves the grid', () => {
  const item = { col: 1, row: 1, w: 2, h: 2 };
  const grown = resizeFromCorner(item, 'se', 999, 999, 1, 1, GRID);
  assert.equal(grown.col + grown.w - 1, GRID.cols);
  assert.equal(grown.row + grown.h - 1, GRID.rows);
});

test('every built-in preset places only registered widgets, none twice, none colliding, none off the grid', () => {
  for (const [name, layout] of Object.entries(PRESET_LAYOUTS)) {
    const seen = new Set();
    for (const item of layout) {
      assert.ok(WIDGET_META[item.widget], `${name}: unknown widget "${item.widget}"`);
      assert.ok(!seen.has(item.widget), `${name}: "${item.widget}" appears twice`);
      seen.add(item.widget);
      assert.ok(withinGrid(item, GRID), `${name}: "${item.widget}" runs off the grid`);
      assert.ok(item.w >= WIDGET_META[item.widget].minW, `${name}: "${item.widget}" narrower than its minimum`);
      assert.ok(item.h >= WIDGET_META[item.widget].minH, `${name}: "${item.widget}" shorter than its minimum`);
      const variants = WIDGET_META[item.widget].variants;
      if (variants) assert.ok(variants.some((v) => v.id === item.variant), `${name}: "${item.widget}" has an unregistered variant "${item.variant}"`);
      else assert.equal(item.variant, undefined, `${name}: "${item.widget}" has no variants but names one`);
    }
    for (let i = 0; i < layout.length; i++) {
      assert.ok(!hasCollision(layout, layout[i], i), `${name}: "${layout[i].widget}" collides with another widget`);
    }
  }
});

test('defaultVariant is a widget\'s first registered variant, or undefined if it has none', () => {
  assert.equal(defaultVariant('rpm'), 'compact');
  assert.equal(defaultVariant('pedals'), 'vertical');
  assert.equal(defaultVariant('gear'), undefined);
  assert.equal(defaultVariant('not-a-widget'), undefined);
});
