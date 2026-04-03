import { stat } from 'fs/promises'
import { join } from 'path'
import { GIT_STATUS } from '../../shared/constants'
import type { GitStatusStrategy } from '../interfaces/IGitStatusWorker'

/**
 * Selects the git status computation strategy based on repository size.
 *
 * Checks the .git/index file size to determine whether the repo is large
 * enough to benefit from native git over isomorphic-git.
 *
 * @see Spec #022 - Git status thread offloading
 */
export class GitStatusStrategySelector {
  /**
   * Select the git status strategy based on .git/index file size.
   *
   * @param projectPath - Absolute path to project root
   * @returns The recommended strategy for this repository
   */
  async select(projectPath: string): Promise<GitStatusStrategy> {
    try {
      const indexPath = join(projectPath, '.git', 'index')
      const indexStat = await stat(indexPath)
      return indexStat.size > GIT_STATUS.INDEX_SIZE_THRESHOLD
        ? 'native-git'
        : 'isomorphic-git'
    } catch {
      // If .git/index doesn't exist or can't be read, use isomorphic-git
      return 'isomorphic-git'
    }
  }
}
