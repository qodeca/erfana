// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * **New browser tab** – an icon tool after the last tab in each editor strip,
 * outside the `tablist` (spec 025, 025-FR-001; design `tab-and-toolbar.html`
 * § Opening a browser tab, frame "New browser tab – rest"). Mounted as the
 * editor dockview's `leftHeaderActionsComponent`.
 *
 * A browser tab needs a project (its profile lives in the project folder), so
 * the tool is shown only while one is open. The tooltip is the name alone:
 * Ctrl/Cmd+T opens a tab only from a browser tab's own focus today, and the
 * design names the key only where it acts.
 */
import { Plus } from 'lucide-react'
import type { IDockviewHeaderActionsProps } from 'dockview'
import { useProjectManagementContext } from '../../context/ProjectManagementContext'
import { NEW_BROWSER_TAB_TITLE, openBrowserTab } from '../../utils/openBrowserTab'
import './BrowserTab.css'

/**
 * The editor strip's New browser tab tool.
 *
 * @param props - Dockview header-actions props
 * @returns The button, or nothing without a project
 */
export function NewBrowserTabButton(props: IDockviewHeaderActionsProps): JSX.Element | null {
  const { projectPath } = useProjectManagementContext()
  if (!projectPath) return null
  return (
    <button
      type="button"
      className="erf-brw-newtab"
      aria-label={NEW_BROWSER_TAB_TITLE}
      title={NEW_BROWSER_TAB_TITLE}
      onClick={() => openBrowserTab(props.containerApi)}
    >
      <Plus size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}
