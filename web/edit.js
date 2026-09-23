// Edit mode's pointer interactions: drag, resize, palette-add and remove (DASHBOARD_PLAN.md
// section 8.2). Pure geometry (collision, resize math) lives in layout.js and is tested there; this
// file is the DOM/pointer wiring on top of it, in the same spirit as app.js.
//
// Operates on a "draft" layout array owned by the caller (app.js): this module never decides when
// to persist it, only calls `onChange(nextLayout)` whenever a move, resize, add or remove commits.

import { GRID, WIDGET_META, hasCollision, withinGrid, resizeFromCorner, firstFreeSpot, defaultVariant } from './layout.js';
import { el } from './dom.js';

/** Pixel size of one grid cell, read from the grid element's own current geometry. */
function cellMetrics(gridEl) {
  const rect = gridEl.getBoundingClientRect();
  const cs = getComputedStyle(gridEl);
  const colGap = parseFloat(cs.columnGap) || 0;
  const rowGap = parseFloat(cs.rowGap) || 0;
  return {
    rect,
    colGap,
    rowGap,
    colStep: (rect.width - colGap * (GRID.cols - 1)) / GRID.cols + colGap,
    rowStep: (rect.height - rowGap * (GRID.rows - 1)) / GRID.rows + rowGap,
  };
}

/** The 1-based cell column/row under a page point, clamped to the grid. */
function pointToCell(metrics, pageX, pageY) {
  const col = Math.floor((pageX - metrics.rect.left) / metrics.colStep) + 1;
  const row = Math.floor((pageY - metrics.rect.top) / metrics.rowStep) + 1;
  return {
    col: Math.max(1, Math.min(GRID.cols, col)),
    row: Math.max(1, Math.min(GRID.rows, row)),
  };
}

/** Absolute pixel rect (relative to the grid) that cells col/row/w/h occupy, for the ghost and the dragged card. */
function cellsToPixels(metrics, item) {
  return {
    left: (item.col - 1) * metrics.colStep,
    top: (item.row - 1) * metrics.rowStep,
    width: item.w * metrics.colStep - metrics.colGap,
    height: item.h * metrics.rowStep - metrics.rowGap,
  };
}

function placeGhost(ghostEl, metrics, item, valid) {
  const px = cellsToPixels(metrics, item);
  ghostEl.style.left = `${px.left}px`;
  ghostEl.style.top = `${px.top}px`;
  ghostEl.style.width = `${px.width}px`;
  ghostEl.style.height = `${px.height}px`;
  ghostEl.classList.toggle('invalid', !valid);
  ghostEl.hidden = false;
}

/**
 * Wire drag, resize, remove and palette-add on an edit-mode grid.
 *
 * `gridEl` already holds one `.widget[data-widget]` card per entry in `layout` (built by app.js's
 * renderGrid), each with the edit-chrome elements from `buildEditChrome`. `getLayout`/`onChange`
 * read and commit the draft layout; `onTintCollisions` lets the caller highlight whichever other
 * widgets a drag/resize would currently collide with (cleared by passing an empty array).
 *
 * `ghostEl` is a `.ghost` element the caller owns and keeps in the grid across rebuilds (a full
 * `renderGrid` happens on every commit, which would otherwise destroy one created in here).
 */
