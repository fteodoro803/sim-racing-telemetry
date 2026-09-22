// Small DOM helpers shared by the widgets and the page.

/** Set an element's text only if it changed, so a per-frame render doesn't rewrite the DOM needlessly. */
export const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

/** Set an element's class only if it changed (same reason as `setText`). */
export const setClass = (node, cls) => { if (node.className !== cls) node.className = cls; };

/** CSS class for a delta in ms: faster (negative) is good, slower (positive) is bad. */
export const deltaClass = (ms) => (ms == null ? '' : ms < 0 ? 'good' : ms > 0 ? 'bad' : '');

/** Create an element with a class and optional text. */
export function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create a namespaced SVG element with the given attributes (e.g. `svgEl('path', { d: '...' })`). */
export function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}
