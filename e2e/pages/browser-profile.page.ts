// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project's browser folder, `<project>/.erfana/browser/` (spec 025,
 * 025-FR-016, 025-FR-039; 025-AC-016, 025-AC-069), read and planted from the
 * test side, and the refusal a user sees when Erfana will not open a tab.
 *
 * Disk facts come straight from the file system (never from the app); the
 * refusal is read where the user reads it – the error toast – and main's tab
 * list (test hook) proves no tab exists behind it. Condition-based waits only.
 *
 * ```ts
 * const folder = new BrowserProfileFolder(testProject.path)
 * await folder.plantLink('captures', outsideDir)
 * await expect(refusalToast(window)).toContainText('.erfana/browser/captures')
 * ```
 */
import { promises as fs, type BigIntStats } from 'node:fs'
import * as path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'
import { TEST_IDS } from '../../src/renderer/src/constants/testids'
import { runGit } from '../utils/git-helpers'

/** The title of the toast a refused browser tab shows (`BrowserPanel`). */
export const REFUSED_TAB_TITLE = "Browser tab couldn't open"

/** A capture file name more than 7 days old (025-FR-039 naming contract). */
export const OLD_CAPTURE_NAME = '20200101-000000Z-0000aaaa.png'

/** The levels under `.erfana/browser` that 025-FR-016 guards. */
export type GuardedLevel = 'profile' | 'captures' | '.gitignore'

export class BrowserProfileFolder {
  readonly dir: string

  constructor(readonly projectPath: string) {
    this.dir = path.join(projectPath, '.erfana', 'browser')
  }

  /** `.erfana/browser/<rel…>` on disk. */
  at(...rel: string[]): string {
    return path.join(this.dir, ...rel)
  }

  async exists(...rel: string[]): Promise<boolean> {
    return fs.lstat(this.at(...rel)).then(
      () => true,
      () => false
    )
  }

  /** The self-ignore file's content, or null when it is missing. */
  gitignore(): Promise<string | null> {
    return fs.readFile(this.at('.gitignore'), 'utf8').catch(() => null)
  }

  /**
   * Every entry below `.erfana/browser` (recursive, links not followed) with
   * its birth time in nanoseconds – how "written before any other file" is
   * read from disk. Returns null where the file system keeps no birth time.
   */
  async birthTimes(): Promise<Map<string, bigint> | null> {
    const out = new Map<string, bigint>()
    const walk = async (rel: string): Promise<void> => {
      for (const entry of await fs.readdir(this.at(rel), { withFileTypes: true })) {
        const childRel = rel === '' ? entry.name : path.join(rel, entry.name)
        // An entry Chromium removes between readdir and lstat is simply skipped.
        const stats: BigIntStats | null = await fs.lstat(this.at(childRel), { bigint: true }).catch(() => null)
        if (stats === null) continue
        out.set(childRel, stats.birthtimeNs)
        if (entry.isDirectory()) await walk(childRel)
      }
    }
    await walk('')
    return [...out.values()].some((t) => t === 0n) ? null : out
  }

  /** Folders whose name sets a profile aside (`profile.untrusted-<UTC time>`). */
  async setAsideFolders(): Promise<string[]> {
    const names = await fs.readdir(this.dir).catch(() => [] as string[])
    return names.filter((n) => n.startsWith('profile.untrusted-')).sort()
  }

  /** Create `.erfana/browser` (and `.erfana`) as plain folders, as an earlier run would have. */
  async createFolder(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
  }

  /**
   * Plant `<level>` as a link to `target` (a folder for `profile` and
   * `captures`, a file for `.gitignore`). Windows gets a junction for a folder,
   * as the acceptance criterion names.
   */
  async plantLink(level: GuardedLevel, target: string): Promise<void> {
    await this.createFolder()
    if (level !== '.gitignore') await fs.writeFile(this.at('.gitignore'), '*', 'utf8')
    const type = level === '.gitignore' ? 'file' : process.platform === 'win32' ? 'junction' : 'dir'
    await fs.symlink(target, this.at(level), type)
  }

  /** `git status` lines (untracked files listed one by one) that lie under `.erfana/browser`. */
  gitStatusUnderBrowser(): string[] {
    return runGit(this.projectPath, 'status', '--porcelain', '--untracked-files=all', '--ignored=no')
      .split('\n')
      .filter((line) => line.includes('.erfana/browser'))
  }
}

/** A folder's entries, sorted; empty when it does not exist. */
export async function entriesOf(dir: string): Promise<string[]> {
  return (await fs.readdir(dir).catch(() => [] as string[])).sort()
}

/** The error toast of a refused browser tab. */
export function refusalToast(window: Page): Locator {
  return window.getByTestId(`${TEST_IDS.TOAST}-error`).filter({ hasText: REFUSED_TAB_TITLE })
}

/** Wait for the refusal toast and return its text. */
export async function waitForRefusal(window: Page): Promise<string> {
  const toast = refusalToast(window)
  await expect(toast).toBeVisible({ timeout: 15_000 })
  return (await toast.innerText()).replace(/\s+/g, ' ')
}
