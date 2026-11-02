// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Says where the page's keyboard picker moved, with the element's first
 * words (comments-v2 C-10; security review S-L-A; PIN-S-003).
 *
 * The sealed preload sends no page text, so the words are main's own: on a
 * `showing` step main reads the file again through the confined reader every
 * comment read uses, and the parse worker's `excerpt` job cuts the element's
 * text from its parse – the document is usually in the worker's cache already
 * (the list parsed the same bytes). The element is the one main recorded for
 * the token, and only in bytes that still hash to what was served.
 *
 * - Steps are said in order, newest wins: an answer overtaken by a later step
 *   is dropped, so a fast walk never says an old element last.
 * - Any failure – the file moved, cannot be read, changed, the job failed –
 *   says the step without words. Nothing here throws.
 * - The words are never logged; a failed job logs its failure and the file's
 *   digest only.
 */
import { stablePathDigest } from '../../../../shared/stablePathDigest'
import { logger } from '../../LoggingService'
import { loadCommentBytes } from '../../comments/commentFileAccess'
import { samePathKey } from '../../comments/commentUnsavedSources'
import type { ElementTokenEntry } from './ElementTokenTable'
import { pickerStepOf, type PickerStep, type PickerStepInput } from './commentPickerStep'
import type { HtmlFileJobRunner } from './htmlCommentJobs'

/** A checked step as the pick handler has it: for an element, main's whole token entry. */
export type PickerStepEvent =
  | Exclude<PickerStepInput, { readonly say: 'showing' }>
  | (Omit<Extract<PickerStepInput, { readonly say: 'showing' }>, 'entry' | 'excerpt'> & { readonly entry: ElementTokenEntry })

/** What the speaker is built from. */
export interface PickerSpeakerDeps {
  readonly realRoot: string
  readonly jobs: HtmlFileJobRunner
  /** Pass the step on (the window's live region words it). */
  readonly say: (step: PickerStep) => void
  readonly platform?: NodeJS.Platform
  /** The confined reader; tests inject one. */
  readonly load?: typeof loadCommentBytes
}

/**
 * The speaker (module comment).
 *
 * @param deps - {@link PickerSpeakerDeps}
 * @returns Takes each checked step; resolves once that step has been said or dropped.
 */
export function createPickerSpeaker(deps: PickerSpeakerDeps): (step: PickerStepEvent) => Promise<void> {
  const load = deps.load ?? loadCommentBytes
  let latest = 0

  async function excerptOf(entry: ElementTokenEntry): Promise<string | undefined> {
    const loaded = await load({ realRoot: deps.realRoot, filePath: entry.realPath }, { platform: deps.platform })
    if (!loaded.ok || samePathKey(loaded.realPath, deps.platform) !== samePathKey(entry.realPath, deps.platform)) return undefined
    const job = { startOffset: entry.startOffset, tagName: entry.tagName, fileHash: entry.fileHash }
    const answer = await deps.jobs.runJob(loaded.bytes, { kind: 'excerpt', entry: job })
    if (answer.kind === 'failed') {
      logger.warn('Preview comments: a picker excerpt could not be read', { failure: answer.failure, file: stablePathDigest(entry.realPath) })
      return undefined
    }
    return answer.excerpt
  }

  return async (step: PickerStepEvent): Promise<void> => {
    latest += 1
    const mine = latest
    if (step.say !== 'showing' || step.added === true) {
      deps.say(pickerStepOf(step))
      return
    }
    let excerpt: string | undefined
    try {
      excerpt = await excerptOf(step.entry)
    } catch {
      // Said without words; the reader and the worker client do not throw, this is the last guard.
      excerpt = undefined
    }
    if (mine !== latest) return
    deps.say(pickerStepOf({ ...step, ...(excerpt === undefined ? {} : { excerpt }) }))
  }
}
