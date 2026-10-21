// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useEffect, useCallback, useRef, useState } from 'react'
import { useDocumentImportStore } from '../../../stores/useDocumentImportStore'
import { useSettingsStore } from '../../../stores/useSettingsStore'
import { textClipboard } from '../../../services/textClipboard'
import { DOCUMENT_IMPORT } from '../../../../../shared/constants'
import type { ToolState } from '../../../../../shared/ipc/import-schema'
import { isMacOS, isWindows } from '../../../utils/platform'
import { logger } from '../../../utils/logger'
import { renderIcon } from '../../../utils/iconRegistry'
import { TEST_IDS } from '../../../constants/testids'
import './ImportToolsSection.css'

type Platform = 'mac' | 'windows' | 'other'
type RowState = 'checking' | 'unchecked' | 'ready' | 'missing' | 'unsafe'

const BREW_COMMAND = 'brew install --cask libreoffice'

/** The extensions a list shows, written the way the file picker does. */
function formatExtensions(extensions: readonly string[]): string {
  return extensions.map((ext) => `.${ext}`).join(' ')
}

function currentPlatform(): Platform {
  if (isMacOS()) return 'mac'
  if (isWindows()) return 'windows'
  return 'other'
}

/** Open the download page through the `shell:openExternal` allowlist, never directly. */
async function openDownloadPage(): Promise<void> {
  try {
    await window.electron.shell.openExternal(DOCUMENT_IMPORT.LIBREOFFICE_DOWNLOAD_URL)
  } catch (error) {
    logger.error('Failed to open download page', error instanceof Error ? error : undefined)
  }
}

/** The per-platform "how to get it" lines under a missing LibreOffice. */
function InstallHint({ platform, onCopied }: { platform: Platform; onCopied: (message: string) => void }): JSX.Element {
  const handleCopy = useCallback(async () => {
    // textClipboard is the single transport-error chokepoint (retry + toast).
    const ok = await textClipboard.writeText(BREW_COMMAND)
    if (ok) onCopied('Copied.')
  }, [onCopied])

  if (platform === 'mac') {
    return (
      <div className="import-tools-hint">
        <p className="import-tools-hint__text">Install it with Homebrew, then choose Check again:</p>
        <div className="import-tools-hint__command">
          <code className="import-tools-command">{BREW_COMMAND}</code>
          <button
            type="button"
            className="settings-btn-secondary import-tools-btn import-tools-btn--icon"
            onClick={() => void handleCopy()}
            aria-label={`Copy command: ${BREW_COMMAND}`}
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
          Download and install LibreOffice in its default folder, then choose Check again.
        </p>
        <button
          type="button"
          className="settings-btn-secondary import-tools-btn"
          onClick={() => void openDownloadPage()}
        >
          Download LibreOffice
        </button>
      </div>
    )
  }
  return (
    <div className="import-tools-hint">
      <p className="import-tools-hint__text">
        Install the <code className="import-tools-command">libreoffice</code> package with your
        system&apos;s package manager, then choose Check again.
      </p>
    </div>
  )
}

/** Why an "unsafe" LibreOffice is not used, and the way out. */
function UnsafeHint(): JSX.Element {
  return (
    <div className="import-tools-hint">
      <p className="import-tools-hint__text">
        Erfana will not run it: the copy it would use is in the open project, a temporary folder or a
        network share, or comes from a relative PATH entry. Remove that folder from PATH, then choose
        Check again.
      </p>
    </div>
  )
}

const STATE_TEXT: Record<RowState, string> = {
  checking: 'Checking…',
  unchecked: 'Not checked',
  ready: 'Ready – LibreOffice found',
  missing: 'LibreOffice not found',
  unsafe: 'LibreOffice found in an unsafe location'
}

const STATE_ICON: Partial<Record<RowState, string>> = {
  ready: 'check-circle',
  missing: 'alert-triangle',
  unsafe: 'alert-triangle',
  unchecked: 'help-circle'
}

interface FormatRowProps {
  format: string
  title: string
  extensions: string
  state: RowState
  text: string
  children?: React.ReactNode
}

function FormatRow({ format, title, extensions, state, text, children }: FormatRowProps): JSX.Element {
  const icon = STATE_ICON[state]
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
          {icon && renderIcon(icon, { 'aria-hidden': true })}
          <span>{text}</span>
        </span>
      </div>
      {children}
    </li>
  )
}

const SUMMARY: Record<ToolState, string> = {
  found: 'LibreOffice found.',
  missing: 'LibreOffice not found.',
  unsafe: 'LibreOffice found in an unsafe location.'
}

/**
 * ImportToolsSection – which import formats work on this computer (#250).
 *
 * PDF, images and text need nothing extra: LiteParse reads PDF and images
 * itself. Office documents need LibreOffice. The section shows, before the
 * user picks a file, whether it was found – or found somewhere Erfana will not
 * run it from – how to install it on this platform, and a "Check again" button
 * that re-runs detection in main without a restart (`import:toolStatus`).
 *
 * Opening Settings with `{ section: 'import-tools' }` (the import refusal's
 * "Open import tools") scrolls here and moves focus to the heading.
 */
export function ImportToolsSection(): JSX.Element {
  const libreOfficeState = useDocumentImportStore((s) => s.libreOfficeState)
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
  const officeState: RowState =
    known && libreOfficeState
      ? libreOfficeState === 'found'
        ? 'ready'
        : libreOfficeState
      : outcome === 'failed'
        ? 'unchecked'
        : 'checking'

  const liveText = isChecking
    ? ''
    : copyNotice ||
      (outcome === 'checked' && libreOfficeState
        ? `Check complete – ${SUMMARY[libreOfficeState]}`
        : outcome === 'throttled'
          ? 'Checked a moment ago – try again in a few seconds.'
          : outcome === 'failed'
            ? 'Could not check for LibreOffice. Try again.'
            : '')

  return (
    <section className="settings-section" data-testid={TEST_IDS.SETTINGS_SECTION_IMPORT_TOOLS}>
      <h2 ref={headingRef} tabIndex={-1} className="settings-section-title import-tools-title">
        Import tools
      </h2>
      <p className="import-tools-intro">
        PDF, image and text files import out of the box. Audio and video use the Transcription
        settings above. Office documents need LibreOffice, a free office suite – Erfana does not
        include it.
      </p>
      <ul className="import-tools-list" aria-label="Import formats">
        <FormatRow format="pdf" title="PDF documents" extensions=".pdf" state="ready" text="Ready – built in" />
        <FormatRow
          format="images"
          title="Images (reads the text in them)"
          extensions={formatExtensions(DOCUMENT_IMPORT.IMAGE_EXTENSIONS)}
          state="ready"
          text="Ready – built in"
        />
        <FormatRow
          format="office"
          title="Office documents"
          extensions={formatExtensions(DOCUMENT_IMPORT.LIBREOFFICE_EXTENSIONS)}
          state={officeState}
          text={STATE_TEXT[officeState]}
        >
          {officeState === 'missing' && <InstallHint platform={platform} onCopied={setCopyNotice} />}
          {officeState === 'unsafe' && <UnsafeHint />}
        </FormatRow>
      </ul>
      <div className="settings-row">
        <div className="settings-field">
          <span className="settings-label">Installed LibreOffice?</span>
          <p className="import-tools-note">
            Look for it again – no restart needed. If it still shows as not found, restart Erfana.
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
