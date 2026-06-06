import type { GitStatusStrategy } from '../interfaces/IGitStatusWorker'

/**
 * Selects the *preferred* git status computation strategy.
 *
 * Native `git status --porcelain` is always preferred because it honours the
 * user's git configuration – `core.autocrlf`, `.gitattributes` text/eol rules,
 * filemode – so Erfana's status matches what the user's own git reports.
 * isomorphic-git's `statusMatrix()` does NOT implement that normalization and
 * would falsely report line-ending-only differences as "modified" (notably on
 * Windows with `autocrlf=true`).
 *
 * The actual native-vs-isomorphic decision is made in the worker
 * (`git-status.worker.ts`), keyed on whether a git binary is available
 * (`resolveGitPath()`); isomorphic-git is used only as a no-binary fallback.
 * This selector therefore returns the preferred strategy unconditionally; the
 * `strategy` field remains a test/override seam (passing `'isomorphic-git'`
 * forces the portable path).
 *
 * @see Spec #022 - Git status thread offloading
 */
export class GitStatusStrategySelector {
  /**
   * Select the preferred git status strategy.
   *
   * @param _projectPath - Absolute path to project root (unused; retained for API stability)
   * @returns Always `'native-git'` (the preferred strategy)
   */
  async select(_projectPath: string): Promise<GitStatusStrategy> {
    return 'native-git'
  }
}
