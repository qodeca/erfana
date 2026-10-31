// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The Markdown preview body's last parse, kept so a render React throws away
 * does not cost a second parse of the same document (spec 024 024-NFR-001).
 *
 * The preview renders a new text as a transition (`useDeferredValue`). React
 * drops a transition's unfinished work when any other update in the window
 * arrives while it runs – the project tree taking the file's new size, a
 * list answer, a timer – and starts it again. The body's parse is one
 * synchronous step of several seconds on a 1 MB document, so a reload after a
 * comment save parsed the same text twice. The preview's `ParsedMarkdown`
 * keeps the parse in a ref and the restart reuses it.
 *
 * Reuse is exact: react-markdown's `Markdown` is a pure function of the text,
 * the plugins and the components, so the same inputs (by identity) give the
 * same elements. The link sink a plugin refills on each parse already holds
 * the links of the parse being reused.
 *
 * @module components/Editor/markdownBodyParse
 */
import { useRef } from 'react'
import Markdown, { type Components } from 'react-markdown'
import type { PluggableList } from 'unified'

/** What a body parse depends on: the text, and the plugins and components by identity. */
export interface BodyParseInputs {
  readonly source: string
  readonly remarkPlugins: PluggableList
  readonly rehypePlugins: PluggableList
  readonly components: Components
}

/** One parse: its inputs and the elements it produced. */
export interface BodyParse extends BodyParseInputs {
  readonly element: JSX.Element
}

/** Whether `last` was parsed from exactly `inputs`. */
function sameInputs(last: BodyParseInputs, inputs: BodyParseInputs): boolean {
  return (
    last.source === inputs.source &&
    last.remarkPlugins === inputs.remarkPlugins &&
    last.rehypePlugins === inputs.rehypePlugins &&
    last.components === inputs.components
  )
}

/**
 * `last` when it was parsed from `inputs`, else a fresh parse of them.
 *
 * @param last - The previous parse, or `null` before the first
 * @param inputs - What this render parses
 * @param parse - The parse itself; called only when `last` does not match
 * @returns The parse to render; the same object as `last` when reused
 */
export function reuseOrParse(last: BodyParse | null, inputs: BodyParseInputs, parse: () => JSX.Element): BodyParse {
  if (last !== null && sameInputs(last, inputs)) return last
  return { ...inputs, element: parse() }
}

/**
 * react-markdown's parse of the preview body, reused when React restarts a
 * render it threw away. `MarkdownPreview` renders it as the child of its
 * timing probe, so the probe's span still covers the parse.
 *
 * @param inputs - The text, plugins and components to render
 * @returns The rendered body
 */
export function ParsedMarkdown(inputs: BodyParseInputs): JSX.Element {
  // A ref outlives an interrupted render of a mounted component; no hook's memo does.
  const lastParse = useRef<BodyParse | null>(null)
  /* eslint-disable react-hooks/refs -- on purpose, see the module comment: reuse is exact (the same inputs by identity give the same elements) */
  const parsed = reuseOrParse(lastParse.current, inputs, () =>
    Markdown({ remarkPlugins: inputs.remarkPlugins, rehypePlugins: inputs.rehypePlugins, components: inputs.components, children: inputs.source })
  )
  lastParse.current = parsed
  /* eslint-enable react-hooks/refs */
  return parsed.element
}
