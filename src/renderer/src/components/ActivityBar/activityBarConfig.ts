// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { LucideIcon, Files, Search, Terminal } from 'lucide-react'
import { TEST_IDS } from '../../constants/testids'

export interface ActivityBarPanel {
  id: string
  icon: LucideIcon
  label: string
  tooltip: string
  side: 'left' | 'right'
  dockviewPanelId: string
  order: number
  keyboardShortcut?: string
  enabled?: boolean
  requiresProject?: boolean // Panel hidden when no project is loaded
  testId?: string
  badge?: () => number | string | null
}

// Badge functions (to be implemented with real data)
const getFileCount = (): number | null => {
  // TODO: Hook into file tree state to count files
  return null
}


const getTerminalActiveIndicator = (): string | null => {
  // TODO: Show indicator when terminal has active session
  return null
}

export const activityBarPanels: ActivityBarPanel[] = [
  // Left sidebar panels
  {
    id: 'project',
    icon: Files,
    label: 'Project',
    tooltip: 'Project (⌘B)',
    side: 'left',
    dockviewPanelId: 'project',
    order: 1,
    keyboardShortcut: 'mod+b',
    enabled: true,
    testId: TEST_IDS.ACTIVITY_BAR_BTN_FILES,
    badge: getFileCount
  },
  {
    id: 'search',
    icon: Search,
    label: 'Search',
    tooltip: 'Search (⌘⇧F)',
    side: 'left',
    dockviewPanelId: 'search',
    order: 2,
    keyboardShortcut: 'mod+shift+f',
    enabled: false // Coming soon
  },

  // Right sidebar panels
  {
    id: 'terminal',
    icon: Terminal,
    label: 'Terminal',
    tooltip: 'Terminal (⌘J)',
    side: 'right',
    dockviewPanelId: 'terminal',
    order: 1,
    keyboardShortcut: 'mod+j',
    enabled: true,
    requiresProject: true, // Hide when no project loaded
    testId: TEST_IDS.ACTIVITY_BAR_BTN_TERMINAL,
    badge: getTerminalActiveIndicator
  }
]

// Helper function to get panels by side
export const getPanelsBySide = (side: 'left' | 'right'): ActivityBarPanel[] => {
  return activityBarPanels
    .filter((p) => p.side === side && p.enabled !== false)
    .sort((a, b) => a.order - b.order)
}

// Helper function to get panel by ID
export const getPanelById = (id: string): ActivityBarPanel | undefined => {
  return activityBarPanels.find((p) => p.id === id)
}
