// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * HTML preview host-block toast budget (Issue #74, work item 24).
 *
 * When the request filter blocks a subresource to an unapproved host it always
 * records a badge entry, but it should only raise a *toast* sparingly: a page
 * fanning out to dozens of blocked hosts must not bury the user in toasts.
 *
 * This notifier enforces two rules per project (design §1.2, §5(c)):
 *
 *  1. **Dedupe** — a given host toasts at most once; repeated blocks to the same
 *     host are badge-only.
 *  2. **Budget** — at most {@link PREVIEW.MAX_HOST_TOASTS} (3) DISTINCT hosts
 *     toast per project; every further distinct host is badge-only.
 *
 * `shouldNotify` returning `false` means "badge but do not toast"; the caller
 * still records the failure entry unconditionally.
 *
 * @see docs/designs/sd-074-html-preview.md §1.2, §5(c)
 */
import { PREVIEW } from '../../../shared/constants'

export interface IPreviewHostBlockNotifier {
  /**
   * Whether a block on `host` under `projectPath` should raise a toast.
   * Returns `true` at most {@link PREVIEW.MAX_HOST_TOASTS} times per project,
   * and never twice for the same host.
   */
  shouldNotify(projectPath: string, host: string): boolean
  /** Forget budget/dedupe state for one project, or all projects when omitted. */
  clear(projectPath?: string): void
}

/** Injectable dependencies (defaulted; tests may shrink the budget). */
export interface PreviewHostBlockNotifierDeps {
  /** Distinct-host toast budget per project (defaults to {@link PREVIEW.MAX_HOST_TOASTS}). */
  maxHostToasts?: number
}

/** Tracks toasted hosts per project to enforce dedupe + a distinct-host budget. */
export class PreviewHostBlockNotifier implements IPreviewHostBlockNotifier {
  private readonly maxHostToasts: number
  private readonly toastedByProject = new Map<string, Set<string>>()

  constructor(deps: PreviewHostBlockNotifierDeps = {}) {
    this.maxHostToasts = deps.maxHostToasts ?? PREVIEW.MAX_HOST_TOASTS
  }

  shouldNotify(projectPath: string, host: string): boolean {
    let toasted = this.toastedByProject.get(projectPath)
    if (!toasted) {
      toasted = new Set<string>()
      this.toastedByProject.set(projectPath, toasted)
    }

    // Rule 1: already toasted this host → badge-only.
    if (toasted.has(host)) {
      return false
    }

    // Rule 2: budget exhausted → badge-only, and do not consume a slot for a
    // host we are not toasting (so the budget counts toasted hosts exactly).
    if (toasted.size >= this.maxHostToasts) {
      return false
    }

    toasted.add(host)
    return true
  }

  clear(projectPath?: string): void {
    if (projectPath === undefined) {
      this.toastedByProject.clear()
      return
    }
    this.toastedByProject.delete(projectPath)
  }
}

/** Factory mirroring the project's interface + class + factory convention. */
export function createPreviewHostBlockNotifier(
  deps: PreviewHostBlockNotifierDeps = {}
): IPreviewHostBlockNotifier {
  return new PreviewHostBlockNotifier(deps)
}
