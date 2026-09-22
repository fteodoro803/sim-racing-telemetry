// The dashboard's grid, its widget registry, and the built-in presets (DASHBOARD_PLAN.md).
//
// From the wireframes: a 12 column by 8 row grid, designed at 1180x820 (iPad landscape) with a
// 48px top bar, 16px margin and 12px gutters. The page scales this to any screen. A layout is an
// array of { widget, col, row, w, h, variant? }, each placing one widget by its top-left cell and
// its size in whole cells (1-based). `variant` only applies to widgets whose registry entry lists
// `variants` (D27 in DECISIONS.md): which shape the widget is drawn in, chosen explicitly in edit
// mode rather than picked automatically from the widget's size - content still scales fluidly with
// the box either way (D25), but the shape itself only changes when the user asks it to.
//
// No DOM here: the geometry helpers below are pure, so edit mode's drag/resize/collision logic can
// be tested without a browser (see tests/layout.test.mjs).

export const GRID = { cols: 12, rows: 8, baseWidth: 1180, baseHeight: 820, topBar: 48, margin: 16, gutter: 12 };

/**
 * Every widget that exists: its palette group ('timing' or 'driving'), the smallest size edit mode
 * will resize it to, the size it's added at from the palette (`addW`/`addH`), and, for widgets with
 * more than one shape, a `variants` list (`{id, title}`, first is the default). Steering, driver
 * aids and boost are deliberately absent - GT7's data for them either isn't decoded or isn't wanted
 * (D19 in DECISIONS.md) - and Fuel and Track map don't exist yet; the palette's "Coming later"
 * group is those, not this registry.
 */
export const WIDGET_META = {
  currentLap: { title: 'Current Lap', group: 'timing', minW: 2, minH: 2, addW: 3, addH: 2 },
  delta: { title: 'Delta', group: 'timing', minW: 2, minH: 2, addW: 3, addH: 2 },
  sectors: { title: 'Sectors', group: 'timing', minW: 3, minH: 2, addW: 6, addH: 2 },
  deltaChart: { title: 'Delta Chart', group: 'timing', minW: 3, minH: 2, addW: 6, addH: 2 },
  speedChart: { title: 'Speed Chart', group: 'timing', minW: 3, minH: 2, addW: 6, addH: 2 },
  lastLap: { title: 'Last Lap', group: 'timing', minW: 2, minH: 2, addW: 2, addH: 2 },
  bestLap: { title: 'Best Lap', group: 'timing', minW: 2, minH: 2, addW: 2, addH: 2 },
  predicted: { title: 'Predicted', group: 'timing', minW: 2, minH: 2, addW: 2, addH: 2 },
  lapTable: { title: 'Lap Table', group: 'timing', minW: 3, minH: 2, addW: 6, addH: 3 },
  rpmGear: {
    title: 'RPM + Gear', group: 'driving', minW: 2, minH: 2, addW: 3, addH: 2,
    variants: [
      { id: 'stacked', title: 'Stacked' },
      { id: 'column', title: 'Column' },
      { id: 'ring', title: 'Ring' },
    ],
  },
  speed: { title: 'Speed', group: 'driving', minW: 2, minH: 2, addW: 4, addH: 3 },
  pedals: {
    title: 'Pedals', group: 'driving', minW: 2, minH: 1, addW: 2, addH: 3,
    variants: [
      { id: 'vertical', title: 'Vertical' },
      { id: 'horizontal', title: 'Horizontal' },
    ],
  },
  tyres: { title: 'Tyres', group: 'driving', minW: 3, minH: 3, addW: 3, addH: 3 },
};

/** A widget's variant unless the layout item names one - the first entry in its registry list. */
export function defaultVariant(widgetId) {
  return WIDGET_META[widgetId]?.variants?.[0]?.id;
}

export const PRESET_IDS = ['everything', 'timing', 'driving', 'custom'];
export const PRESET_TITLES = { everything: 'Everything', timing: 'Timing', driving: 'Driving', custom: 'Custom' };

