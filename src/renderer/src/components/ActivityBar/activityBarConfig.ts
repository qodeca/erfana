import { LucideIcon, Files, Search, GitBranch, Terminal, Bot } from 'lucide-react'

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
  badge?: () => number | string | null
}

// Badge functions (to be implemented with real data)
const getFileCount = (): number | null => {
  // TODO: Hook into file tree state to count files
  return null
}

const getGitChangesCount = (): number | null => {
  // TODO: Hook into git service to count changes
  return null
}

const getTerminalActiveIndicator = (): string | null => {
  // TODO: Show indicator when terminal has active session
  return null
}

export const activityBarPanels: ActivityBarPanel[] = [
  // Left sidebar panels
  {
    id: 'explorer',
    icon: Files,
    label: 'Explorer',
    tooltip: 'Explorer (⌘B)',
    side: 'left',
    dockviewPanelId: 'fileExplorer',
    order: 1,
    keyboardShortcut: 'mod+b',
    enabled: true,
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
    id: 'git',
    icon: GitBranch,
    label: 'Source Control',
    tooltip: 'Source Control (⌃⇧G)',
    side: 'right',
    dockviewPanelId: 'git',
    order: 1,
    keyboardShortcut: 'ctrl+shift+g',
    enabled: true,
    badge: getGitChangesCount
  },
  {
    id: 'terminal',
    icon: Terminal,
    label: 'Terminal',
    tooltip: 'Terminal (⌘J)',
    side: 'right',
    dockviewPanelId: 'terminal',
    order: 2,
    keyboardShortcut: 'mod+j',
    enabled: true,
    badge: getTerminalActiveIndicator
  },
  {
    id: 'claude',
    icon: Bot,
    label: 'Claude AI',
    tooltip: 'Claude AI Assistant (⌘⇧A)',
    side: 'right',
    dockviewPanelId: 'claude',
    order: 3,
    keyboardShortcut: 'mod+shift+a',
    enabled: true
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
