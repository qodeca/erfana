// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Mermaid Theme Configurations
 *
 * Uses Mermaid's built-in themes.
 * @see https://mermaid.js.org/config/theming.html
 */

import type { MermaidConfig } from 'mermaid'

/**
 * Available Mermaid built-in themes.
 */
export type MermaidBuiltInTheme = 'default' | 'neutral' | 'dark' | 'forest' | 'base'

/**
 * Current active theme.
 * - 'default': Standard Mermaid theme
 * - 'neutral': Black and white, good for printing
 * - 'dark': Built-in dark mode theme
 * - 'forest': Green color tones
 * - 'base': Customizable via themeVariables
 */
export const ACTIVE_THEME: MermaidBuiltInTheme = 'default'

/**
 * Get complete Mermaid initialization config with theme.
 * Includes layout settings for various diagram types.
 */
export function getMermaidConfig(_isDarkMode: boolean): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: ACTIVE_THEME,
    flowchart: {
      htmlLabels: true,
      curve: 'basis'
    },
    sequence: {
      diagramMarginX: 50,
      diagramMarginY: 10,
      actorMargin: 50,
      width: 150,
      height: 65,
      boxMargin: 10,
      boxTextMargin: 5,
      noteMargin: 10,
      messageMargin: 35
    },
    gantt: {
      titleTopMargin: 25,
      barHeight: 20,
      barGap: 4,
      topPadding: 50,
      leftPadding: 75,
      gridLineStartPadding: 35,
      fontSize: 11
    }
  }
}
