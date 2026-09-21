// The dashboard's grid and its default arrangement of widgets.
//
// From the wireframes (see DASHBOARD_PLAN.md): a 12 column by 8 row grid, designed at 1180x820 (iPad
// landscape) with a 48px top bar, 16px margin and 12px gutters. The page scales this to any screen.
// Each entry places one widget by its top-left cell and its size in whole cells.

export const GRID = { cols: 12, rows: 8, baseWidth: 1180, baseHeight: 820, topBar: 48, margin: 16, gutter: 12 };

export const DEFAULT_LAYOUT = [
  // Timing, left half
  { widget: 'currentLap', col: 1, row: 1, w: 3, h: 2 },
  { widget: 'delta',      col: 4, row: 1, w: 3, h: 2 },
  { widget: 'sectors',    col: 1, row: 3, w: 6, h: 2 },
  { widget: 'deltaChart', col: 1, row: 5, w: 6, h: 2 },
  { widget: 'lastLap',    col: 1, row: 7, w: 2, h: 2 },
  { widget: 'bestLap',    col: 3, row: 7, w: 2, h: 2 },
  { widget: 'predicted',  col: 5, row: 7, w: 2, h: 2 },
  // Driving, right half
  { widget: 'rpm',        col: 7, row: 1, w: 6, h: 1 },
  { widget: 'gear',       col: 7, row: 2, w: 2, h: 3 },
  { widget: 'speed',      col: 9, row: 2, w: 4, h: 3 },
  { widget: 'pedals',     col: 7, row: 5, w: 2, h: 4 },
  { widget: 'lapTable',   col: 9, row: 5, w: 4, h: 4 },
];
