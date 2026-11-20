// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * Version sampler Page Object Model (#478 P2, P3): records every distinct
 * version of a file a tab shows, with the page's `Date.now()` when it showed
 * and whether it was complete.
 *
 * A test writes files whose text carries a version tag `V-<id>` near the top
 * and, last of all, `END-<id>`. The sampler reads what the tab shows –
 *
 * - `editor`: the Monaco model of the editor tab (`__erfanaTest.editorValue`),
 *   so lines scrolled out of view still count;
 * - `preview`: the rendered Markdown preview's text;
 * - `image`: the SVG inside the image viewer's `data:` URL –
 *
 * on every DOM mutation and every 10 ms, and appends a sample whenever the
 * tag or its completeness changes. "Complete" means `END-<id>` of the same id
 * is present: a version shown without it is a partial file (P3).
 *
 * The 10 ms interval is the page's own sampling clock, not a test wait: the
 * Monaco model can change without a DOM mutation when the changed lines are
 * scrolled out of view.
 */
import { expect, type Page } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'

/** What the sampler reads. */
export type SampledView = 'editor' | 'preview' | 'image'

/** One shown version. `id` is `null` when the tab showed text with no tag (an empty or cut file). */
export interface VersionSample {
  at: number
  id: string | null
  complete: boolean
}

interface SamplerState {
  samples: VersionSample[]
  stop: () => void
}

declare global {
  interface Window {
    __erfanaVersionSampler?: SamplerState
  }
}

/** Page-side sampling period (ms). */
const SAMPLE_EVERY_MS = 10
const STEP_TIMEOUT_MS = 15_000

export class VersionSamplerPage {
  constructor(private readonly page: Page) {}

  /** Starts sampling `view` (replaces a running sampler). */
  async start(view: SampledView): Promise<void> {
    await this.page.evaluate(
      ({ kind, ids, everyMs }) => {
        window.__erfanaVersionSampler?.stop()
        const read = (): string | null => {
          if (kind === 'editor') {
            const host = document.querySelector(`[data-testid="${ids.monaco}"]`)
            return host ? (window.__erfanaTest?.editorValue(host) ?? null) : null
          }
          if (kind === 'preview') {
            return document.querySelector(`[data-testid="${ids.preview}"]`)?.textContent ?? null
          }
          const img = document.querySelector(`[data-testid="${ids.imagePanel}"] img`)
          const src = img?.getAttribute('src') ?? ''
          const prefix = 'data:image/svg+xml;base64,'
          return src.startsWith(prefix) ? atob(src.slice(prefix.length)) : null
        }
        const state: SamplerState = { samples: [], stop: () => undefined }
        const sample = (): void => {
          const text = read()
          if (text === null) return
          const id = /V-([A-Za-z0-9]+)/.exec(text)?.[1] ?? null
          const complete = id !== null && text.includes(`END-${id}`)
          const last = state.samples[state.samples.length - 1]
          if (last && last.id === id && last.complete === complete) return
          state.samples.push({ at: Date.now(), id, complete })
        }
        const observer = new MutationObserver(sample)
        observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })
        const timer = window.setInterval(sample, everyMs)
        state.stop = () => {
          observer.disconnect()
          window.clearInterval(timer)
        }
        window.__erfanaVersionSampler = state
        sample()
      },
      {
        kind: view,
        ids: { monaco: TEST_IDS.EDITOR_MONACO, preview: TEST_IDS.EDITOR_PREVIEW, imagePanel: TEST_IDS.IMAGE_VIEWER_PANEL },
        everyMs: SAMPLE_EVERY_MS
      }
    )
  }

  /** The samples so far. */
  async samples(): Promise<VersionSample[]> {
    return this.page.evaluate(() => window.__erfanaVersionSampler?.samples.slice() ?? [])
  }

  /** Waits until a complete sample of version `id` is recorded. */
  async waitForComplete(id: string, timeout = STEP_TIMEOUT_MS): Promise<void> {
    await expect
      .poll(async () => (await this.samples()).some((s) => s.id === id && s.complete), {
        timeout,
        message: `the tab never showed version ${id} complete`
      })
      .toBe(true)
  }

  /** Stops sampling and returns every sample. */
  async stop(): Promise<VersionSample[]> {
    return this.page.evaluate(() => {
      const state = window.__erfanaVersionSampler
      state?.stop()
      return state?.samples.slice() ?? []
    })
  }
}
