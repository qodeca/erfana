// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Noticing `document.open()` by its trace: `<html>` replaced
 * (docs/designs/html-preview-comments.md §9.1 S25; security review M1). The
 * real-Chromium check – listeners actually erased, then back – is
 * e2e/html-preview-comments-preload.e2e.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { watchDocumentElement } from './documentWatch'
import { microtasks } from './__test-helpers__/harness'

/** A fresh document, so the shared test document's root is never swapped. */
function freshDocument(): Document {
  return document.implementation.createHTMLDocument('')
}

describe('watchDocumentElement', () => {
  it('M1 reports each replacement of <html>, and stops when told', async () => {
    const doc = freshDocument()
    const onReplaced = vi.fn()
    const unwatch = watchDocumentElement(doc, onReplaced)

    doc.replaceChild(doc.createElement('html'), doc.documentElement as Element)
    await microtasks()
    expect(onReplaced).toHaveBeenCalledTimes(1)

    // `open()` takes the root away; `write()` brings the new one later.
    const gone = doc.documentElement as Element
    doc.removeChild(gone)
    await microtasks()
    expect(onReplaced).toHaveBeenCalledTimes(1)
    doc.append(doc.createElement('html'))
    await microtasks()
    expect(onReplaced).toHaveBeenCalledTimes(2)

    // Other children of the document (a comment) are not a replacement.
    doc.append(doc.createComment('x'))
    await microtasks()
    expect(onReplaced).toHaveBeenCalledTimes(2)

    unwatch()
    doc.replaceChild(doc.createElement('html'), doc.documentElement as Element)
    await microtasks()
    expect(onReplaced).toHaveBeenCalledTimes(2)
  })

  it('takes the first root the parser creates as the document, not as a replacement', async () => {
    // At document start, when the preload runs, there is no <html> yet.
    const doc = freshDocument()
    doc.removeChild(doc.documentElement as Element)
    const onReplaced = vi.fn()
    const unwatch = watchDocumentElement(doc, onReplaced)
    doc.append(doc.createElement('html'))
    await microtasks()
    expect(onReplaced).not.toHaveBeenCalled()
    doc.replaceChild(doc.createElement('html'), doc.documentElement as Element)
    await microtasks()
    expect(onReplaced).toHaveBeenCalledTimes(1)
    unwatch()
  })
})
