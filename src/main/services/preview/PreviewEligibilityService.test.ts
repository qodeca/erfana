// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for PreviewEligibilityService (Issue #74, work item 28).
 *
 * Covers the five ordered checks of design §1.5, each failing independently,
 * plus the "first failure wins" ordering.
 */
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getDefaultGlobalSettings } from '../../../shared/ipc/global-settings-schema'
import type { GlobalSettings } from '../../../shared/ipc/global-settings-schema'
import type { IGitignoreEvaluator } from './GitignoreEvaluator'
import {
  createPreviewEligibilityService,
  type IPreviewEligibilityService
} from './PreviewEligibilityService'

const PROJECT = '/project'

function makeSettings(enabled: boolean): GlobalSettings {
  return { ...getDefaultGlobalSettings(), htmlPreview: { enabled } }
}

describe('PreviewEligibilityService', () => {
  let gitignore: { isIgnored: ReturnType<typeof vi.fn>; clearCache: ReturnType<typeof vi.fn> }
  let enabled: boolean

  function build(): IPreviewEligibilityService {
    return createPreviewEligibilityService({
      gitignore: gitignore as unknown as IGitignoreEvaluator,
      getSettings: () => makeSettings(enabled)
    })
  }

  beforeEach(() => {
    gitignore = {
      isIgnored: vi.fn(async () => false),
      clearCache: vi.fn()
    }
    enabled = true
  })

  it('is eligible for an in-project, non-ignored .html file', async () => {
    const verdict = await build().check(`${PROJECT}/docs/page.html`, PROJECT)
    expect(verdict).toEqual({ eligible: true })
  })

  it('accepts .htm as well as .html', async () => {
    const verdict = await build().check(`${PROJECT}/page.htm`, PROJECT)
    expect(verdict).toEqual({ eligible: true })
  })

  it('rejects when the global toggle is off (globally-disabled)', async () => {
    enabled = false
    const verdict = await build().check(`${PROJECT}/page.html`, PROJECT)
    expect(verdict).toEqual({ eligible: false, reason: 'globally-disabled' })
  })

  it('rejects a non-html file (.png → not-html)', async () => {
    const verdict = await build().check(`${PROJECT}/image.png`, PROJECT)
    expect(verdict).toEqual({ eligible: false, reason: 'not-html' })
  })

  it('rejects a file outside the project (outside-project)', async () => {
    const verdict = await build().check('/elsewhere/page.html', PROJECT)
    expect(verdict).toEqual({ eligible: false, reason: 'outside-project' })
  })

  it('rejects a file under an excluded directory (excluded-directory)', async () => {
    const verdict = await build().check(`${PROJECT}/node_modules/pkg/page.html`, PROJECT)
    expect(verdict).toEqual({ eligible: false, reason: 'excluded-directory' })
  })

  it('rejects a gitignored file (gitignored)', async () => {
    gitignore.isIgnored.mockResolvedValueOnce(true)
    const verdict = await build().check(`${PROJECT}/build/page.html`, PROJECT)
    expect(verdict).toEqual({ eligible: false, reason: 'gitignored' })
    // `relative()` yields NATIVE separators, so the expectation is built with
    // `join` rather than a hardcoded POSIX literal — on win32 the service passes
    // `build\page.html`. `git check-ignore` accepts either spelling, so the
    // native form is correct input, not a bug to normalise away.
    expect(gitignore.isIgnored).toHaveBeenCalledWith(PROJECT, join('build', 'page.html'))
  })

  it('first failure wins: global-off short-circuits before the extension check', async () => {
    enabled = false
    const verdict = await build().check(`${PROJECT}/image.png`, PROJECT)
    expect(verdict).toEqual({ eligible: false, reason: 'globally-disabled' })
    expect(gitignore.isIgnored).not.toHaveBeenCalled()
  })

  it('does not consult git when an earlier check already failed', async () => {
    const verdict = await build().check(`${PROJECT}/node_modules/page.html`, PROJECT)
    expect(verdict).toEqual({ eligible: false, reason: 'excluded-directory' })
    expect(gitignore.isIgnored).not.toHaveBeenCalled()
  })
})
