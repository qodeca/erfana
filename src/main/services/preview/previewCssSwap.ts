// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * CSS hot-swap script builder for the HTML preview (Issue #74, work item 33;
 * design §1.4, §5(b)).
 *
 * When a single stylesheet changes on disk, the preview swaps it in place
 * instead of reloading the whole page. This module builds the tiny script that
 * `PreviewViewService` runs via `executeJavaScriptInIsolatedWorld` (so a page
 * that redefines `Array.prototype.find` or `Promise` cannot shadow it), raced
 * against `PREVIEW.SWAP_TIMEOUT_MS`. Any outcome other than the literal boolean
 * `true` — timeout, throw, `false`, non-boolean — makes the caller fall back to
 * a full `reload()`.
 *
 * To avoid a flash of unstyled content (FOUC) the script uses insert-new-then-
 * remove-old: it clones the target `<link>`, points the clone at a cache-busted
 * href, INSERTS the clone, waits for its `load`, and only THEN removes the old
 * node — so there is never a moment with no stylesheet applied.
 *
 * The `oldHrefBase` is the `erfana-preview://<token>/<enc(rel)>` URL with any
 * `?v=` cache-buster stripped. It is computed MAIN-SIDE from the changed path
 * and passed in — never read back from the (untrusted) page. Both string inputs
 * are embedded with `JSON.stringify`, so no page-derived value can break out of
 * the string literal.
 */

/**
 * Strip a trailing query string (the `?v=` cache-buster) and any fragment from
 * an `erfana-preview://` href, yielding the stable base used to match the live
 * `<link>` regardless of which version is currently loaded.
 *
 * @param href - an absolute `erfana-preview://` stylesheet href
 * @returns the href with `?…` and `#…` removed
 */
export function stripVersionQuery(href: string): string {
  const queryIdx = href.indexOf('?')
  const withoutQuery = queryIdx === -1 ? href : href.slice(0, queryIdx)
  const hashIdx = withoutQuery.indexOf('#')
  return hashIdx === -1 ? withoutQuery : withoutQuery.slice(0, hashIdx)
}

/**
 * Build a cache-busted href from a stable base and a monotonically-changing
 * version token, so the browser refetches the stylesheet instead of serving the
 * cached copy.
 *
 * @param oldHrefBase - the base href (already `?v=`-stripped)
 * @param version - a changing value (e.g. a counter or timestamp)
 */
export function buildCacheBustHref(oldHrefBase: string, version: number | string): string {
  return `${oldHrefBase}?v=${version}`
}

/**
 * Build the isolated-world swap script.
 *
 * The returned string is a self-invoking expression evaluating to a
 * `Promise<boolean>`: it resolves `true` after the replacement stylesheet has
 * loaded and the old node is removed, and `false` if no matching `<link>` was
 * found, the new stylesheet failed to load, or anything threw. The caller
 * treats any non-`true` outcome as "reload instead".
 *
 * @param oldHrefBase - the target stylesheet's href with `?v=` stripped
 * @param newHref - the cache-busted href to load the fresh stylesheet from
 */
export function buildCssSwapScript(oldHrefBase: string, newHref: string): string {
  const oldBaseLiteral = JSON.stringify(oldHrefBase)
  const newHrefLiteral = JSON.stringify(newHref)

  return `(function (oldBase, newHref) {
  return new Promise(function (resolve) {
    try {
      var links = document.querySelectorAll('link[rel="stylesheet"]');
      var target = null;
      for (var i = 0; i < links.length; i++) {
        var href = links[i].href;
        var queryIdx = href.indexOf('?');
        var base = queryIdx === -1 ? href : href.slice(0, queryIdx);
        var hashIdx = base.indexOf('#');
        if (hashIdx !== -1) base = base.slice(0, hashIdx);
        if (base === oldBase) { target = links[i]; break; }
      }
      if (!target || !target.parentNode) { resolve(false); return; }

      var clone = target.cloneNode(false);
      clone.setAttribute('href', newHref);

      var settled = false;
      var finish = function (ok) {
        if (settled) return;
        settled = true;
        try {
          if (ok) {
            if (target.parentNode) target.parentNode.removeChild(target);
          } else {
            if (clone.parentNode) clone.parentNode.removeChild(clone);
          }
        } catch (e) { /* ignore DOM detach races */ }
        requestAnimationFrame(function () { resolve(ok); });
      };

      clone.addEventListener('load', function () { finish(true); });
      clone.addEventListener('error', function () { finish(false); });

      // Insert the fresh stylesheet BEFORE removing the old one (no FOUC).
      target.parentNode.insertBefore(clone, target.nextSibling);
    } catch (e) {
      resolve(false);
    }
  });
})(${oldBaseLiteral}, ${newHrefLiteral})`
}
