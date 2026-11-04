// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The project row's buttons, in toolbar order (#451): one definition each for
 * the row button and its "More actions" menu item. New file is raised (the
 * everyday action moves last; Toolbar overflow card, decided).
 *
 * @module components/ProjectTree/projectRowActions
 */
import { FilePlus, FolderPlus, FolderOpen, Replace, FileUp, RotateCw, X as CloseIcon } from 'lucide-react'
import type { ToolbarAction } from '../ToolbarOverflow/ToolbarOverflow'
import { formatShortcut } from '../../utils/shortcutLabel'
import { TEST_IDS } from '../../constants/testids'

/** The project tree state and handlers the row's buttons read. */
export interface ProjectRowActionsInput {
  projectPath: string | null
  isSwitchingProject: boolean
  loading: boolean
  isImporting: boolean
  isAnyRefreshing: boolean
  onOpenProject: () => void
  onCloseProject: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onImport: () => void
  onRefresh: () => void
}

/**
 * Build the project row's actions. Without a project only Open project shows.
 *
 * @param p - Project tree state and handlers
 * @returns The actions, left to right
 */
export function buildProjectRowActions(p: ProjectRowActionsInput): ToolbarAction[] {
  const changeProjectLabel = p.projectPath ? 'Change project' : 'Open project'
  const refreshShortcut = formatShortcut('R', { mod: true, alt: true })
  return [
    {
      id: 'open',
      icon: p.isSwitchingProject ? (
        <RotateCw size={14} strokeWidth={2} className="spin" data-testid={TEST_IDS.PROJECT_TREE_LOADING} />
      ) : p.projectPath ? (
        <Replace size={14} strokeWidth={2} />
      ) : (
        <FolderOpen size={14} strokeWidth={2} />
      ),
      label: changeProjectLabel,
      title: changeProjectLabel,
      onSelect: p.onOpenProject,
      disabled: p.isSwitchingProject,
      testId: TEST_IDS.PROJECT_TREE_BTN_OPEN
    },
    ...(p.projectPath
      ? [
          {
            id: 'close',
            icon: <CloseIcon size={14} strokeWidth={2} />,
            label: 'Close project',
            title: 'Close project',
            onSelect: p.onCloseProject,
            disabled: p.isSwitchingProject,
            testId: TEST_IDS.PROJECT_TREE_BTN_CLOSE
          },
          {
            id: 'new-file',
            icon: <FilePlus size={14} strokeWidth={2} />,
            label: 'Create new markdown file',
            title: 'Create new markdown file',
            onSelect: p.onNewFile,
            disabled: p.loading,
            testId: TEST_IDS.PROJECT_TREE_BTN_NEW_FILE,
            moveLast: true
          },
          {
            id: 'new-folder',
            icon: <FolderPlus size={14} strokeWidth={2} />,
            label: 'Create new folder',
            title: 'Create new folder',
            onSelect: p.onNewFolder,
            disabled: p.loading,
            testId: TEST_IDS.PROJECT_TREE_BTN_NEW_FOLDER
          },
          {
            id: 'import',
            icon: p.isImporting ? (
              <RotateCw size={14} strokeWidth={2} className="spin" />
            ) : (
              <FileUp size={14} strokeWidth={2} />
            ),
            label: 'Import a file',
            title: p.isImporting ? 'Importing file...' : 'Import a file',
            ariaLabel: p.isImporting ? 'Importing file...' : 'Import a file',
            onSelect: p.onImport,
            busy: p.isImporting,
            busyLabel: 'Importing file…',
            testId: TEST_IDS.PROJECT_TREE_BTN_IMPORT
          },
          {
            id: 'refresh',
            icon: <RotateCw size={14} strokeWidth={2} className={p.isAnyRefreshing ? 'spin' : ''} />,
            label: 'Refresh',
            title: `Refresh (${refreshShortcut})`,
            ariaLabel: 'Refresh project tree and git status',
            shortcut: refreshShortcut,
            onSelect: p.onRefresh,
            disabled: p.isAnyRefreshing,
            testId: TEST_IDS.PROJECT_TREE_BTN_REFRESH
          }
        ]
      : [])
  ]
}
