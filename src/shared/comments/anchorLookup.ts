// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Lookup tables for the backup tiers of re-attachment, built once per parse
 * (docs/designs/comments/html-preview-comments.md §5.9 steps 2 and 4).
 *
 * A block whose element is gone falls through every tier. Scanning for it
 * cost a pass over all elements of its tag and a read of each one's quote –
 * about 36–76 ms per block at 4 MB – so 450 orphaned blocks kept the parse
 * worker busy for 7–23 s, up to past its 10 s watchdog. The tables below are
 * built on first use, one tag at a time, and answer every later block in
 * constant time:
 *
 * - elements by tag, and by `id` within a tag (step 2);
 * - by tag, elements by exact quote, and – only once a block needs it – by
 *   prefix + suffix context, alone and together with the exact quote (step 4).
 *
 * Every answer is the one the scan gave: the same candidates and the same
 * rule, exactly one match or none ("two equal candidates → orphaned").
 *
 * A hostile page can still make the quotes slow to read: the text of nested
 * elements overlaps, so a long whitespace run inside thousands of nested
 * elements is read once per element. All quote reads of one parse – the
 * position check's reads of single elements included (step 1, §19 Rev 4) –
 * therefore share {@link QUOTE_READ_BUDGET}. A table that cannot be finished within it
 * is never used, and nothing new is read after it runs out, so the blocks
 * that still need the quote tier stay orphaned – never an error, never a
 * guess from half a table. A real page stays far below it.
 */
import type { TextQuote } from './format'
import type { IndexedTarget, TargetIndex } from './targetIndex'
import { exactOf, prefixOf, suffixOf, type WorkMeter } from './quoteText'

/**
 * Characters the quote reads of one parse may visit in total. Reading the
 * quote and context of EVERY element of a dense 4 MB page (about 80,000
 * elements) visits 12–19 million, compact or pretty-printed; reading this
 * many takes about 0.3 s on the slowest box measured. Kept at 25 MB (§19
 * Rev 4): a table is built per tag, and the largest one-tag table of a dense
 * 25 MB page (about 456,000 elements) visits 10.3 million – every tag of it
 * together 61 million – so lost comments on a few tags still fit.
 */
export const QUOTE_READ_BUDGET = 40_000_000

type Elements = readonly IndexedTarget[]

/** The text just before and just after one element, as a quote stores it. */
export interface QuoteContext {
  readonly prefix: string
  readonly suffix: string
}

/** Elements of one tag by context, alone and with the exact quote in front. */
interface ContextTable {
  readonly byContext: ReadonlyMap<string, Elements>
  readonly byExactAndContext: ReadonlyMap<string, Elements>
}

/** Elements of one tag by exact quote, and each element's quote in tag order. */
interface QuoteTable {
  readonly byExact: ReadonlyMap<string, Elements>
  readonly exacts: readonly string[]
}

