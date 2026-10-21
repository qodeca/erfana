// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, useCallback, useRef, useState, type ReactNode } from 'react'
import { useDocumentImportStore } from '../../../stores/useDocumentImportStore'
import { useSettingsStore } from '../../../stores/useSettingsStore'
import { textClipboard } from '../../../services/textClipboard'
import { DOCUMENT_IMPORT } from '../../../../../shared/constants'
import { isMacOS, isWindows } from '../../../utils/platform'
import { logger } from '../../../utils/logger'
import { renderIcon } from '../../../utils/iconRegistry'
import { TEST_IDS } from '../../../constants/testids'
import './ImportToolsSection.css'

type ToolId = 'libreOffice' | 'imageMagick'
type Platform = 'mac' | 'windows' | 'other'
type RowState = 'checking' | 'unchecked' | 'ready' | 'missing'

interface ToolInfo {
  name: string
  brewCommand: string
  linuxPackage: string
  downloadUrl: string
}

const TOOLS: Record<ToolId, ToolInfo> = {
  libreOffice: {
    name: 'LibreOffice',
    brewCommand: 'brew install --cask libreoffice',
    linuxPackage: 'libreoffice',
    downloadUrl: DOCUMENT_IMPORT.LIBREOFFICE_DOWNLOAD_URL
  },
  imageMagick: {
    name: 'ImageMagick',
    brewCommand: 'brew install imagemagick',
    linuxPackage: 'imagemagick',
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

/** The per-platform "how to get it" lines under a missing tool. */
function InstallHint({
  tool,
  platform,
  onCopied
}: {
  tool: ToolInfo
  platform: Platform
  onCopied: (message: string) => void
}): JSX.Element {
  const handleCopy = useCallback(async () => {
    // textClipboard is the single transport-error chokepoint (retry + toast).
    const ok = await textClipboard.writeText(tool.brewCommand)
    if (ok) onCopied('Copied.')
  }, [tool.brewCommand, onCopied])

  if (platform === 'mac') {
    return (
      <div className="import-tools-hint">
        <p className="import-tools-hint__text">Install it with Homebrew, then choose Check again:</p>
        <div className="import-tools-hint__command">
          <code className="import-tools-command">{tool.brewCommand}</code>
          <button
            type="button"
            className="settings-btn-secondary import-tools-btn import-tools-btn--icon"
            onClick={() => void handleCopy()}
            aria-label={`Copy command: ${tool.brewCommand}`}
            title="Copy command"
          >
            {renderIcon('copy', { 'aria-hidden': true })}
          </button>
        </div>
      </div>
    )
  }
  if (platform === 'windows') {
    return (
      <div className="import-tools-hint import-tools-hint--action">
        <p className="import-tools-hint__text">
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
    <div className="import-tools-hint">
      <p className="import-tools-hint__text">
        Install the <code className="import-tools-command">{tool.linuxPackage}</code> package with
        your system&apos;s package manager, then choose Check again.
      </p>
    </div>
  )
}

interface FormatRowProps {
  format: string
  title: string
  extensions: string
  state: RowState
  readyText: string
  missingText: string
  hint?: ReactNode
}

const STATE_TEXT: Record<'checking' | 'unchecked', string> = {
  checking: 'Checking…',
  unchecked: 'Not checked'
}

function FormatRow({ format, title, extensions, state, readyText, missingText, hint }: FormatRowProps): JSX.Element {
  const text =
    state === 'ready' ? readyText : state === 'missing' ? missingText : STATE_TEXT[state]
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
          <p className="import-tools-extensions">{extensions}</p>
        </div>
        {/* Status is always words plus an icon – never colour alone. */}
        <span className={`import-tools-status import-tools-status--${state}`}>
          {state === 'ready' && renderIcon('check-circle', { 'aria-hidden': true })}
          {state === 'missing' && renderIcon('alert-triangle', { 'aria-hidden': true })}
          {state === 'unchecked' && renderIcon('help-circle', { 'aria-hidden': true })}
          <span>{text}</span>
        </span>
      </div>
      {state === 'missing' && hint}
    </li>
  )
}

/** What "Check again" found, in words – the live region reads this. */
function foundSummary(libreOffice: boolean, imageMagick: boolean): string {
  const part = (name: string, found: boolean): string => `${name} ${found ? 'found' : 'not found'}`
  return `${part('LibreOffice', libreOffice)}, ${part('ImageMagick', imageMagick)}.`
}

/**
 * ImportToolsSection – which import formats work on this computer (#250).
 *
 * Shows, before the user picks a file, whether the optional tools that Office
 * documents (LibreOffice) and images (ImageMagick) need were found, how to
 * install a missing one on this platform, and a "Check again" button that
 * re-runs detection in main without a restart. Reads the main process's
 * session-cached `DependencyDetector` result through `import:toolStatus`.
 *
 * Opening Settings with `{ section: 'import-tools' }` (the import refusal's
 * "Open import tools") scrolls here and moves focus to the heading.
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
  const focusSection = useSettingsStore((s) => s.focusSection)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [copyNotice, setCopyNotice] = useState('')

  // Read the cached result when the section mounts (Settings opens). This
  // never re-probes: it returns what startup detection already found.
  useEffect(() => {
    void loadToolStatus(false)
  }, [loadToolStatus])

  // Opened from the import refusal: jump here (no smooth scroll) and focus the heading.
  useEffect(() => {
    if (focusSection !== 'import-tools') return
    headingRef.current?.scrollIntoView({ block: 'start' })
    headingRef.current?.focus({ preventScroll: true })
  }, [focusSection])

  const handleRecheck = useCallback(() => {
    // aria-disabled keeps the button focusable while checking; the store
    // ignores a call while one is in flight.
    if (isChecking) return
    setCopyNotice('')
    void loadToolStatus(true)
  }, [isChecking, loadToolStatus])

  const platform = currentPlatform()
  const rowState = (ready: boolean): RowState =>
    known ? (ready ? 'ready' : 'missing') : outcome === 'failed' ? 'unchecked' : 'checking'

  const liveText = isChecking
    ? ''
    : copyNotice ||
      (outcome === 'checked'
        ? `Check complete – ${foundSummary(hasLibreOffice, hasImageMagick)}`
        : outcome === 'throttled'
          ? 'Checked a moment ago – try again in a few seconds.'
          : outcome === 'failed'
            ? 'Could not check the tools. Try again.'
            : '')

  return (
    <section className="settings-section" data-testid={TEST_IDS.SETTINGS_SECTION_IMPORT_TOOLS}>
      <h2 ref={headingRef} tabIndex={-1} className="settings-section-title import-tools-title">
        Import tools
      </h2>
      <p className="import-tools-intro">
        PDF and text files import out of the box. Audio and video use the Transcription settings
        above. Office documents and images need a free tool installed on this computer – Erfana does
        not include it.
      </p>
      <ul className="import-tools-list" aria-label="Import formats">
        <FormatRow
          format="pdf"
          title="PDF documents"
          extensions=".pdf"
          state="ready"
          readyText="Ready – built in"
          missingText=""
        />
        <FormatRow
          format="office"
          title="Office documents"
          extensions={formatExtensions(DOCUMENT_IMPORT.LIBREOFFICE_EXTENSIONS)}
          state={rowState(hasLibreOffice)}
          readyText="Ready – LibreOffice found"
          missingText="LibreOffice not found"
          hint={<InstallHint tool={TOOLS.libreOffice} platform={platform} onCopied={setCopyNotice} />}
        />
        <FormatRow
          format="images"
          title="Images (reads the text in them)"
          extensions={formatExtensions(DOCUMENT_IMPORT.IMAGEMAGICK_EXTENSIONS)}
          state={rowState(hasImageMagick)}
          readyText="Ready – ImageMagick found"
          missingText="ImageMagick not found"
          hint={<InstallHint tool={TOOLS.imageMagick} platform={platform} onCopied={setCopyNotice} />}
        />
      </ul>
      <div className="settings-row">
        <div className="settings-field">
          <span className="settings-label">Installed a tool?</span>
          <p className="import-tools-note">
            Look for the tools again – no restart needed. If one still shows as not found, restart
            Erfana.
          </p>
          {/* Always mounted, so a screen reader is already watching when the text arrives. */}
          <p
            className="import-tools-live"
            aria-live="polite"
            data-testid={TEST_IDS.SETTINGS_IMPORT_TOOLS_LIVE}
          >
            {liveText}
          </p>
        </div>
        <button
          type="button"
          className="settings-btn-secondary import-tools-btn"
          onClick={handleRecheck}
          aria-disabled={isChecking}
          data-testid={TEST_IDS.SETTINGS_BTN_IMPORT_TOOLS_RECHECK}
        >
          {isChecking ? 'Checking…' : 'Check again'}
        </button>
      </div>
    </section>
  )
}
