import type { ResolvedProjectSettings } from '../../shared/ipc/project-settings-schema'

/**
 * Interface for project-level settings service
 * Loads and validates .erfana/settings.json
 *
 * @see Issue #63 - project-level settings
 */
export interface IProjectSettingsService {
  /**
   * Load and validate project settings from .erfana/settings.json
   * @throws AppError if settings file exists but is invalid
   */
  loadSettings(projectPath: string): Promise<ResolvedProjectSettings>

  /**
   * Get currently loaded settings (cached from last loadSettings call)
   */
  getCurrentSettings(): ResolvedProjectSettings | null

  /**
   * Clear cached settings (called on project close or rollback)
   */
  clearSettings(): void
}