function push<V>(map: Map<string, V[]>, key: string, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** A key no other pair of strings shares: the first string's length leads. */
function pairKey(first: string, second: string): string {
  return `${first.length}:${first}${second}`
}

function unique(items: Elements | undefined): IndexedTarget | undefined {
  return items?.length === 1 ? items[0] : undefined
}

/** The backup-tier tables of one {@link TargetIndex}. Get it with {@link anchorLookupOf}. */
export class AnchorLookup {
  private tags: Map<string, IndexedTarget[]> | undefined
  private readonly ids = new Map<string, Map<string, IndexedTarget[]>>()
  private readonly quotes = new Map<string, QuoteTable>()
  private readonly contexts = new Map<string, ContextTable>()
  private readonly meter: WorkMeter

  /** @param budget - Characters all quote reads may visit; tests pass a small one. */
  constructor(
    private readonly index: TargetIndex,
    budget: number = QUOTE_READ_BUDGET
  ) {
    this.meter = { left: budget }
  }

  /** True once the quote reads used up the budget: the quote tier reads nothing more. */
  get budgetSpent(): boolean {
    return this.meter.left <= 0
  }

  /** Step 2: the one element with this tag and `id`, if exactly one exists. */
  byId(tag: string, id: string): IndexedTarget | undefined {
    let table = this.ids.get(tag)
    if (!table) {
      table = new Map()
      for (const el of this.sameTag(tag)) if (el.id !== undefined) push(table, el.id, el)
      this.ids.set(tag, table)
    }
    return unique(table.get(id))
  }

  /**
   * Step 4: the one element with this tag whose exact quote matches; when
   * none or several do, the one whose prefix and suffix match – among the
   * exact matches when there are several, among all elements of the tag when
   * there are none. `undefined` when the quote budget ran out first.
   */
  byQuote(tag: string, quote: TextQuote): IndexedTarget | undefined {
    const table = this.quoteTable(tag)
    if (!table) return undefined
    const exact = table.byExact.get(quote.exact)
    if (exact?.length === 1) return exact[0]
    if (!quote.prefix && !quote.suffix) return undefined
    const context = this.contextTable(tag, table)
    if (!context) return undefined
    const key = pairKey(quote.prefix, quote.suffix)
    return unique(
      exact ? context.byExactAndContext.get(pairKey(quote.exact, key)) : context.byContext.get(key)
    )
  }

  /**
   * One element's exact quote, read on the shared budget – the position
   * check of step 1 (`anchorEvidence.ts`). `undefined` once the budget is
   * spent: a cut read is never compared.
   */
  exactQuote(el: IndexedTarget): string | undefined {
    const exact = exactOf(this.index, el, this.meter)
    return this.budgetSpent ? undefined : exact
  }

  /** One element's prefix and suffix, read on the shared budget; `undefined` once it is spent. */
  quoteContext(el: IndexedTarget): QuoteContext | undefined {
    const prefix = prefixOf(this.index, el, this.meter)
    const suffix = suffixOf(this.index, el, this.meter)
    return this.budgetSpent ? undefined : { prefix, suffix }
  }

  /** Eligible elements with `tag`, in index order. */
  private sameTag(tag: string): Elements {
    if (!this.tags) {
      this.tags = new Map()
      for (const el of this.index.elements) push(this.tags, el.tag, el)
    }
    return this.tags.get(tag) ?? []
  }

  private quoteTable(tag: string): QuoteTable | undefined {
    const known = this.quotes.get(tag)
    if (known || this.budgetSpent) return known
    const byExact = new Map<string, IndexedTarget[]>()
    const exacts: string[] = []
    for (const el of this.sameTag(tag)) {
      const exact = exactOf(this.index, el, this.meter)
      if (this.budgetSpent) return undefined
      exacts.push(exact)
      push(byExact, exact, el)
    }
    const table: QuoteTable = { byExact, exacts }
    this.quotes.set(tag, table)
    return table
  }

  private contextTable(tag: string, quotes: QuoteTable): ContextTable | undefined {
    const known = this.contexts.get(tag)
    if (known || this.budgetSpent) return known
    const byContext = new Map<string, IndexedTarget[]>()
    const byExactAndContext = new Map<string, IndexedTarget[]>()
    const elements = this.sameTag(tag)
    for (let i = 0; i < elements.length; i += 1) {
      const el = elements[i]
      const prefix = prefixOf(this.index, el, this.meter)
      const suffix = suffixOf(this.index, el, this.meter)
      if (this.budgetSpent) return undefined
      const key = pairKey(prefix, suffix)
      push(byContext, key, el)
      push(byExactAndContext, pairKey(quotes.exacts[i], key), el)
    }
    const table: ContextTable = { byContext, byExactAndContext }
    this.contexts.set(tag, table)
    return table
  }
}

const lookups = new WeakMap<TargetIndex, AnchorLookup>()

/** The tables of `index`, shared by every block of the parse; built lazily. */
export function anchorLookupOf(index: TargetIndex): AnchorLookup {
  let lookup = lookups.get(index)
  if (!lookup) {
    lookup = new AnchorLookup(index)
    lookups.set(index, lookup)
  }
  return lookup
}
