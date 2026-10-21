// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, useCallback, type ReactNode } from 'react'
import { useDocumentImportStore } from '../../../stores/useDocumentImportStore'
import { DOCUMENT_IMPORT } from '../../../../../shared/constants'
import { isMacOS, isWindows } from '../../../utils/platform'
import { logger } from '../../../utils/logger'
import { renderIcon } from '../../../utils/iconRegistry'
import { TEST_IDS } from '../../../constants/testids'
import './ImportToolsSection.css'

type ToolId = 'libreOffice' | 'imageMagick'
type Platform = 'mac' | 'windows' | 'other'

interface ToolInfo {
  name: string
  brewCommand: string
  downloadUrl: string
}

const TOOLS: Record<ToolId, ToolInfo> = {
  libreOffice: {
    name: 'LibreOffice',
    brewCommand: 'brew install --cask libreoffice',
    downloadUrl: DOCUMENT_IMPORT.LIBREOFFICE_DOWNLOAD_URL
  },
  imageMagick: {
    name: 'ImageMagick',
    brewCommand: 'brew install imagemagick',
    downloadUrl: DOCUMENT_IMPORT.IMAGEMAGICK_DOWNLOAD_URL
  }
}

/** The extensions a list shows, written the way the file picker does. */
function formatExtensions(extensions: readonly string[]): string {
  return extensions.map((ext) => `.${ext}`).join(' ')
}

function currentPlatform(): Platform {
  if (isMacOS()) return 'mac'
  if (isWindows()) return 'windows'
  return 'other'
}

/** Open a download page through the `shell:openExternal` allowlist, never directly. */
async function openDownloadPage(url: string): Promise<void> {
  try {
    await window.electron.shell.openExternal(url)
  } catch (error) {
    logger.error('Failed to open download page', error instanceof Error ? error : undefined)
  }
}

/** The per-platform "how to get it" line under a missing tool. */
function InstallHint({ tool, platform }: { tool: ToolInfo; platform: Platform }): JSX.Element {
  if (platform === 'mac') {
    return (
      <p className="settings-description import-tools-hint">
        Install it with Homebrew: <code className="import-tools-command">{tool.brewCommand}</code>,
        then choose Check again.
      </p>
    )
  }
  if (platform === 'windows') {
    return (
      <div className="import-tools-hint import-tools-hint--action">
        <p className="settings-description">
          Download and install {tool.name}, then choose Check again.
        </p>
        <button
          type="button"
          className="settings-btn-secondary import-tools-btn"
          onClick={() => void openDownloadPage(tool.downloadUrl)}
        >
          Download {tool.name}
        </button>
      </div>
    )
  }
  return (
    <p className="settings-description import-tools-hint">
      Install {tool.name} with your system&apos;s package manager, then choose Check again.
    </p>
  )
}

interface FormatRowProps {
  format: string
  title: string
  extensions: string
  /** null while the first detection result is still on its way */
  ready: boolean | null
  readyText: string
  missingText: string
  hint?: ReactNode
}

function FormatRow({ format, title, extensions, ready, readyText, missingText, hint }: FormatRowProps): JSX.Element {
  const state = ready === null ? 'checking' : ready ? 'ready' : 'missing'
  return (
    <li
      className="import-tools-row"
      data-testid={TEST_IDS.SETTINGS_IMPORT_TOOL_STATUS}
      data-format={format}
      data-state={state}
    >
      <div className="settings-row import-tools-row__main">
        <div className="settings-field">
          <span className="settings-label">{title}</span>
          <p className="settings-description import-tools-extensions">{extensions}</p>
        </div>
        {/* Status is always words plus an icon – never colour alone. */}
        <span className={`import-tools-status import-tools-status--${state}`}>
          {state === 'ready' && renderIcon('check-circle', { 'aria-hidden': true })}
          {state === 'missing' && renderIcon('alert-triangle', { 'aria-hidden': true })}
          <span>{state === 'checking' ? 'Checking…' : state === 'ready' ? readyText : missingText}</span>
        </span>
      </div>
      {state === 'missing' && hint}
    </li>
  )
}

