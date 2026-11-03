// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The fixed page functions of pick mode and the capture (spec 025,
 * 025-FR-026, 025-FR-027, 025-FR-033, 025-FR-035, 025-FR-037; solution design
 * § 4, § 5; ADR 0007 decisions 3 and 10; spec change S-14).
 *
 * Each is a `Runtime.callFunctionOn` declaration registered in
 * `cdpPinned.ts`'s `CDP_PAGE_FUNCTIONS`, compared by exact source; no caller
 * can build one at run time. All but the React lookup run in Erfana's
 * isolated world, where the page cannot replace the DOM methods they call;
 * the React lookup must run in the page's main world, where React keeps its
 * fibers, so its result is untrusted and validated in main
 * (`capture/sourceHints.ts`).
 *
 * Every function is pinned to `throwOnSideEffect: true`: it only reads. The
 * DOM calls used here are marked side-effect free in Blink's IDL
 * (`getBoundingClientRect`, `querySelectorAll`, `getComputedStyle`,
 * `getAttribute`); a page getter that writes state aborts the call. None of
 * them may run while the page is frozen (ADR 0008 probe: a call on a page
 * with a pending pause hangs) – the capture reads everything it needs first.
 *
 * Results cross the protocol by value, each string cut in the page, so a
 * hostile page cannot send megabytes through a read.
 */
import type { CdpPageFunction } from './cdpPinned'

/** Longest string a pick read returns, in UTF-16 units (025-FR-037 caps page strings at 500). */
export const PICK_STRING_MAX = 500
/** Longest selector part returned. */
export const PICK_SELECTOR_MAX = 2000
/** Most elements in one chain read (a pathological nesting depth). */
export const PICK_CHAIN_MAX = 1000

/** The source-location attributes of 025-FR-037 rule 1, exactly; other attributes are ignored. */
export const SOURCE_ATTRIBUTE_NAMES: readonly string[] = Object.freeze([
  'data-source',
  'data-source-file',
  'data-component-path',
  'data-inspector-relative-path',
  'data-inspector-line',
  'data-inspector-column'
])

/** The computed styles of 025-FR-033, in the spec's order. */
export const COMPUTED_STYLE_NAMES: readonly string[] = Object.freeze([
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'margin',
  'padding',
  'border',
  'box-sizing',
  'overflow',
  'z-index',
  'visibility',
  'transform',
  'flex',
  'flex-direction',
  'flex-wrap',
  'align-self',
  'justify-content',
  'align-items',
  'gap',
  'grid-template-columns',
  'grid-area',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'white-space',
  'text-overflow',
  'word-break',
  'color',
  'background-color',
  'opacity'
])

/** How many ancestors the layout chain lists (025-FR-033). */
export const LAYOUT_CHAIN_DEPTH = 3

/** The parent as Up sees it: the parent element, or a shadow root's host (025-FR-027). */
const UP = `function (n) { if (n.parentElement) return n.parentElement; const p = n.parentNode; return p && p.host ? p.host : null }`

/**
 * Identifier escaping for selectors (the CSSOM "serialize an identifier"
 * rules). `CSS.escape` would do it, but V8's side-effect check refuses it
 * (commit-14 probe), so the rules are written out with string operations.
 */
const ESCAPE = `function (s) {
    let out = '';
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      const c = s.charCodeAt(i);
      if (c === 0) { out += '\\uFFFD'; continue; }
      const digitAt = (k) => c >= 48 && c <= 57 && i === k;
      if ((c >= 1 && c <= 31) || c === 127 || digitAt(0) || (digitAt(1) && s.charCodeAt(0) === 45)) { out += '\\\\' + c.toString(16) + ' '; continue; }
      if (i === 0 && c === 45 && s.length === 1) { out += '\\\\' + ch; continue; }
      if (c >= 128 || c === 45 || c === 95 || (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) { out += ch; continue; }
      out += '\\\\' + ch;
    }
    return out;
  }`

