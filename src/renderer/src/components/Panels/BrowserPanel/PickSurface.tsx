// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The prompt-actions panel or the instruction dialog, placed over the still
 * image next to the outline (spec 025, 025-FR-030; design § Prompt-actions
 * panel, § Layout rules "The sheet"; commit 19). Placement is
 * `pickPanel.logic.ts`; this measures the page area and the surface and
 * applies it, again whenever the picked element moves.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { StillBitmap } from '../../../stores/useBrowserStillStore'
import { InstructionDialog } from './InstructionDialog'
import { PromptActionsPanel } from './PromptActionsPanel'
import { anchorOnStill, placePanel, type PanelPlacement } from './pickPanel.logic'
import { NOTE_TEXT } from './pickRow.logic'
import type { BrowserPick } from './useBrowserPick'

/** Props for {@link PickSurface}. */
export interface PickSurfaceProps {
  readonly pick: BrowserPick
  readonly image: StillBitmap | null
  readonly zoomPercent: number
  /** The target button for the panel and the dialog. */
  readonly target: React.ReactNode
}

/**
 * Renders the open surface, or nothing.
 *
 * @param props - {@link PickSurfaceProps}
 * @returns The panel or the dialog
 */
export function PickSurface({ pick, image, zoomPercent, target }: PickSurfaceProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<PanelPlacement | null>(null)
  const capture = pick.tab.capture
  const box = capture?.summary.box ?? null

  useLayoutEffect(() => {
    const surface = ref.current
    const area = surface?.parentElement
    if (surface === null || area === null || area === undefined || box === null) return
    const areaSize = { width: area.clientWidth, height: area.clientHeight }
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
    const pageWidth = image === null ? areaSize.width : image.width / ratio
    const anchor = anchorOnStill(box, zoomPercent, pageWidth, areaSize)
    setPlacement(placePanel(anchor, { width: surface.offsetWidth, height: surface.offsetHeight }, areaSize))
  }, [box, image, zoomPercent, pick.surface])

  if (capture === null || pick.surface === 'none') return null
  const sheet = placement?.kind === 'sheet'
  // Placed in a layout effect, before the first paint – so the unplaced first render is never seen. It must
  // not be `visibility: hidden`: the surface moves keyboard focus into itself as it mounts, and a hidden
  // control cannot take focus.
  const style: React.CSSProperties =
    placement === null || placement.kind === 'sheet' ? {} : { left: placement.left, top: placement.top }
  if (pick.surface === 'dialog' && pick.dialogAction !== null) {
    return (
      <InstructionDialog
        dialogRef={ref}
        action={pick.dialogAction}
        text={pick.draft}
        onText={pick.setDraft}
        busy={pick.busy !== null}
        banner={pick.banner}
        pageReloaded={capture.afterNavigation}
        frozen={pick.tab.frozen}
        onSend={() => pick.send(pick.dialogAction ?? 'prompt')}
        onCancel={() => pick.close('cancel')}
        onBack={pick.back}
        onBannerAction={pick.bannerAction}
        target={target}
        style={style}
        sheet={sheet}
      />
    )
  }
  return (
    <PromptActionsPanel
      panelRef={ref}
      capture={capture}
      frozen={pick.tab.frozen}
      note={pick.tab.note === null ? null : NOTE_TEXT[pick.tab.note]}
      banner={pick.banner}
      busy={pick.busy}
      focusAction={pick.returnAction}
      onAction={action => (action === 'explain' ? pick.send('explain') : pick.openDialog(action))}
      onRefine={pick.refine}
      onClose={() => pick.close('esc')}
      onBannerAction={pick.bannerAction}
      target={target}
      style={style}
      sheet={sheet}
    />
  )
}
