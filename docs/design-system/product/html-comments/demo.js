/* SPDX-License-Identifier: GPL-3.0-only */
/* SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o. */
/* global document, window */
/*
 * Shared behaviour for the HTML preview comments cards. Card chrome, not app
 * code: each function implements a rule a card states, so the card can be
 * clicked and tabbed rather than read.
 */
(function () {
  'use strict';

  const svg = (paths, size) =>
    `<svg width="${size || 16}" height="${size || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor"` +
    ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">` +
    paths.map((d) => `<path d="${d}"></path>`).join('') + '</svg>';

  /* lucide paths, copied from node_modules/lucide-react – the registry glyphs the
     plan names (§3 "Pin glyph"), plus the band's existing tools. */
  const ICON_PATHS = {
    'message-square-plus': ['M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z', 'M12 8v6', 'M9 11h6'],
    'messages-square': ['M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z', 'M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1'],
    'message-square': ['M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z'],
    'message-square-off': ['M19 19H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.7.7 0 0 1 2 21.286V5a2 2 0 0 1 1.184-1.826', 'm2 2 20 20', 'M8.656 3H20a2 2 0 0 1 2 2v11.344'],
    x: ['M18 6 6 18', 'm6 6 12 12'],
    'triangle-alert': ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
    'circle-x': ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', 'm15 9-6 6', 'm9 9 6 6'],
    info: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', 'M12 16v-4', 'M12 8h.01'],
    check: ['M20 6 9 17l-5-5'],
    'chevron-down': ['m6 9 6 6 6-6'],
    'chevron-up': ['m18 15-6-6-6 6'],
    back: ['m12 19-7-7 7-7', 'M19 12H5'],
    links: ['M14 4.1 12 6', 'm5.1 8-2.9-.8', 'm6 12-1.9 2', 'M7.2 2.2 8 5.1', 'M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z'],
    find: ['M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0', 'm21 21-4.3-4.3'],
    browser: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
    pdf: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M12 18v-6', 'm9 15 3 3 3-3']
  };
  const ellipsis = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">' +
    '<circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle></svg>';
  const icon = (name, size) => (name === 'ellipsis' ? ellipsis : svg(ICON_PATHS[name], size));

  const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------- the pin, built the way src/preload/previewPageComments/pins.ts builds it ---------- */

  const PIN_PATH = 'M2 2H22V17H7L2 22Z';
  /** content: 'lines' | '!' | '9+' | '2'..'9' */
  function pinSvg(content) {
    let inner = `<path class="erf-hpc-pin__body" d="${PIN_PATH}"></path>`;
    if (content === 'lines') {
      inner += '<rect class="erf-hpc-pin__line" x="6" y="6" width="12" height="2"></rect>' +
               '<rect class="erf-hpc-pin__line" x="6" y="10" width="8" height="2"></rect>';
    } else {
      inner += `<text class="erf-hpc-pin__count" x="12" y="13">${esc(content)}</text>`;
    }
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner}</svg>`;
  }
  const pinContent = (open, damaged) => (damaged ? '!' : open === 1 ? 'lines' : open > 9 ? '9+' : String(open));

  /* ---------- time, as the comment window prints it (§10.4, R-016) ---------- */

  function formatCommentTime(date, now, locale) {
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((day(now) - day(date)) / 86400000);
    if (diff === 0) return `Today, ${time}`;
    if (diff === 1) return `Yesterday, ${time}`;
    const sameYear = date.getFullYear() === now.getFullYear();
    const dayPart = new Intl.DateTimeFormat(locale, sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
    return `${dayPart}, ${time}`;
  }

  /* ---------- bidi and zero-width controls drawn as visible tokens (S18, R-017) ---------- */

  const BIDI = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
  function visibleBidi(text) {
    return esc(text).replace(BIDI, (ch) => {
      const code = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
      return `<span class="erf-comment-bidi" title="Invisible control character U+${code}">⟨U+${code}⟩</span>`;
    });
  }

  /* ---------- a real focus trap (R-013) ---------- */

  const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';
  function trapFocus(container, onEscape) {
    const handler = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onEscape(); return; }
      if (event.key !== 'Tab') return;
      const nodes = [...container.querySelectorAll(FOCUSABLE)]
        .filter((n) => !n.hidden && n.offsetParent !== null && n.getAttribute('tabindex') !== '-1');
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    container.addEventListener('keydown', handler);
    return () => container.removeEventListener('keydown', handler);
  }

  /* ---------- the decided Menu card's contract, for the one-item menu ---------- */

  function openMenu(host, x, y, items, label, onChoose, onClose) {
    const menu = document.createElement('div');
    menu.className = 'erf-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    menu.style.position = 'absolute';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    for (const item of items) {
      const node = document.createElement('div');
      node.className = 'erf-menu-item' + (item.danger ? ' erf-menu-item--danger' : '');
      node.setAttribute('role', 'menuitem');
      node.tabIndex = -1;
      if (item.disabled) node.setAttribute('aria-disabled', 'true');
      node.innerHTML = `<span class="erf-menu-icon" aria-hidden="true">${item.icon ? icon(item.icon) : ''}</span>` +
        `<span class="erf-menu-label">${esc(item.label)}</span>`;
      node.addEventListener('click', () => {
        if (item.disabled) return;
        close(false);
        onChoose(item);
      });
      menu.appendChild(node);
    }
    host.appendChild(menu);
    // Flip at the edges: keep the whole menu inside its host.
    const box = host.getBoundingClientRect();
    const own = menu.getBoundingClientRect();
    if (own.right > box.right) menu.style.left = `${Math.max(0, x - own.width)}px`;
    if (own.bottom > box.bottom) menu.style.top = `${Math.max(0, y - own.height)}px`;

    const nodes = [...menu.querySelectorAll('.erf-menu-item')];
    const focusAt = (i) => {
      const at = (i + nodes.length) % nodes.length;
      nodes.forEach((n, k) => { n.tabIndex = k === at ? 0 : -1; n.classList.toggle('erf-menu-item--active', k === at); });
      nodes[at].focus();
    };
    let closed = false;
    function close(returnFocus) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', keys, true);
      document.removeEventListener('pointerdown', outside, true);
      menu.remove();
      onClose(returnFocus);
    }
    function keys(event) {
      const current = nodes.indexOf(document.activeElement);
      switch (event.key) {
        case 'ArrowDown': event.preventDefault(); focusAt(current + 1); return;
        case 'ArrowUp': event.preventDefault(); focusAt(current - 1); return;
        case 'Home': event.preventDefault(); focusAt(0); return;
        case 'End': event.preventDefault(); focusAt(nodes.length - 1); return;
        case 'Escape': case 'Tab': event.preventDefault(); event.stopPropagation(); close(true); return;
        case 'Enter': case ' ': event.preventDefault(); if (nodes[current]) nodes[current].click(); return;
        default:
          if (event.key.length === 1) {
            const at = nodes.findIndex((n) => n.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase()));
            if (at >= 0) focusAt(at);
          }
      }
    }
    function outside(event) { if (!menu.contains(event.target)) close(false); }
    document.addEventListener('keydown', keys, true);
    document.addEventListener('pointerdown', outside, true);
    focusAt(0);
    return { close };
  }

  /* Announce into an always-mounted live region (Feedback card, decision three). */
  function announce(region, text) {
    region.textContent = '';
    window.setTimeout(() => { region.textContent = text; }, 30);
  }

  /* ---------- drawing the overlay mirror, with the preload's geometry ---------- */

  const TINY = 8;          // TINY_ELEMENT_PX
  const OUTSET = 2;        // TINY_RING_OUTSET_PX
  const LABEL_GAP = 2;     // LABEL_GAP_PX (overlayView.ts)
  const TIP_OFFSET = 4;    // PIN_TIP_OFFSET_PX
  const PIN = 24;          // PIN_BOX_PX
  const STEP = 22;         // PIN_STEP_PX

  /** The element's border box inside `area`, in CSS pixels. */
  function boxIn(area, el) {
    const a = area.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return { left: b.left - a.left, top: b.top - a.top, width: b.width, height: b.height };
  }

  function root(area) {
    let r = area.querySelector(':scope > .erf-hpc-root');
    if (!r) { r = document.createElement('div'); r.className = 'erf-hpc-root'; area.appendChild(r); }
    return r;
  }

  const place = (el, box) => Object.assign(el.style, {
    left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`
  });

  /** Outline + label. label = { tag, rest, size }. */
  function drawOutline(area, box, label, selected) {
    const r = root(area);
    let outline = r.querySelector('.erf-hpc-outline');
    let tag = r.querySelector('.erf-hpc-label');
    if (!outline) {
      outline = document.createElement('div'); outline.className = 'erf-hpc-outline'; r.appendChild(outline);
      tag = document.createElement('div'); tag.className = 'erf-hpc-label';
      tag.innerHTML = '<span class="erf-hpc-label__tag"></span><span class="erf-hpc-label__rest"></span>' +
        '<span class="erf-hpc-label__size"></span>';
      r.appendChild(tag);
    }
    const grown = box.width < TINY || box.height < TINY
      ? { left: box.left - OUTSET, top: box.top - OUTSET, width: box.width + 2 * OUTSET, height: box.height + 2 * OUTSET }
      : box;
    place(outline, grown);
    outline.classList.toggle('erf-hpc-outline--selected', Boolean(selected));
    tag.children[0].textContent = label.tag;
    tag.children[1].textContent = label.rest || '';
    tag.children[2].textContent = label.size || '';
    const vw = area.clientWidth;
    const vh = area.clientHeight;
    const h = tag.offsetHeight;
    let top = grown.top - h - LABEL_GAP;
    if (top < 0) top = grown.top + grown.height + LABEL_GAP;
    if (top + h > vh) top = Math.max(grown.top, 0) + LABEL_GAP;
    tag.style.left = `${Math.max(0, Math.min(grown.left, vw - tag.offsetWidth))}px`;
    tag.style.top = `${top}px`;
  }

  function clearOutline(area) {
    const r = area.querySelector(':scope > .erf-hpc-root');
    if (!r) return;
    r.querySelectorAll('.erf-hpc-outline, .erf-hpc-label').forEach((n) => n.remove());
  }

  /** Pins for [{ box, count, damaged, name, selected, cls }], placed in document order with the
      22px collision step along the top edge. Returns the pin elements. */
  function drawPins(area, pins) {
    const r = root(area);
    r.querySelectorAll('.erf-hpc-pin').forEach((n) => n.remove());
    const vw = area.clientWidth;
    const vh = area.clientHeight;
    const placed = [];
    return pins.map((p) => {
      const tipX = p.box.left + p.box.width + TIP_OFFSET;
      const tipY = p.box.top - TIP_OFFSET;
      let left = Math.min(Math.max(tipX - 2, 0), vw - PIN);
      const top = Math.min(Math.max(tipY - 22, 0), vh - PIN);
      for (let moves = 0; moves < 8 && left - STEP >= 0; moves += 1) {
        const clash = placed.some((o) => Math.abs(o.top - top) < PIN && Math.abs(o.left - left) < PIN - 4);
        if (!clash) break;
        left -= STEP;
      }
      placed.push({ left, top });
      const el = document.createElement('div');
      el.className = 'erf-hpc-pin' + (p.damaged ? ' erf-hpc-pin--damaged' : '') +
        (p.selected ? ' erf-hpc-pin--selected' : '') + (p.cls ? ` ${p.cls}` : '');
      el.setAttribute('role', 'button');
      el.tabIndex = -1;
      el.setAttribute('aria-label', p.name);
      el.title = p.damaged ? 'Damaged comment – click to open'
        : `${p.count} ${p.count === 1 ? 'comment' : 'comments'} – click to open`;
      el.innerHTML = pinSvg(pinContent(p.count, p.damaged));
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      r.appendChild(el);
      return el;
    });
  }

  /** The comment-mode frame and tab. */
  function drawMode(area, on, bottom) {
    const r = root(area);
    let frame = r.querySelector('.erf-hpc-frame');
    let tab = r.querySelector('.erf-hpc-tab');
    if (!frame) {
      frame = document.createElement('div'); frame.className = 'erf-hpc-frame'; r.prepend(frame);
      tab = document.createElement('div'); tab.className = 'erf-hpc-tab'; tab.setAttribute('aria-hidden', 'true');
      tab.textContent = 'Comment mode – Esc to leave';
      r.appendChild(tab);
    }
    frame.classList.toggle('erf-hpc-hidden', !on);
    tab.classList.toggle('erf-hpc-hidden', !on);
    tab.classList.toggle('erf-hpc-tab--bottom', Boolean(bottom));
  }

  /** The element label: tag, #id and at most two classes, then "…", 40 characters at most. */
  function labelOf(el, suffix) {
    const tag = el.tagName.toLowerCase();
    let rest = el.id ? `#${el.id}` : '';
    const classes = [...el.classList];
    rest += classes.slice(0, 2).map((c) => `.${c}`).join('') + (classes.length > 2 ? '…' : '');
    rest += suffix || '';
    if ((tag + rest).length > 40) rest = `${rest.slice(0, 39 - tag.length)}…`;
    const b = el.getBoundingClientRect();
    return { tag, rest, size: `${Math.round(b.width)}×${Math.round(b.height)}` };
  }

  window.HPC = {
    icon, esc, pinSvg, pinContent, formatCommentTime, visibleBidi, trapFocus, openMenu, announce,
    boxIn, drawOutline, clearOutline, drawPins, drawMode, labelOf
  };
})();