/**
 * The element and its ancestors to its document's root element, crossing
 * shadow roots to their hosts, with what the label, the ancestor path and the
 * source hints need; and the selector chain of 025-FR-033 for the element.
 *
 * Written without `getRootNode`, `CSS.escape` and `getPropertyValue`, which
 * V8's side-effect check refuses (commit-14 probe, Electron 44.9.3): roots are
 * found by walking `parentNode`, a shadow root being the node of type 11 with
 * a `host`.
 */
export const PICK_CHAIN: CdpPageFunction = Object.freeze({
  name: 'pickChain',
  source: `function () {
  const cut = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const names = ${JSON.stringify(SOURCE_ATTRIBUTE_NAMES)};
  const isShadow = (n) => !!n && n.nodeType === 11 && !!n.host;
  const chain = [];
  let pending = [];
  for (let el = this; el && chain.length < ${PICK_CHAIN_MAX};) {
    const r = el.getBoundingClientRect();
    const attrs = [];
    for (const name of names) {
      const value = el.getAttribute(name);
      if (value !== null) attrs.push([name, cut(value, ${PICK_STRING_MAX})]);
    }
    chain.push({
      tag: cut(el.localName, ${PICK_STRING_MAX}),
      id: cut(el.getAttribute('id') || '', ${PICK_STRING_MAX}),
      cls: cut(el.getAttribute('class') || '', ${PICK_STRING_MAX}),
      x: r.x, y: r.y, w: r.width, h: r.height,
      shadow: null,
      attrs
    });
    pending.push(chain.length - 1);
    if (el.parentElement) { el = el.parentElement; continue; }
    const p = el.parentNode;
    if (isShadow(p)) {
      for (const i of pending) chain[i].shadow = p.mode === 'closed' ? 'closed' : 'open';
      pending = [];
      el = p.host;
      continue;
    }
    el = null;
  }
  const esc = ${ESCAPE};
  const unique = (root, s, el) => { try { return root.querySelectorAll(s).length === 1 && root.querySelector(s) === el } catch (e) { return false } };
  const part = (n) => {
    let s = esc(n.localName);
    const id = n.getAttribute('id');
    if (id) return s + '#' + esc(id);
    const cls = (n.getAttribute('class') || '').split(/[\\t\\n\\f\\r ]+/).filter(Boolean).slice(0, 3);
    for (const c of cls) s += '.' + esc(c);
    const parent = n.parentNode;
    if (parent && parent.children) {
      const same = Array.prototype.filter.call(parent.children, (c) => c.localName === n.localName);
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
    }
    return s;
  };
  const selectorIn = (el, root) => {
    const parts = [];
    for (let n = el; n && n !== root && n.nodeType === 1; n = n.parentNode) {
      parts.unshift(part(n));
      const s = parts.join(' > ');
      if (unique(root, s, el)) return s;
    }
    return parts.join(' > ');
  };
  const rootOf = (n) => { let r = n; for (let i = 0; r.parentNode && i < ${PICK_CHAIN_MAX}; i += 1) r = r.parentNode; return r };
  const selectors = [];
  let closed = false;
  for (let t = this; t;) {
    const root = rootOf(t);
    if (!isShadow(root)) { selectors.unshift(cut(selectorIn(t, root), ${PICK_SELECTOR_MAX})); break; }
    if (root.mode === 'closed') { closed = true; selectors.length = 0; }
    else selectors.unshift(cut(selectorIn(t, root), ${PICK_SELECTOR_MAX}));
    t = root.host;
  }
  return { chain, selectors, closed, connected: this.isConnected };
}`,
  throwOnSideEffect: true
})

