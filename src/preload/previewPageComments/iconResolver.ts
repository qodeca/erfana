// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pin elements, re-resolved only when the page changed
 * (docs/designs/comments/html-preview-comments.md §6 "JS-built elements", §7.5 step 7;
 * security review L9).
 *
 * A pin on a JS-built element names its tokened ancestor plus a structural
 * path below it, and walking that path scans each level's children. The
 * overlay renders on every pointer move in comment mode, so the walk is cached
 * per icon and redone only after the page's DOM changed – `version` is
 * `PageWatch.version`, bumped by every page mutation. A new state brings
 * new icon objects, so its cache starts empty.
 */
import { resolvePath } from './domPath'
import { isRendered } from './geometry'
import type { IconState } from './state'
import type { TokenRegistry } from './tokens'

/** One icon of the state and the element it is on now. */
export interface ResolvedIcon {
  readonly icon: IconState
  readonly element: Element | undefined
  /** The element is rendered right now (it gets a pin; main hears "visible"). */
  readonly visible: boolean
}

/** A walk's result. Its base needs no key: a token names one element for life (`TokenRegistry`). */
interface CachedPath {
  readonly version: number
  readonly element: Element | undefined
}

/** Resolves the state's icons to elements. */
export class IconResolver {
  private readonly paths = new WeakMap<IconState, CachedPath>()

  constructor(
    private readonly tokens: TokenRegistry,
    private readonly version: () => number
  ) {}

  /** Each icon's element and whether it is rendered, in `icons` order. */
  resolve(icons: readonly IconState[]): ResolvedIcon[] {
    const version = this.version()
    return icons.map(icon => {
      const element = this.elementOf(icon, version)
      return { icon, element, visible: element !== undefined && isRendered(element) }
    })
  }

  private elementOf(icon: IconState, version: number): Element | undefined {
    const base = this.tokens.elementOf(icon.token)
    const runtime = icon.runtime
    if (base === undefined || runtime === undefined) return base
    const cached = this.paths.get(icon)
    if (cached !== undefined && cached.version === version && cached.element?.isConnected !== false) return cached.element
    const below = resolvePath(base, runtime.path)
    const element = below?.localName === runtime.tag ? below : undefined
    this.paths.set(icon, { version, element })
    return element
  }
}
