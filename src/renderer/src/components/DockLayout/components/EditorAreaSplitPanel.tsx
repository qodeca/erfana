// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import {
  DockviewReact,
  DockviewReadyEvent,
  ISplitviewPanelProps,
  IDockviewPanelProps
} from 'dockview'
import { MarkdownEditorPanel } from '../../Panels/MarkdownEditorPanel'
import { ImageViewerPanel, type ImageViewerPanelParams } from '../../Panels/ImageViewerPanel'
import { HtmlPreviewPanel, type HtmlPreviewPanelParams } from '../../Panels/HtmlPreviewPanel'
import { PanelErrorBoundary } from '../../Panels/PanelErrorBoundary'
import { WelcomePanel } from '../../Panels/WelcomePanel'
import { WelcomeTab } from '../../Panels/WelcomeTab'
import { EditorTab, ImageTab, HtmlPreviewTab } from '../../Tabs'
import { getOverlayGuard } from '../../../services/preview/OverlayGuardService'
import { useActivityBarStore } from '../../../stores/useActivityBarStore'
import { logger } from '../../../utils/logger'
import { TEST_IDS } from '../../../constants/testids'
import { WELCOME_PANEL_ID } from '../../../constants/panels'

/**
 * Image viewer registration wrapper.
 *
 * The error boundary is mounted **here**, at the registration site, rather than
 * inside `ImageViewerPanel`: a boundary rendered by the component it is meant to
 * protect cannot catch that component's own hook errors, and the #70 work puts
 * the file-watch subscription and the decode pipeline in exactly those hooks.
 *
 * Keyed by `filePath` so a panel that failed on one image does not stay stuck at
 * "unavailable" after the tab is pointed at another file.
 *
 * Declared at module scope: an inline arrow in `editorComponents` would be a new
 * component type on every render and remount every image tab.
 */
const ImageViewerPanelWithBoundary = (
  props: IDockviewPanelProps<ImageViewerPanelParams>
): JSX.Element => (
  <PanelErrorBoundary
    key={props.params?.filePath ?? 'none'}
    componentName="Image viewer"
  >
    <ImageViewerPanel {...props} />
  </PanelErrorBoundary>
)

/**
 * HTML preview registration wrapper (Issue #74, work item 80).
 *
 * Same rationale as {@link ImageViewerPanelWithBoundary}: the error boundary is
 * mounted at the registration site so it can catch the panel's own hook errors
 * (bounds pump, lifecycle open/close, the find provider), and it is keyed by
 * `filePath` so a panel that failed on one page recovers when pointed at
 * another. Declared at module scope so it is not a new component type each
 * render — a remount would tear down and re-open the native `WebContentsView`.
 */
const HtmlPreviewPanelWithBoundary = (
  props: IDockviewPanelProps<HtmlPreviewPanelParams>
): JSX.Element => (
  <PanelErrorBoundary key={props.params?.filePath ?? 'none'} componentName="HTML preview">
    <HtmlPreviewPanel {...props} />
  </PanelErrorBoundary>
)

/**
 * Center splitview panel that hosts the nested DockviewReact instance holding
 * every editor and image-viewer tab.
 *
 * Mounted by `AppDockLayout` as the `editorArea` splitview component. It hands
 * its `DockviewApi` back to the parent through `params.setDockviewApi` once
 * dockview is ready, which is how the rest of the app opens files into tabs.
 *
 * @param props - Splitview panel props; `params.setDockviewApi` receives the API
 * @returns The editor-area dockview container
 */
export const EditorAreaSplitPanel = (props: ISplitviewPanelProps): JSX.Element => {
  const onEditorReady = (event: DockviewReadyEvent) => {
    logger.info('📝 Editor DockView ready')

    // Create the welcome/home panel
    const welcomePanel = event.api.addPanel({
      id: WELCOME_PANEL_ID,
      component: 'welcome',
      title: '',
      tabComponent: 'welcomeTab'
    })

    // Disable dragging for welcome tab
    if (welcomePanel) {
      welcomePanel.group.locked = true
    }

    // Listen for active panel changes and focus the panel content
    event.api.onDidActivePanelChange((panel) => {
      // Recompute preview visibility on every tab switch (design §1.8 X18): a
      // tab switch changes no occluder count, so the overlay guard has no other
      // trigger to hide the preview when you switch away / show it when you
      // switch back. Safe for non-preview panels — the guard is a no-op unless a
      // preview is live.
      getOverlayGuard().sync(panel?.id ?? null)

      if (panel) {
        if (panel.id !== WELCOME_PANEL_ID) {
          // Revealing any editor/image file exits terminal-expand (decision: auto-collapse).
          useActivityBarStore.getState().setTerminalExpanded(false)
        }

        // Focus the group to show the active indicator
        panel.group.focus()

        // Use setTimeout to ensure the DOM is ready and focus the content
        setTimeout(() => {
          const panelElement = panel.group.element.querySelector('.panel-content, .markdown-editor-panel')
          if (panelElement instanceof HTMLElement) {
            panelElement.focus()
          }
        }, 0)
      }
    })

    // Pass the API to parent via params callback
    if (props.params?.setDockviewApi) {
      props.params.setDockviewApi(event.api)
    }
  }

  // Dockview components registry for editor area. The `htmlPreview` /
  // `htmlPreviewTab` ids MUST match `openFileInPanel`'s PANEL_KIND_DESCRIPTORS
  // (issue #74, work item 80) or a `.html` file opens on an unknown component.
  const editorComponents = {
    editor: MarkdownEditorPanel,
    imageViewer: ImageViewerPanelWithBoundary,
    htmlPreview: HtmlPreviewPanelWithBoundary,
    welcome: WelcomePanel
  }

  return (
    <div style={{ width: '100%', height: '100%' }} data-testid={TEST_IDS.EDITOR_AREA}>
      <DockviewReact
        components={editorComponents}
        tabComponents={{
          welcomeTab: WelcomeTab,
          editorTab: EditorTab,
          imageTab: ImageTab,
          htmlPreviewTab: HtmlPreviewTab
        }}
        onReady={onEditorReady}
        className="dockview-theme-dark"
        // Dockview is used for editor tabs only — never docking/splitting (see
        // docs/architecture.md). Disabling DnD drops the `dv-draggable` class from the
        // tab-header void area, removing the misleading open-hand "grab" cursor at its
        // source and preventing accidental group splits/tear-outs. Tabs still switch and
        // close normally.
        //
        // Drag occluder (issue #74, work item 80): the 'drag' OccluderKind exists
        // to hide the native preview view during a tab drag. It is deliberately
        // NOT wired here because `disableDnd` means no drag can start — a producer
        // for an event that cannot fire would be dead code (and untestable). If
        // DnD is ever enabled, push `useOccluder('drag', dragging)` from the drag
        // start/end events; OverlayGuardService already consumes that kind.
        disableDnd
      />
    </div>
  )
}