/** The element `k` steps up the chain of {@link PICK_CHAIN} (0 is the element itself), or null. */
export const PICK_ANCESTOR: CdpPageFunction = Object.freeze({
  name: 'pickAncestor',
  source: `function (k) {
  const up = ${UP};
  let el = this;
  for (let i = 0; el && i < k; i += 1) el = up(el);
  return el || null;
}`,
  throwOnSideEffect: true
})

/**
 * The computed styles of 025-FR-033 and the layout chain of up to three
 * ancestors. Read as camelCase properties: `getPropertyValue` is refused by
 * V8's side-effect check (commit-14 probe).
 */
export const PICK_STYLES: CdpPageFunction = Object.freeze({
  name: 'pickStyles',
  source: `function () {
  const up = ${UP};
  const cut = (v) => (typeof v === 'string' ? v.slice(0, ${PICK_STRING_MAX}) : '');
  const cs = getComputedStyle(this);
  const camel = (name) => name.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
  const styles = ${JSON.stringify(COMPUTED_STYLE_NAMES)}.map((name) => [name, cut(cs[camel(name)])]);
  const layout = [];
  for (let p = up(this); p && layout.length < ${LAYOUT_CHAIN_DEPTH}; p = up(p)) {
    const s = getComputedStyle(p);
    layout.push({ tag: cut(p.localName), display: cut(s.display), position: cut(s.position), overflow: cut(s.overflow), width: cut(s.width), height: cut(s.height) });
  }
  return { styles, layout };
}`,
  throwOnSideEffect: true
})

/** Most owners the React lookup returns (025-FR-037). */
export const REACT_OWNER_MAX = 5

/**
 * The React development-build lookup (025-FR-037 rule 2), in the page's main
 * world: the nearest component of the element, its owner chain and the
 * element's JSX source (`_debugSource`, React 18 development builds). Every
 * value is the page's; main accepts only the shape it expects.
 */
export const REACT_LOOKUP: CdpPageFunction = Object.freeze({
  name: 'reactLookup',
  source: `function () {
  const cut = (v) => (typeof v === 'string' ? v.slice(0, ${PICK_STRING_MAX}) : null);
  let fiber = null;
  for (let n = this, depth = 0; n && !fiber && depth < 100; depth += 1) {
    for (const key of Object.keys(n)) {
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) { fiber = n[key]; break; }
    }
    n = n.parentNode || (n.host || null);
  }
  if (!fiber || typeof fiber !== 'object') return null;
  const nameOf = (f) => {
    const t = f && f.type;
    if (typeof t === 'function') return cut(t.displayName || t.name);
    if (t && typeof t === 'object') {
      const inner = t.render || t.type;
      return cut(t.displayName || (inner && (inner.displayName || inner.name)) || null);
    }
    return null;
  };
  const isComponent = (f) => !!f && !!f.type && typeof f.type !== 'string';
  let component = fiber.return;
  for (let i = 0; component && !isComponent(component) && i < 500; i += 1) component = component.return;
  const owners = [];
  for (let o = component ? component._debugOwner : null, i = 0; o && owners.length < ${REACT_OWNER_MAX} && i < 100; i += 1, o = o._debugOwner) {
    const name = nameOf(o);
    if (name) owners.push(name);
  }
  let source = null;
  for (let f = fiber, i = 0; f && !source && i < 500; i += 1, f = f.return) {
    const d = f._debugSource;
    if (d && typeof d.fileName === 'string') {
      source = { file: cut(d.fileName), line: typeof d.lineNumber === 'number' ? d.lineNumber : null, column: typeof d.columnNumber === 'number' ? d.columnNumber : null };
    }
  }
  return { component: component ? nameOf(component) : null, owners, source };
}`,
  throwOnSideEffect: true
})

/** Every pick function, for the registry in `cdpPinned.ts`. */
export const PICK_PAGE_FUNCTIONS: readonly CdpPageFunction[] = Object.freeze([
  PICK_CHAIN,
  PICK_ANCESTOR,
  PICK_STYLES,
  REACT_LOOKUP
])
