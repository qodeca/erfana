// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The HTML preview toolbar's own buttons, outside the permission chip.
 *
 * {@link PreviewChromeBand} lays its bar out as three parts: a LEADING slot,
 * the spacer and permission chip it owns, and a TRAILING slot. This file holds
 * what goes in those slots by default – Find leading; Open in default browser
 * and Export to PDF trailing –
 * so the band can take other content in either slot without restating these
 * buttons, and so a toolbar control can grow its own states without growing
 * the file that asks the reader to approve hosts.
 *
 * Both render the band's `erf-band__tool` / `erf-band__separator` classes, so
 * every rule for their look stays in `PreviewChromeBand.css` and the
 * permission-band card.
 *
 * @module HtmlPreviewPanel/components/PreviewToolbarTools
 * @see design/system/components/permission-band/index.html - status="decided"
 */
import { ExternalLink, FileDown, Search } from 'lucide-react'
import { formatShortcut } from '../../../../utils/shortcutLabel'

/** Props for {@link PreviewFindTool}. */
export interface PreviewFindToolProps {
  /**
   * Open find-in-page. Optional only so the band can be rendered in isolation by
   * tests and by the design cards; the panel always supplies it, and the button
   * is not rendered without it rather than rendering a control that does nothing.
   */
  readonly onFind?: () => void
}

/**
 * The Find button – the band's default leading tool.
 *
 * Matches `MarkdownToolbar`'s search button exactly: same icon at the same size,
 * same accessible name, same shortcut in the tooltip. The find bar itself is
 * shared: both panels open the same `SearchBar`, this one over a Chromium
 * `findInPage` provider.
 *
 * The keyboard route existed long before this button did. Cmd/Ctrl+F has always
 * worked here, including while focus is inside the native view, which swallows
 * renderer keys and needs the accelerator forwarded. The button only makes a
 * working feature discoverable.
 *
 * @param props - {@link PreviewFindToolProps}
 * @returns The Find button, or `null` when there is nothing for it to call.
 *
 * @example
 * ```tsx
 * <PreviewFindTool onFind={() => useSearchStore.getState().openSearch()} />
 * ```
 */
export function PreviewFindTool({ onFind }: PreviewFindToolProps): React.JSX.Element | null {
  if (onFind === undefined) return null
  return (
    <button
      type="button"
      className="erf-band__tool"
      aria-label="Find"
      title={`Find (${formatShortcut('F', { mod: true })})`}
      data-testid="preview-band-find"
      onClick={onFind}
    >
      <Search size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}

/** Props for {@link PreviewToolbarTools}. */
export interface PreviewToolbarToolsProps {
  /**
   * Export the previewed page to PDF. Optional for the same reason as
   * {@link PreviewFindToolProps.onFind}: without it neither the button nor its
   * rule is drawn.
   */
  readonly onExportPdf?: () => void
  /** An export is in flight – the button is disabled so a second click cannot
   * open a second save dialog behind the first. */
  readonly exportingPdf?: boolean
  /**
   * Open the page this tab shows NOW in the default browser. Optional for the
   * same reason as {@link PreviewFindToolProps.onFind}: without it the button is
   * not drawn.
   */
  readonly onOpenInBrowser?: () => void
  /** A request is in flight, from the press until main answers. */
  readonly openingInBrowser?: boolean
}

/** Props for {@link PreviewOpenInBrowserTool}. */
interface PreviewOpenInBrowserToolProps {
  /** Open the page in the default browser. */
  readonly onOpenInBrowser: () => void
  /** A request is in flight; presses are ignored until it settles. */
  readonly busy: boolean
}

/**
 * The Open in default browser button (issue #124, part 4; UX spec §1.4).
 *
 * BUSY IS `aria-disabled`, NEVER `disabled`. Chromium blurs a control the
 * instant it gets the `disabled` attribute, so a keyboard reader pressing Enter
 * would land on `<body>` mid-request; the band's Confirm keeps focus the same
 * way. Presses are ignored here as well as in the action's own in-flight guard,
 * because `aria-disabled` alone stops nothing.
 *
 * No spinner (the Motion card is cutting their number) and no confirmation
 * (settled): the answer is normally back well under a second.
 *
 * @param props - {@link PreviewOpenInBrowserToolProps}
 * @returns The button.
 */
function PreviewOpenInBrowserTool({
  onOpenInBrowser,
  busy
}: PreviewOpenInBrowserToolProps): React.JSX.Element {
  return (
    <button
      type="button"
      className="erf-band__tool"
      aria-label="Open in default browser"
      title="Open in default browser"
      aria-disabled={busy ? 'true' : undefined}
      data-testid="preview-band-open-in-browser"
      onClick={() => {
        if (!busy) onOpenInBrowser()
      }}
    >
      <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}

/**
 * The band's default trailing tools: a rule, then Open in default browser, then
 * Export to PDF.
 *
 * LAST and behind a rule – the same position, separator and button
 * `MarkdownToolbar` gives it, so the two previews in this app put the same
 * control in the same corner.
 *
 * It lived on the TAB's context menu because the panel surface is painted over
 * by the native view and the tab was the only chrome that survived. The band is
 * that chrome now, so an export nobody could find behind a right-click is an
 * ordinary button again.
 *
 * The rule is not decoration: everything to its left is about THIS PAGE – find
 * inside it, what it was blocked from reaching – and the two behind it act
 * outside the page: the export writes a file somewhere else, and the browser
 * runs the page somewhere else. Grouping is what the separator is for. Export to
 * PDF stays last, in the corner it shares with `MarkdownToolbar`.
 *
 * @param props - {@link PreviewToolbarToolsProps}
 * @returns The rule and whichever of the two buttons has a callback, or `null`
 *   when neither has.
 *
 * @example
 * ```tsx
 * <PreviewToolbarTools
 *   onOpenInBrowser={openInBrowser}
 *   openingInBrowser={openingInBrowser}
 *   onExportPdf={exportPdf}
 *   exportingPdf={exportingPdf}
 * />
 * ```
 */
export function PreviewToolbarTools({
  onExportPdf,
  exportingPdf = false,
  onOpenInBrowser,
  openingInBrowser = false
}: PreviewToolbarToolsProps): React.JSX.Element | null {
  if (onExportPdf === undefined && onOpenInBrowser === undefined) return null
  return (
    <>
      <span className="erf-band__separator" aria-hidden="true" />
      {onOpenInBrowser !== undefined && (
        <PreviewOpenInBrowserTool onOpenInBrowser={onOpenInBrowser} busy={openingInBrowser} />
      )}
      {onExportPdf !== undefined && (
        <button
          type="button"
          className="erf-band__tool"
          aria-label="Export to PDF"
          title="Export to PDF"
          data-testid="preview-band-export-pdf"
          /* deviates: design/system/components/permission-band/index.html — the card
             makes a tool that cannot act aria-disabled; Export still takes disabled,
             which Chromium blurs, so focus falls to the page body when the save
             dialog closes. Moving it to aria-disabled is follow-up work. */
          disabled={exportingPdf}
          onClick={onExportPdf}
        >
          <FileDown size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </>
  )
}
