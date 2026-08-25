// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview eligibility service (Issue #74, work item 28).
 *
 * Decides whether a `.html`/`.htm` file may open as a RUNNING preview or must
 * fall back to opening as source. It runs the five ordered checks of design
 * §1.5 — **first failure wins, everything failing opens as source**:
 *
 *   1. `globally-disabled`   — the `htmlPreview.enabled` global toggle is off
 *   2. `not-html`            — the extension is not `.html`/`.htm`
 *   3. `outside-project`     — the file is not inside the project root
 *   4. `excluded-directory`  — a path segment names a build-output / VCS dir
 *   5. `gitignored`          — `git check-ignore` reports the file ignored
 *
 * `projectPath` is supplied by the MAIN-side caller (the composition root reads
 * it from `ProjectService`), never from the renderer, so this module does not
 * perform the hardened realpath confinement — that stays in the protocol layer
 * (`resolveConfined`, §2.4). The exclusion predicate is shared with that layer
 * via `previewExclusion` so both enforce the same rule.
 *
 * @see specs/designs/sd-074-html-preview.md §1.5
 */
import { extname, isAbsolute, relative } from 'node:path'

import type { GlobalSettings } from '../../../shared/ipc/global-settings-schema'
import type { IGitignoreEvaluator } from './GitignoreEvaluator'
import { isInExcludedDirectory } from './previewExclusion'

/** Extensions that open as a running preview; matched case-insensitively. */
const HTML_EXTENSIONS: ReadonlySet<string> = new Set(['.html', '.htm'])

/** Why a file is not preview-eligible; mirrors the design §1.5 order. */
export type PreviewIneligibleReason =
  | 'globally-disabled'
  | 'not-html'
  | 'outside-project'
  | 'excluded-directory'
  | 'gitignored'

/**
 * The structured verdict `check` returns. `eligible: true` means "open as a
 * running preview"; otherwise `reason` names the first failing check and the
 * caller opens the file as source.
 */
export type PreviewEligibilityVerdict =
  | { eligible: true }
  | { eligible: false; reason: PreviewIneligibleReason }

/** Collaborators injected so the service is testable without real git or IO. */
export interface PreviewEligibilityServiceDeps {
  /** Hardened `git check-ignore` oracle (item 26). */
  gitignore: IGitignoreEvaluator
  /** Reads the current global settings; the `htmlPreview.enabled` toggle gates check 1. */
  getSettings: () => GlobalSettings
}

export interface IPreviewEligibilityService {
  /**
   * Run the five ordered checks against `filePath` under `projectPath`.
   * `projectPath` is main-supplied and trusted (never renderer input).
   */
  check(filePath: string, projectPath: string): Promise<PreviewEligibilityVerdict>
}

const INELIGIBLE = (reason: PreviewIneligibleReason): PreviewEligibilityVerdict => ({
  eligible: false,
  reason
})

export class PreviewEligibilityService implements IPreviewEligibilityService {
  private readonly gitignore: IGitignoreEvaluator
  private readonly getSettings: () => GlobalSettings

  constructor(deps: PreviewEligibilityServiceDeps) {
    this.gitignore = deps.gitignore
    this.getSettings = deps.getSettings
  }

  async check(filePath: string, projectPath: string): Promise<PreviewEligibilityVerdict> {
    // 1. globally-disabled — the single global toggle (AC21).
    if (!this.getSettings().htmlPreview.enabled) {
      return INELIGIBLE('globally-disabled')
    }

    // 2. not-html — extension gate, case-insensitive.
    if (!HTML_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      return INELIGIBLE('not-html')
    }

    // 3. outside-project — a relative path that escapes or is absolute is out.
    const rel = relative(projectPath, filePath)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      return INELIGIBLE('outside-project')
    }

    // 4. excluded-directory — build-output / VCS segments (shared predicate).
    if (isInExcludedDirectory(rel)) {
      return INELIGIBLE('excluded-directory')
    }

    // 5. gitignored — fails OPEN inside the evaluator, so a non-git project or a
    //    git anomaly leaves the file previewable.
    if (await this.gitignore.isIgnored(projectPath, rel)) {
      return INELIGIBLE('gitignored')
    }

    return { eligible: true }
  }
}

/** Factory mirroring the codebase interface + class + factory convention. */
export function createPreviewEligibilityService(
  deps: PreviewEligibilityServiceDeps
): IPreviewEligibilityService {
  return new PreviewEligibilityService(deps)
}