const OUTCOME_TEXT = {
  idle: '',
  checked: 'Check complete.',
  throttled: 'Checked a moment ago – try again in a few seconds.',
  failed: 'Could not check the tools. Try again.'
} as const

/**
 * ImportToolsSection – which import formats work on this computer (#250).
 *
 * Shows, before the user picks a file, whether the optional tools that Office
 * documents (LibreOffice) and images (ImageMagick) need were found, how to
 * install a missing one on this platform, and a "Check again" button that
 * re-runs detection in main without a restart. Reads the main process's
 * session-cached `DependencyDetector` result through `import:toolStatus`.
 *
 * Renders inside {@link SettingsOverlay} as one more `settings-section`.
 */
export function ImportToolsSection(): JSX.Element {
  const hasLibreOffice = useDocumentImportStore((s) => s.hasLibreOffice)
  const hasImageMagick = useDocumentImportStore((s) => s.hasImageMagick)
  const known = useDocumentImportStore((s) => s.toolStatusKnown)
  const isChecking = useDocumentImportStore((s) => s.isCheckingTools)
  const outcome = useDocumentImportStore((s) => s.toolCheckOutcome)
  const loadToolStatus = useDocumentImportStore((s) => s.loadToolStatus)

  // Read the cached result when the section mounts (Settings opens). This
  // never re-probes: it returns what startup detection already found.
  useEffect(() => {
    void loadToolStatus(false)
  }, [loadToolStatus])

  const handleRecheck = useCallback(() => {
    void loadToolStatus(true)
  }, [loadToolStatus])

  const platform = currentPlatform()

  return (
    <section className="settings-section" data-testid={TEST_IDS.SETTINGS_SECTION_IMPORT_TOOLS}>
      <h2 className="settings-section-title">Import tools</h2>
      <p className="settings-description import-tools-intro">
        PDF, text, audio and video files import out of the box. Office documents and images need a
        free tool installed on this computer – Erfana does not include it.
      </p>
      <ul className="import-tools-list" aria-label="Import formats">
        <FormatRow
          format="pdf"
          title="PDF documents"
          extensions=".pdf"
          ready={true}
          readyText="Ready – built in"
          missingText=""
        />
        <FormatRow
          format="office"
          title="Office documents"
          extensions={formatExtensions(DOCUMENT_IMPORT.LIBREOFFICE_EXTENSIONS)}
          ready={known ? hasLibreOffice : null}
          readyText="Ready – LibreOffice found"
          missingText="LibreOffice not found"
          hint={<InstallHint tool={TOOLS.libreOffice} platform={platform} />}
        />
        <FormatRow
          format="images"
          title="Images (text by OCR)"
          extensions={formatExtensions(DOCUMENT_IMPORT.IMAGEMAGICK_EXTENSIONS)}
          ready={known ? hasImageMagick : null}
          readyText="Ready – ImageMagick found"
          missingText="ImageMagick not found"
          hint={<InstallHint tool={TOOLS.imageMagick} platform={platform} />}
        />
      </ul>
      <div className="settings-row">
        <div className="settings-field">
          <span className="settings-label">Installed a tool?</span>
          <p className="settings-description">Look for the tools again – no restart needed.</p>
          {/* Always mounted, so a screen reader is already watching when the text arrives. */}
          <p
            className="settings-description import-tools-live"
            aria-live="polite"
            data-testid={TEST_IDS.SETTINGS_IMPORT_TOOLS_LIVE}
          >
            {isChecking ? '' : OUTCOME_TEXT[outcome]}
          </p>
        </div>
        <button
          type="button"
          className="settings-btn-secondary import-tools-btn"
          onClick={handleRecheck}
          disabled={isChecking}
          aria-busy={isChecking}
          data-testid={TEST_IDS.SETTINGS_BTN_IMPORT_TOOLS_RECHECK}
        >
          {isChecking ? 'Checking…' : 'Check again'}
        </button>
      </div>
    </section>
  )
}
