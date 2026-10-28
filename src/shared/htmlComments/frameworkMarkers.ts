// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pages whose framework would trip over a comment node
 * (docs/designs/comments/html-preview-comments.md §19 R3-11, spike S7).
 *
 * Vue, Svelte and Angular hydrate server-rendered markup by walking the DOM
 * node by node, and none of them skips an unknown comment: Vue re-uses the
 * wrong element (a pin would sit on the next list item), Svelte re-renders
 * from scratch, Angular throws. React skips unknown comments, so a React page
 * needs nothing special.
 *
 * So on a page carrying hydration markers, an element inside the hydrated
 * region does not get a block of its own. The block goes before the region's
 * ROOT CONTAINER – the child of `<body>` holding the markers (or `<body>`
 * itself when the markers sit directly in it) – and the clicked element is
 * stored as a `runtime` path inside the container: the same mechanism as a
 * climbed target (§5.6), so the format does not change.
 *
 * Markers recognised (only these; anything else is an ordinary page):
 * - fragment comments `<!--[-->`, `<!--]-->` (Vue 3, Svelte 5) and `<!--[!-->` (Svelte 5);
 * - attributes `data-server-rendered` (Vue 2), `data-v-ssr` (Vue),
 *   `data-svelte-h` (Svelte), `ngh` and `ng-version` (Angular).
 */
import type { DefaultTreeAdapterMap } from 'parse5'
import { relativePath } from './anchor'
import type { HtmlIndex, IndexedElement, Parse5Element } from './htmlIndex'

type ChildNode = DefaultTreeAdapterMap['childNode']
type ParentNode = DefaultTreeAdapterMap['parentNode']

/** A framework whose hydration is not comment-tolerant. */
export type FrameworkKind = 'vue' | 'svelte' | 'angular'

const FRAGMENT_COMMENTS: ReadonlySet<string> = new Set(['[', ']', '[!'])
/** Fragment markers only Svelte writes. */
const SVELTE_FRAGMENT = '[!'

const MARKER_ATTRIBUTES: ReadonlyMap<string, FrameworkKind> = new Map([
  ['data-server-rendered', 'vue'],
  ['data-v-ssr', 'vue'],
  ['data-svelte-h', 'svelte'],
  ['ngh', 'angular'],
  ['ng-version', 'angular']
])

/** The hydrated regions of a page. */
export interface FrameworkRegions {
  /** Frameworks whose markers were found, in a fixed order. */
  readonly frameworks: readonly FrameworkKind[]
  /** Root containers: children of `<body>`, or `<body>` itself. */
  readonly roots: readonly Parse5Element[]
}

/** Where a block for an element must go on a framework page. */
export type FrameworkPlacement =
  /** Not inside a hydrated region: place the block before the element as usual. */
  | { readonly kind: 'plain' }
  /** Place the block before `container`; store the element as `runtime.path` inside it. */
  | { readonly kind: 'framework'; readonly container: IndexedElement; readonly runtimePath: string }
  /** Inside a region whose root has no start tag of its own (an implied `<body>`): not commentable. */
  | { readonly kind: 'no-container' }

const FRAMEWORK_ORDER: readonly FrameworkKind[] = ['vue', 'svelte', 'angular']

/** The child of `<body>` holding `node`, `<body>` itself, or `null` outside the body. */
function regionRootOf(node: Parse5Element): Parse5Element | null {
  let cur: Parse5Element = node
  for (;;) {
    if (cur.tagName === 'body') return cur
    const parent: ParentNode | null = cur.parentNode
    if (!parent || !('tagName' in parent)) return null
    if (parent.tagName === 'body') return cur
    cur = parent
  }
}

/** Find the hydration markers of a page and the regions they mark. */
export function detectFrameworkRegions(index: HtmlIndex): FrameworkRegions {
  const found = new Set<FrameworkKind>()
  const roots = new Set<Parse5Element>()
  let fragments = false
  let svelteFragment = false
  const addRoot = (node: Parse5Element | null): void => {
    const root = node && regionRootOf(node)
    if (root) roots.add(root)
  }
  // Template content is never hydrated in place, so it is not walked.
  const pending: ChildNode[] = [...index.document.childNodes]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.nodeName === '#comment' && 'data' in node && FRAGMENT_COMMENTS.has(node.data)) {
      fragments = true
      svelteFragment ||= node.data === SVELTE_FRAGMENT
      addRoot(node.parentNode && 'tagName' in node.parentNode ? node.parentNode : null)
    }
    if (!('tagName' in node)) continue
    for (const attr of node.attrs) {
      const kind = MARKER_ATTRIBUTES.get(attr.name)
      if (!kind) continue
      found.add(kind)
      addRoot(node)
    }
    // One push per child: spreading a long child list as arguments overflows
    // the call stack (a flat 25 MB list has hundreds of thousands of items).
    for (const child of node.childNodes) pending.push(child)
  }
  if (fragments) found.add(svelteFragment || found.has('svelte') ? 'svelte' : 'vue')
  return {
    frameworks: FRAMEWORK_ORDER.filter(kind => found.has(kind)),
    roots: [...roots]
  }
}

/**
 * Where the block for `el` goes (R3-11). `regions` defaults to a fresh
 * detection; pass it when placing several blocks on one parse.
 */
export function frameworkPlacementFor(
  index: HtmlIndex,
  el: IndexedElement,
  regions: FrameworkRegions = detectFrameworkRegions(index)
): FrameworkPlacement {
  const roots = new Set(regions.roots)
  let root: Parse5Element | undefined
  for (let cur: ParentNode | null = el.node; cur && 'tagName' in cur; cur = cur.parentNode) {
    if (roots.has(cur)) {
      root = cur
      break
    }
  }
  // Outside every region, or the container itself: a block before it is outside the hydrated tree.
  if (!root || root === el.node) return { kind: 'plain' }
  const container = index.elementOf(root)
  if (!container) return { kind: 'no-container' }
  return { kind: 'framework', container, runtimePath: relativePath(index, root, el.node)! }
}
