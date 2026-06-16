// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for Mermaid Theme Configurations
 */

import { describe, it, expect } from 'vitest'
import { ACTIVE_THEME, getMermaidConfig, type MermaidBuiltInTheme } from './mermaidThemes'

describe('mermaidThemes', () => {
  describe('ACTIVE_THEME', () => {
    it('should be a valid built-in theme', () => {
      const validThemes: MermaidBuiltInTheme[] = ['default', 'neutral', 'dark', 'forest', 'base']
      expect(validThemes).toContain(ACTIVE_THEME)
    })
  })

  describe('getMermaidConfig', () => {
    it('should return complete Mermaid config', () => {
      const config = getMermaidConfig(true)

      expect(config.startOnLoad).toBe(false)
      expect(config.securityLevel).toBe('strict')
      expect(config.theme).toBe(ACTIVE_THEME)
    })

    it('should include flowchart configuration', () => {
      const config = getMermaidConfig(true)

      expect(config.flowchart).toBeDefined()
      expect(config.flowchart?.htmlLabels).toBe(true)
      expect(config.flowchart?.curve).toBe('basis')
    })

    it('should include sequence diagram configuration', () => {
      const config = getMermaidConfig(true)

      expect(config.sequence).toBeDefined()
      expect(config.sequence?.diagramMarginX).toBe(50)
      expect(config.sequence?.diagramMarginY).toBe(10)
      expect(config.sequence?.actorMargin).toBe(50)
    })

    it('should include gantt chart configuration', () => {
      const config = getMermaidConfig(true)

      expect(config.gantt).toBeDefined()
      expect(config.gantt?.titleTopMargin).toBe(25)
      expect(config.gantt?.barHeight).toBe(20)
      expect(config.gantt?.fontSize).toBe(11)
    })

    it('should always use strict security level', () => {
      expect(getMermaidConfig(true).securityLevel).toBe('strict')
      expect(getMermaidConfig(false).securityLevel).toBe('strict')
    })
  })
})
