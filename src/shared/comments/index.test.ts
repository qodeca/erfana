// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The shared comment barrel (spec 024 architecture note 001 § 1 `index`):
 * it serves the kind-agnostic base and leaves the HTML kind out, so
 * importing the base never loads parse5.
 */
import { describe, expect, it } from 'vitest'
import * as base from './index'

describe('shared comment barrel', () => {
  it('exports the shared base: format, classifier, re-attach, splice and the kind seam', () => {
    for (const name of [
      'serializeBlock',
      'classifyIndexedBlocks',
      'lineStartRange',
      'findAnchorTarget',
      'resolveBlockTarget',
      'planSlotInsert',
      'verifyKindSplice',
      'agentNoteProblem',
      'cutText',
      'createThread'
    ]) {
      expect(base, name).toHaveProperty(name)
    }
  })

  it('leaves the HTML kind out', () => {
    expect(base).not.toHaveProperty('htmlKind')
  })
})