/** The built-in presets' default arrangements (DASHBOARD_PLAN.md sections 1 and 8.1). Custom has none: it starts blank (D24). */
export const PRESET_LAYOUTS = {
  everything: [
    { widget: 'currentLap', col: 1, row: 1, w: 3, h: 2 },
    { widget: 'delta', col: 4, row: 1, w: 3, h: 2 },
    { widget: 'sectors', col: 1, row: 3, w: 6, h: 2 },
    { widget: 'deltaChart', col: 1, row: 5, w: 6, h: 2 },
    { widget: 'lastLap', col: 1, row: 7, w: 2, h: 2 },
    { widget: 'bestLap', col: 3, row: 7, w: 2, h: 2 },
    { widget: 'predicted', col: 5, row: 7, w: 2, h: 2 },
    { widget: 'rpmGear', col: 7, row: 1, w: 2, h: 4, variant: 'stacked' },
    { widget: 'speed', col: 9, row: 1, w: 4, h: 4 },
    { widget: 'pedals', col: 7, row: 5, w: 2, h: 4, variant: 'vertical' },
    { widget: 'lapTable', col: 9, row: 5, w: 4, h: 4 },
  ],
  timing: [
    { widget: 'currentLap', col: 1, row: 1, w: 6, h: 2 },
    { widget: 'delta', col: 7, row: 1, w: 6, h: 2 },
    { widget: 'sectors', col: 1, row: 3, w: 12, h: 2 },
    { widget: 'speedChart', col: 1, row: 5, w: 6, h: 2 },
    { widget: 'deltaChart', col: 7, row: 5, w: 6, h: 2 },
    { widget: 'lastLap', col: 1, row: 7, w: 2, h: 2 },
    { widget: 'bestLap', col: 3, row: 7, w: 2, h: 2 },
    { widget: 'predicted', col: 5, row: 7, w: 2, h: 2 },
    { widget: 'lapTable', col: 7, row: 7, w: 6, h: 2 },
  ],
  driving: [
    { widget: 'rpmGear', col: 1, row: 1, w: 4, h: 5, variant: 'stacked' },
    { widget: 'speed', col: 5, row: 1, w: 6, h: 5 },
    { widget: 'currentLap', col: 11, row: 1, w: 2, h: 2 },
    { widget: 'delta', col: 11, row: 3, w: 2, h: 2 },
    { widget: 'pedals', col: 1, row: 6, w: 2, h: 3, variant: 'vertical' },
  ],
};

// ---- pure grid geometry (tested; used by edit mode's drag, resize and collision checks) ----

/** True if two placed items' cell rectangles overlap. */
export function itemsOverlap(a, b) {
  return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

/** True if `item` fits inside the grid without running off an edge. */
export function withinGrid(item, grid = GRID) {
  return item.col >= 1 && item.row >= 1 && item.col + item.w - 1 <= grid.cols && item.row + item.h - 1 <= grid.rows;
}

/** True if placing `item` into `layout` would overlap any entry at an index other than `excludeIndex`. */
export function hasCollision(layout, item, excludeIndex = -1) {
  return layout.some((other, i) => i !== excludeIndex && itemsOverlap(item, other));
}

/** True if `item` both fits the grid and doesn't collide with anything else already in `layout`. */
export function isValidPlacement(layout, item, excludeIndex = -1, grid = GRID) {
  return withinGrid(item, grid) && !hasCollision(layout, item, excludeIndex);
}

/** The first top-left cell (row-major) where a new `w`×`h` item fits `layout` without a collision, or null if none does. */
export function firstFreeSpot(layout, w, h, grid = GRID) {
  for (let row = 1; row <= grid.rows - h + 1; row++) {
    for (let col = 1; col <= grid.cols - w + 1; col++) {
      const candidate = { col, row, w, h };
      if (!hasCollision(layout, candidate)) return candidate;
    }
  }
  return null;
}

/**
 * The rectangle produced by dragging `item`'s `corner` handle ('nw', 'ne', 'sw' or 'se') so that
 * corner sits at `pointerCol`/`pointerRow`, keeping the opposite corner fixed. Never shrinks below
 * `minW`×`minH` (growing from the fixed corner instead) or moves off the grid.
 */
export function resizeFromCorner(item, corner, pointerCol, pointerRow, minW = 1, minH = 1, grid = GRID) {
  const leftFixed = corner === 'ne' || corner === 'se';
  const topFixed = corner === 'sw' || corner === 'se';
  const anchorCol = leftFixed ? item.col : item.col + item.w - 1;
  const anchorRow = topFixed ? item.row : item.row + item.h - 1;
  const pc = Math.max(1, Math.min(grid.cols, Math.round(pointerCol)));
  const pr = Math.max(1, Math.min(grid.rows, Math.round(pointerRow)));

  let col = Math.min(anchorCol, pc), w = Math.abs(pc - anchorCol) + 1;
  let row = Math.min(anchorRow, pr), h = Math.abs(pr - anchorRow) + 1;
  if (w < minW) { w = minW; col = leftFixed ? anchorCol : anchorCol - minW + 1; }
  if (h < minH) { h = minH; row = topFixed ? anchorRow : anchorRow - minH + 1; }
  col = Math.max(1, Math.min(col, grid.cols - w + 1));
  row = Math.max(1, Math.min(row, grid.rows - h + 1));
  return { ...item, col, row, w, h };
}