export function wireEditMode(gridEl, { getLayout, onChange, onTintCollisions, ghostEl: ghost }) {
  function endInteraction() {
    ghost.hidden = true;
    onTintCollisions([]);
    gridEl.classList.remove('dragging');
  }

  function startMove(card, widgetId, pointerId) {
    const metrics = cellMetrics(gridEl);
    const layout = getLayout();
    const index = layout.findIndex((it) => it.widget === widgetId);
    if (index === -1) return;
    const item = layout[index];
    const offset = { dx: item.w / 2, dy: item.h / 2 };   // keep the card centred under the pointer
    gridEl.classList.add('dragging');
    card.classList.add('is-dragging');

    function onMove(event) {
      const cell = pointToCell(metrics, event.clientX, event.clientY);
      const col = Math.max(1, Math.min(GRID.cols - item.w + 1, Math.round(cell.col - offset.dx)));
      const row = Math.max(1, Math.min(GRID.rows - item.h + 1, Math.round(cell.row - offset.dy)));
      const candidate = { ...item, col, row };
      const others = layout.filter((_, i) => i !== index);
      const collisions = others.filter((o) => hasCollision([o], candidate));
      const valid = withinGrid(candidate) && collisions.length === 0;
      placeGhost(ghost, metrics, candidate, valid);
      onTintCollisions(collisions.map((c) => c.widget));
      card._pendingPlacement = valid ? candidate : null;
    }
    function onUp() {
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerup', onUp);
      card.removeEventListener('pointercancel', onUp);
      card.removeEventListener('lostpointercapture', onUp);
      card.releasePointerCapture(pointerId);
      card.classList.remove('is-dragging');
      endInteraction();
      if (card._pendingPlacement) {
        const next = layout.slice();
        next[index] = card._pendingPlacement;
        onChange(next);
      }
      card._pendingPlacement = null;
    }
    card.setPointerCapture(pointerId);
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerup', onUp);
    card.addEventListener('pointercancel', onUp);
    // Safety net: if capture ends without a pointerup ever reaching us (button released outside the
    // window, the OS eating the event mid-drag), this still fires and clears the stuck ghost/highlight.
    card.addEventListener('lostpointercapture', onUp);
  }

  function startResize(card, widgetId, corner, pointerId) {
    const metrics = cellMetrics(gridEl);
    const layout = getLayout();
    const index = layout.findIndex((it) => it.widget === widgetId);
    if (index === -1) return;
    const item = layout[index];
    const meta = WIDGET_META[widgetId] || { minW: 1, minH: 1 };
    let pending = null;

    function onMove(event) {
      const cell = pointToCell(metrics, event.clientX, event.clientY);
      const candidate = resizeFromCorner(item, corner, cell.col, cell.row, meta.minW, meta.minH);
      const others = layout.filter((_, i) => i !== index);
      const collisions = others.filter((o) => hasCollision([o], candidate));
      const valid = collisions.length === 0;
      placeGhost(ghost, metrics, candidate, valid);
      onTintCollisions(collisions.map((c) => c.widget));
      pending = valid ? candidate : null;
    }
    function onUp() {
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerup', onUp);
      card.removeEventListener('pointercancel', onUp);
      card.removeEventListener('lostpointercapture', onUp);
      card.releasePointerCapture(pointerId);
      endInteraction();
      if (pending) {
        const next = layout.slice();
        next[index] = pending;
        onChange(next);
      }
    }
    card.setPointerCapture(pointerId);
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerup', onUp);
    card.addEventListener('pointercancel', onUp);
    // Safety net: if capture ends without a pointerup ever reaching us (button released outside the
    // window, the OS eating the event mid-drag), this still fires and clears the stuck ghost/highlight.
    card.addEventListener('lostpointercapture', onUp);
  }

  function removeWidget(widgetId) {
    onChange(getLayout().filter((it) => it.widget !== widgetId));
  }

  /** Change which shape a widget is drawn in (D27); its position and size are untouched. */
  function setVariant(widgetId, variant) {
    const layout = getLayout();
    const index = layout.findIndex((it) => it.widget === widgetId);
    if (index === -1) return;
    const next = layout.slice();
    next[index] = { ...next[index], variant };
    onChange(next);
  }

  /**
   * Add `widgetId` at its registry default size, at the first free spot; a no-op if nothing fits.
   * `variant` picks the shape to place it with (from the palette's variant picker); defaults to the
   * registry's first variant when the caller doesn't have one chosen yet.
   */
  function addWidget(widgetId, variant) {
    const meta = WIDGET_META[widgetId];
    if (!meta) return;
    const layout = getLayout();
    if (layout.some((it) => it.widget === widgetId)) return;   // already on the grid
    const spot = firstFreeSpot(layout, meta.addW, meta.addH);
    if (!spot) return;
    const chosen = variant || defaultVariant(widgetId);
    onChange([...layout, { widget: widgetId, ...spot, ...(chosen ? { variant: chosen } : {}) }]);
  }

  return { startMove, startResize, removeWidget, addWidget, setVariant };
}

/**
 * The drag handle, remove button, four resize handles and size tag added to a card while editing.
 * `variants` (from the widget's registry entry, if it has more than one shape) also adds a select
 * for choosing between them - D27, so a widget's shape is chosen explicitly, not picked from its size.
 */
export function buildEditChrome(widgetId, variants) {
  const chrome = el('div', 'edit-chrome');
  const drag = el('button', 'drag-handle');
  drag.type = 'button';
  drag.setAttribute('aria-label', 'Drag to move');
  drag.textContent = '⠿';
  const remove = el('button', 'remove-btn');
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove widget');
  remove.textContent = '×';
  const size = el('span', 'size-tag');
  chrome.append(drag, remove, size);
  for (const corner of ['nw', 'ne', 'sw', 'se']) chrome.append(el('span', `resize-handle ${corner}`));
  let select = null;
  if (variants && variants.length > 1) {
    select = document.createElement('select');
    select.className = 'variant-select';
    select.setAttribute('aria-label', 'Widget shape');
    for (const v of variants) {
      const option = document.createElement('option');
      option.value = v.id;
      option.textContent = v.title;
      select.append(option);
    }
    chrome.append(select);
  }
  return { chrome, drag, remove, size, select };
}
