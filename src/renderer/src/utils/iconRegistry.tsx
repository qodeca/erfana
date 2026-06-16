// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Centralized Icon Registry
 *
 * Maps icon identifier strings to Lucide React components.
 * Provides type-safe icon resolution with fallback handling.
 *
 * Benefits:
 * - Single source of truth for icon mappings
 * - Type-safe icon names
 * - Consistent icon sizing across the app
 * - Easy to add new icons
 * - Testable
 */

import { ReactNode, ComponentType } from 'react'
import {
  Maximize2,
  Minimize2,
  RefreshCw,
  Sparkles,
  Copy,
  Edit3,
  HelpCircle,
  MessageCircle,
  FileText,
  AlertCircle,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  LucideProps
} from 'lucide-react'

/**
 * Default icon props for consistent sizing
 */
export const DEFAULT_ICON_PROPS = {
  size: 14,
  strokeWidth: 2
} as const

/**
 * Large icon props for buttons and headers
 */
export const LARGE_ICON_PROPS = {
  size: 18,
  strokeWidth: 2
} as const

/**
 * Supported icon names
 */
export type IconName =
  | 'maximize2'
  | 'minimize2'
  | 'refresh'
  | 'sparkles'
  | 'copy'
  | 'edit-3'
  | 'help-circle'
  | 'message-circle'
  | 'file-text'
  | 'alert-circle'
  | 'arrow-right'
  | 'arrow-down'
  | 'arrow-up'
  | 'arrow-left'

/**
 * Icon registry mapping names to Lucide components
 */
const ICON_REGISTRY: Record<IconName, ComponentType<LucideProps>> = {
  'maximize2': Maximize2,
  'minimize2': Minimize2,
  'refresh': RefreshCw,
  'sparkles': Sparkles,
  'copy': Copy,
  'edit-3': Edit3,
  'help-circle': HelpCircle,
  'message-circle': MessageCircle,
  'file-text': FileText,
  'alert-circle': AlertCircle,
  'arrow-right': ArrowRight,
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  'arrow-left': ArrowLeft
}

/**
 * Default fallback icon when unknown name is provided
 */
const FALLBACK_ICON = Sparkles

/**
 * Get a Lucide icon component by name
 *
 * @param name - Icon identifier string
 * @returns Lucide icon component (or fallback if not found)
 *
 * @example
 * const Icon = getIcon('maximize2')
 * <Icon size={14} />
 */
export function getIcon(name: string): ComponentType<LucideProps> {
  return ICON_REGISTRY[name as IconName] ?? FALLBACK_ICON
}

/**
 * Check if an icon name is valid (exists in registry)
 *
 * @param name - Icon identifier to check
 * @returns true if icon exists in registry
 */
export function isValidIcon(name: string): name is IconName {
  return name in ICON_REGISTRY
}

/**
 * Get a rendered icon element with default props
 *
 * @param name - Icon identifier string
 * @param props - Optional additional props to merge
 * @returns Rendered icon ReactNode
 *
 * @example
 * // In JSX
 * {renderIcon('edit-3')}
 *
 * // With custom props
 * {renderIcon('help-circle', { size: 18 })}
 */
export function renderIcon(
  name: string,
  props: Partial<LucideProps> = {}
): ReactNode {
  const Icon = getIcon(name)
  const mergedProps = { ...DEFAULT_ICON_PROPS, ...props }
  return <Icon {...mergedProps} />
}

/**
 * Get all registered icon names
 *
 * @returns Array of all supported icon names
 */
export function getAllIconNames(): IconName[] {
  return Object.keys(ICON_REGISTRY) as IconName[]
}
