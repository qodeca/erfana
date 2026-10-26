// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Prints what agent-review/RUBRIC.md states about each block: the line it
 * starts on, its status and its target. RUBRIC.md is written by hand from this
 * output, so compare the two whenever the agent-review pages change. Run
 * through genFixtures.ts (`npm run fixtures:html-comments`), never on its own.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeCommentDocument } from '../../index'

const AGENT_REVIEW_PAGES = ['landing.html', 'slides.html', 'signup-form.html'] as const

/** Prints the RUBRIC.md facts for every agent-review page in `dir`. */
export function printRubricFacts(dir: string): void {
  for (const name of AGENT_REVIEW_PAGES) printPageFacts(dir, name)
}

function printPageFacts(dir: string, name: string): void {
  const text = readFileSync(join(dir, name), 'utf8')
  const doc = analyzeCommentDocument(text)
  console.log(`=== ${name} writable=${doc.state.writable}`)
  for (const block of doc.state.blocks) {
    const line = text.slice(0, block.nodeRange[0]).split('\n').length
    if (block.kind === 'ok') {
      const target = block.target.state === 'attached' ? text.slice(block.target.startOffset, text.indexOf('>', block.target.startOffset) + 1) : 'ORPHANED'
      const rt = block.data.anchor.runtime ? ` runtime=${block.data.anchor.runtime.tag}@${block.data.anchor.runtime.path}` : ''
      console.log(`line ${line} ${block.data.status} ${block.data.id} -> ${target}${rt}`)
      for (const m of block.data.msgs) console.log(`    ${m.by.name}: ${m.text}`)
    } else {
      const header = text.slice(block.nodeRange[0], text.indexOf('\n', block.nodeRange[0]))
      const target = text.slice(block.nodeRange[1], block.nodeRange[1] + 120).trim().split('\n')[0]
      console.log(`line ${line} ${block.kind} ${'reason' in block ? block.reason : ''} ${header} -> ${target}`)
    }
  }
}
