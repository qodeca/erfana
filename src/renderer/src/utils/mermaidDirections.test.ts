// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for mermaidDirections.ts
 * Pure logic tests - no React dependencies
 *
 * Comprehensive tests for all Mermaid diagrams that support direction:
 * - flowchart/graph: TB, TD, BT, LR, RL (inline syntax)
 * - stateDiagram, classDiagram, erDiagram, requirementDiagram: TB, BT, LR, RL (direction statement)
 * - gitGraph: LR, TB, BT (colon syntax)
 */

import { describe, it, expect } from 'vitest'
import {
  detectChartType,
  supportsDirection,
  getAvailableDirections,
  detectCurrentDirection,
  getDefaultDirection,
  isValidDirection,
  getDirectionTooltip,
  isDirectionDisabled,
  isDirectionActive,
  usesDirectionStatement,
  usesColonSyntax,
  FLOWCHART_DIRECTIONS,
  STANDARD_DIRECTIONS,
  GITGRAPH_DIRECTIONS,
  DIRECTION_LABELS
} from './mermaidDirections'

describe('mermaidDirections', () => {
  describe('detectChartType', () => {
    describe('flowchart detection', () => {
      it('should detect "flowchart" keyword', () => {
        expect(detectChartType('flowchart TD\n  A --> B')).toBe('flowchart')
      })

      it('should detect "flowchart" with LR direction', () => {
        expect(detectChartType('flowchart LR\n  A --> B')).toBe('flowchart')
      })

      it('should detect "flowchart" case-insensitively', () => {
        expect(detectChartType('FLOWCHART TD\n  A --> B')).toBe('flowchart')
        expect(detectChartType('Flowchart LR\n  A --> B')).toBe('flowchart')
      })

      it('should detect "graph" keyword', () => {
        expect(detectChartType('graph TD\n  A --> B')).toBe('graph')
      })

      it('should detect "graph" with various directions', () => {
        expect(detectChartType('graph LR\n  A --> B')).toBe('graph')
        expect(detectChartType('graph BT\n  A --> B')).toBe('graph')
        expect(detectChartType('graph RL\n  A --> B')).toBe('graph')
      })
    })

    describe('state diagram detection', () => {
      it('should detect "stateDiagram"', () => {
        expect(detectChartType('stateDiagram\n  [*] --> State1')).toBe('stateDiagram')
      })

      it('should detect "stateDiagram-v2"', () => {
        expect(detectChartType('stateDiagram-v2\n  [*] --> State1')).toBe('stateDiagram')
      })

      it('should detect stateDiagram case-insensitively', () => {
        expect(detectChartType('STATEDIAGRAM\n  [*] --> State1')).toBe('stateDiagram')
        expect(detectChartType('StateDiagram-v2\n  [*] --> State1')).toBe('stateDiagram')
      })
    })

    describe('class diagram detection', () => {
      it('should detect "classDiagram"', () => {
        expect(detectChartType('classDiagram\n  class Animal')).toBe('classDiagram')
      })

      it('should detect "classDiagram-v2"', () => {
        expect(detectChartType('classDiagram-v2\n  class Animal')).toBe('classDiagram')
      })

      it('should detect classDiagram case-insensitively', () => {
        expect(detectChartType('CLASSDIAGRAM\n  class Animal')).toBe('classDiagram')
        expect(detectChartType('ClassDiagram\n  class Animal')).toBe('classDiagram')
      })
    })

    describe('ER diagram detection', () => {
      it('should detect "erDiagram"', () => {
        expect(detectChartType('erDiagram\n  CUSTOMER ||--o{ ORDER : places')).toBe('erDiagram')
      })

      it('should detect erDiagram case-insensitively', () => {
        expect(detectChartType('ERDIAGRAM\n  CUSTOMER ||--o{ ORDER : places')).toBe('erDiagram')
        expect(detectChartType('ErDiagram\n  CUSTOMER ||--o{ ORDER : places')).toBe('erDiagram')
      })
    })

    describe('requirement diagram detection', () => {
      it('should detect "requirementDiagram"', () => {
        expect(detectChartType('requirementDiagram\n  requirement test_req')).toBe(
          'requirementDiagram'
        )
      })

      it('should detect requirementDiagram case-insensitively', () => {
        expect(detectChartType('REQUIREMENTDIAGRAM\n  requirement test_req')).toBe(
          'requirementDiagram'
        )
      })
    })

    describe('gitGraph detection', () => {
      it('should detect "gitGraph"', () => {
        expect(detectChartType('gitGraph\n  commit')).toBe('gitGraph')
      })

      it('should detect "gitGraph" with LR direction', () => {
        expect(detectChartType('gitGraph LR:\n  commit')).toBe('gitGraph')
      })

      it('should detect "gitGraph" with TB direction', () => {
        expect(detectChartType('gitGraph TB:\n  commit')).toBe('gitGraph')
      })

      it('should detect gitGraph case-insensitively', () => {
        expect(detectChartType('GITGRAPH\n  commit')).toBe('gitGraph')
        expect(detectChartType('GitGraph\n  commit')).toBe('gitGraph')
      })
    })

    describe('other chart types (no direction support)', () => {
      it('should detect sequenceDiagram', () => {
        expect(detectChartType('sequenceDiagram\n  A->>B: Hello')).toBe('sequencediagram')
      })

      it('should detect journey', () => {
        expect(detectChartType('journey\n  title My Journey')).toBe('journey')
      })

      it('should detect gantt', () => {
        expect(detectChartType('gantt\n  title A Gantt Diagram')).toBe('gantt')
      })

      it('should detect pie', () => {
        expect(detectChartType('pie\n  "Dogs" : 386')).toBe('pie')
      })

      it('should detect mindmap', () => {
        expect(detectChartType('mindmap\n  root((mindmap))')).toBe('mindmap')
      })

      it('should detect timeline', () => {
        expect(detectChartType('timeline\n  title History')).toBe('timeline')
      })

      it('should detect C4 diagrams', () => {
        expect(detectChartType('C4Context\n  title System Context')).toBe('c4context')
        expect(detectChartType('C4Container\n  title Container')).toBe('c4container')
      })

      it('should detect quadrantChart', () => {
        expect(detectChartType('quadrantChart\n  title Quadrant')).toBe('quadrantchart')
      })

      it('should detect sankey', () => {
        expect(detectChartType('sankey\n  A,B,5')).toBe('sankey')
      })

      it('should detect xychart', () => {
        expect(detectChartType('xychart-beta\n  title Chart')).toBe('xychart')
      })
    })

    describe('edge cases', () => {
      it('should return null for empty string', () => {
        expect(detectChartType('')).toBeNull()
      })

      it('should return null for null/undefined', () => {
        expect(detectChartType(null as unknown as string)).toBeNull()
        expect(detectChartType(undefined as unknown as string)).toBeNull()
      })

      it('should return null for unknown chart types', () => {
        expect(detectChartType('unknownChart\n  something')).toBeNull()
      })

      it('should handle leading whitespace', () => {
        expect(detectChartType('  flowchart TD\n  A --> B')).toBe('flowchart')
        expect(detectChartType('\n\nflowchart LR\n  A --> B')).toBe('flowchart')
      })

      it('should only check first line', () => {
        expect(detectChartType('flowchart TD\nstateDiagram')).toBe('flowchart')
      })
    })
  })

  describe('supportsDirection', () => {
    describe('flowchart/graph', () => {
      it('should return true for flowchart', () => {
        expect(supportsDirection('flowchart')).toBe(true)
      })

      it('should return true for graph', () => {
        expect(supportsDirection('graph')).toBe(true)
      })
    })

    describe('diagrams with direction statement', () => {
      it('should return true for stateDiagram', () => {
        expect(supportsDirection('stateDiagram')).toBe(true)
      })

      it('should return true for classDiagram', () => {
        expect(supportsDirection('classDiagram')).toBe(true)
      })

      it('should return true for erDiagram', () => {
        expect(supportsDirection('erDiagram')).toBe(true)
      })

      it('should return true for requirementDiagram', () => {
        expect(supportsDirection('requirementDiagram')).toBe(true)
      })
    })

    describe('gitGraph', () => {
      it('should return true for gitGraph', () => {
        expect(supportsDirection('gitGraph')).toBe(true)
      })
    })

    describe('case sensitivity', () => {
      it('should be case-insensitive', () => {
        expect(supportsDirection('FLOWCHART')).toBe(true)
        expect(supportsDirection('StateDiagram')).toBe(true)
        expect(supportsDirection('CLASSDIAGRAM')).toBe(true)
        expect(supportsDirection('erdiagram')).toBe(true)
        expect(supportsDirection('GITGRAPH')).toBe(true)
      })
    })

    describe('unsupported chart types', () => {
      it('should return false for other chart types', () => {
        expect(supportsDirection('sequencediagram')).toBe(false)
        expect(supportsDirection('gantt')).toBe(false)
        expect(supportsDirection('pie')).toBe(false)
        expect(supportsDirection('mindmap')).toBe(false)
        expect(supportsDirection('timeline')).toBe(false)
      })

      it('should return false for null', () => {
        expect(supportsDirection(null)).toBe(false)
      })
    })
  })

  describe('getAvailableDirections', () => {
    describe('flowchart/graph', () => {
      it('should return flowchart directions for flowchart', () => {
        expect(getAvailableDirections('flowchart')).toEqual(FLOWCHART_DIRECTIONS)
      })

      it('should return flowchart directions for graph', () => {
        expect(getAvailableDirections('graph')).toEqual(FLOWCHART_DIRECTIONS)
      })

      it('should include TD for flowcharts', () => {
        expect(getAvailableDirections('flowchart')).toContain('TD')
      })
    })

    describe('standard diagrams (direction statement)', () => {
      it('should return standard directions for stateDiagram', () => {
        expect(getAvailableDirections('stateDiagram')).toEqual(STANDARD_DIRECTIONS)
      })

      it('should return standard directions for classDiagram', () => {
        expect(getAvailableDirections('classDiagram')).toEqual(STANDARD_DIRECTIONS)
      })

      it('should return standard directions for erDiagram', () => {
        expect(getAvailableDirections('erDiagram')).toEqual(STANDARD_DIRECTIONS)
      })

      it('should return standard directions for requirementDiagram', () => {
        expect(getAvailableDirections('requirementDiagram')).toEqual(STANDARD_DIRECTIONS)
      })

      it('should NOT include TD for standard diagrams', () => {
        expect(getAvailableDirections('stateDiagram')).not.toContain('TD')
        expect(getAvailableDirections('classDiagram')).not.toContain('TD')
        expect(getAvailableDirections('erDiagram')).not.toContain('TD')
      })
    })

    describe('gitGraph', () => {
      it('should return gitGraph directions for gitGraph', () => {
        expect(getAvailableDirections('gitGraph')).toEqual(GITGRAPH_DIRECTIONS)
      })

      it('should NOT include TD or RL for gitGraph', () => {
        expect(getAvailableDirections('gitGraph')).not.toContain('TD')
        expect(getAvailableDirections('gitGraph')).not.toContain('RL')
      })
    })

    describe('case sensitivity', () => {
      it('should be case-insensitive', () => {
        expect(getAvailableDirections('FLOWCHART')).toEqual(FLOWCHART_DIRECTIONS)
        expect(getAvailableDirections('STATEDIAGRAM')).toEqual(STANDARD_DIRECTIONS)
        expect(getAvailableDirections('GITGRAPH')).toEqual(GITGRAPH_DIRECTIONS)
      })
    })

    describe('unsupported types', () => {
      it('should return empty array for unsupported types', () => {
        expect(getAvailableDirections('sequencediagram')).toEqual([])
        expect(getAvailableDirections('pie')).toEqual([])
      })

      it('should return empty array for null', () => {
        expect(getAvailableDirections(null)).toEqual([])
      })
    })
  })

  describe('detectCurrentDirection', () => {
    describe('flowchart', () => {
      it('should detect LR direction', () => {
        expect(detectCurrentDirection('flowchart LR\n  A --> B', 'flowchart')).toBe('LR')
      })

      it('should detect TB direction', () => {
        expect(detectCurrentDirection('flowchart TB\n  A --> B', 'flowchart')).toBe('TB')
      })

      it('should detect TD direction', () => {
        expect(detectCurrentDirection('flowchart TD\n  A --> B', 'flowchart')).toBe('TD')
      })

      it('should detect BT direction', () => {
        expect(detectCurrentDirection('flowchart BT\n  A --> B', 'flowchart')).toBe('BT')
      })

      it('should detect RL direction', () => {
        expect(detectCurrentDirection('flowchart RL\n  A --> B', 'flowchart')).toBe('RL')
      })

      it('should return null when no direction specified', () => {
        expect(detectCurrentDirection('flowchart\n  A --> B', 'flowchart')).toBeNull()
      })

      it('should be case-insensitive for direction', () => {
        expect(detectCurrentDirection('flowchart lr\n  A --> B', 'flowchart')).toBe('LR')
        expect(detectCurrentDirection('flowchart Lr\n  A --> B', 'flowchart')).toBe('LR')
      })
    })

    describe('graph', () => {
      it('should detect direction in graph', () => {
        expect(detectCurrentDirection('graph LR\n  A --> B', 'graph')).toBe('LR')
        expect(detectCurrentDirection('graph TD\n  A --> B', 'graph')).toBe('TD')
      })

      it('should return null when no direction specified in graph', () => {
        expect(detectCurrentDirection('graph\n  A --> B', 'graph')).toBeNull()
      })
    })

    describe('stateDiagram', () => {
      it('should detect direction statement', () => {
        expect(
          detectCurrentDirection('stateDiagram-v2\n  direction LR\n  [*] --> State1', 'stateDiagram')
        ).toBe('LR')
      })

      it('should detect direction with various positions', () => {
        const code = `stateDiagram-v2
  [*] --> State1
  direction TB
  State1 --> State2`
        expect(detectCurrentDirection(code, 'stateDiagram')).toBe('TB')
      })

      it('should return null when no direction statement', () => {
        expect(
          detectCurrentDirection('stateDiagram-v2\n  [*] --> State1', 'stateDiagram')
        ).toBeNull()
      })

      it('should detect BT direction', () => {
        expect(detectCurrentDirection('stateDiagram-v2\n  direction BT', 'stateDiagram')).toBe('BT')
      })

      it('should detect RL direction', () => {
        expect(detectCurrentDirection('stateDiagram-v2\n  direction RL', 'stateDiagram')).toBe('RL')
      })
    })

    describe('classDiagram', () => {
      it('should detect direction statement', () => {
        expect(
          detectCurrentDirection('classDiagram\n  direction LR\n  class Animal', 'classDiagram')
        ).toBe('LR')
      })

      it('should return null when no direction statement', () => {
        expect(detectCurrentDirection('classDiagram\n  class Animal', 'classDiagram')).toBeNull()
      })
    })

    describe('erDiagram', () => {
      it('should detect direction statement', () => {
        expect(
          detectCurrentDirection(
            'erDiagram\n  direction RL\n  CUSTOMER ||--o{ ORDER : places',
            'erDiagram'
          )
        ).toBe('RL')
      })

      it('should return null when no direction statement', () => {
        expect(
          detectCurrentDirection('erDiagram\n  CUSTOMER ||--o{ ORDER : places', 'erDiagram')
        ).toBeNull()
      })
    })

    describe('requirementDiagram', () => {
      it('should detect direction statement', () => {
        expect(
          detectCurrentDirection(
            'requirementDiagram\n  direction BT\n  requirement test_req',
            'requirementDiagram'
          )
        ).toBe('BT')
      })

      it('should return null when no direction statement', () => {
        expect(
          detectCurrentDirection('requirementDiagram\n  requirement test_req', 'requirementDiagram')
        ).toBeNull()
      })
    })

    describe('gitGraph', () => {
      it('should detect LR direction with colon syntax', () => {
        expect(detectCurrentDirection('gitGraph LR:\n  commit', 'gitGraph')).toBe('LR')
      })

      it('should detect TB direction with colon syntax', () => {
        expect(detectCurrentDirection('gitGraph TB:\n  commit', 'gitGraph')).toBe('TB')
      })

      it('should detect BT direction with colon syntax', () => {
        expect(detectCurrentDirection('gitGraph BT:\n  commit', 'gitGraph')).toBe('BT')
      })

      it('should return null when no direction specified (default LR)', () => {
        expect(detectCurrentDirection('gitGraph\n  commit', 'gitGraph')).toBeNull()
      })

      it('should be case-insensitive for direction', () => {
        expect(detectCurrentDirection('gitGraph lr:\n  commit', 'gitGraph')).toBe('LR')
      })
    })

    describe('edge cases', () => {
      it('should return null for null code', () => {
        expect(detectCurrentDirection(null as unknown as string, 'flowchart')).toBeNull()
      })

      it('should return null for null chartType', () => {
        expect(detectCurrentDirection('flowchart LR', null)).toBeNull()
      })

      it('should return null for unsupported chart types', () => {
        expect(detectCurrentDirection('sequenceDiagram\n  A->>B: Hello', 'sequencediagram')).toBeNull()
      })
    })
  })

  describe('getDefaultDirection', () => {
    describe('flowchart/graph', () => {
      it('should return TB for flowchart', () => {
        expect(getDefaultDirection('flowchart')).toBe('TB')
      })

      it('should return TB for graph', () => {
        expect(getDefaultDirection('graph')).toBe('TB')
      })
    })

    describe('standard diagrams', () => {
      it('should return TB for stateDiagram', () => {
        expect(getDefaultDirection('stateDiagram')).toBe('TB')
      })

      it('should return TB for classDiagram', () => {
        expect(getDefaultDirection('classDiagram')).toBe('TB')
      })

      it('should return TB for erDiagram', () => {
        expect(getDefaultDirection('erDiagram')).toBe('TB')
      })

      it('should return TB for requirementDiagram', () => {
        expect(getDefaultDirection('requirementDiagram')).toBe('TB')
      })
    })

    describe('gitGraph', () => {
      it('should return LR for gitGraph (different default)', () => {
        expect(getDefaultDirection('gitGraph')).toBe('LR')
      })
    })

    describe('unsupported types', () => {
      it('should return null for unsupported types', () => {
        expect(getDefaultDirection('sequencediagram')).toBeNull()
        expect(getDefaultDirection(null)).toBeNull()
      })
    })
  })

  describe('isValidDirection', () => {
    describe('flowchart', () => {
      it('should validate flowchart directions', () => {
        expect(isValidDirection('TB', 'flowchart')).toBe(true)
        expect(isValidDirection('TD', 'flowchart')).toBe(true)
        expect(isValidDirection('LR', 'flowchart')).toBe(true)
        expect(isValidDirection('RL', 'flowchart')).toBe(true)
        expect(isValidDirection('BT', 'flowchart')).toBe(true)
      })
    })

    describe('standard diagrams', () => {
      it('should validate state diagram directions', () => {
        expect(isValidDirection('TB', 'stateDiagram')).toBe(true)
        expect(isValidDirection('LR', 'stateDiagram')).toBe(true)
        expect(isValidDirection('BT', 'stateDiagram')).toBe(true)
        expect(isValidDirection('RL', 'stateDiagram')).toBe(true)
      })

      it('should reject TD for state diagrams', () => {
        expect(isValidDirection('TD', 'stateDiagram')).toBe(false)
      })

      it('should validate classDiagram directions', () => {
        expect(isValidDirection('TB', 'classDiagram')).toBe(true)
        expect(isValidDirection('LR', 'classDiagram')).toBe(true)
        expect(isValidDirection('TD', 'classDiagram')).toBe(false)
      })

      it('should validate erDiagram directions', () => {
        expect(isValidDirection('TB', 'erDiagram')).toBe(true)
        expect(isValidDirection('RL', 'erDiagram')).toBe(true)
        expect(isValidDirection('TD', 'erDiagram')).toBe(false)
      })
    })

    describe('gitGraph', () => {
      it('should validate gitGraph directions', () => {
        expect(isValidDirection('LR', 'gitGraph')).toBe(true)
        expect(isValidDirection('TB', 'gitGraph')).toBe(true)
        expect(isValidDirection('BT', 'gitGraph')).toBe(true)
      })

      it('should reject TD and RL for gitGraph', () => {
        expect(isValidDirection('TD', 'gitGraph')).toBe(false)
        expect(isValidDirection('RL', 'gitGraph')).toBe(false)
      })
    })

    describe('edge cases', () => {
      it('should reject invalid directions', () => {
        expect(isValidDirection('XX', 'flowchart')).toBe(false)
        expect(isValidDirection('UP', 'flowchart')).toBe(false)
      })

      it('should be case-insensitive', () => {
        expect(isValidDirection('tb', 'flowchart')).toBe(true)
        expect(isValidDirection('lr', 'flowchart')).toBe(true)
      })

      it('should return false for null chart type', () => {
        expect(isValidDirection('TB', null)).toBe(false)
      })
    })
  })

  describe('getDirectionTooltip', () => {
    it('should return full labels', () => {
      expect(getDirectionTooltip('TB')).toBe('Top to Bottom')
      expect(getDirectionTooltip('TD')).toBe('Top Down')
      expect(getDirectionTooltip('BT')).toBe('Bottom to Top')
      expect(getDirectionTooltip('LR')).toBe('Left to Right')
      expect(getDirectionTooltip('RL')).toBe('Right to Left')
    })

    it('should return direction itself if no label', () => {
      expect(getDirectionTooltip('XX')).toBe('XX')
    })

    it('should have labels for all standard directions', () => {
      expect(Object.keys(DIRECTION_LABELS)).toEqual(['TB', 'TD', 'BT', 'LR', 'RL'])
    })
  })

  describe('isDirectionDisabled', () => {
    it('should disable button matching current direction', () => {
      expect(isDirectionDisabled('LR', 'LR', 'flowchart')).toBe(true)
      expect(isDirectionDisabled('TB', 'TB', 'flowchart')).toBe(true)
    })

    it('should enable buttons not matching current direction', () => {
      expect(isDirectionDisabled('TB', 'LR', 'flowchart')).toBe(false)
      expect(isDirectionDisabled('BT', 'LR', 'flowchart')).toBe(false)
    })

    it('should be case-insensitive', () => {
      expect(isDirectionDisabled('lr', 'LR', 'flowchart')).toBe(true)
      expect(isDirectionDisabled('LR', 'lr', 'flowchart')).toBe(true)
    })

    describe('when no explicit direction (default)', () => {
      it('should disable TB for flowchart (default)', () => {
        expect(isDirectionDisabled('TB', null, 'flowchart')).toBe(true)
      })

      it('should enable non-default directions', () => {
        expect(isDirectionDisabled('LR', null, 'flowchart')).toBe(false)
        expect(isDirectionDisabled('BT', null, 'flowchart')).toBe(false)
      })

      it('should disable TB for stateDiagram (default)', () => {
        expect(isDirectionDisabled('TB', null, 'stateDiagram')).toBe(true)
      })

      it('should disable LR for gitGraph (default)', () => {
        expect(isDirectionDisabled('LR', null, 'gitGraph')).toBe(true)
      })

      it('should enable non-default for gitGraph', () => {
        expect(isDirectionDisabled('TB', null, 'gitGraph')).toBe(false)
        expect(isDirectionDisabled('BT', null, 'gitGraph')).toBe(false)
      })
    })
  })

  describe('isDirectionActive', () => {
    it('should mark current direction as active', () => {
      expect(isDirectionActive('LR', 'LR', 'flowchart')).toBe(true)
    })

    it('should not mark other directions as active', () => {
      expect(isDirectionActive('TB', 'LR', 'flowchart')).toBe(false)
    })

    it('should mark default direction as active when no explicit direction', () => {
      expect(isDirectionActive('TB', null, 'flowchart')).toBe(true)
      expect(isDirectionActive('LR', null, 'gitGraph')).toBe(true)
    })

    it('should behave same as isDirectionDisabled', () => {
      // Active and disabled are coupled by design
      expect(isDirectionActive('LR', 'LR', 'flowchart')).toBe(
        isDirectionDisabled('LR', 'LR', 'flowchart')
      )
      expect(isDirectionActive('TB', null, 'flowchart')).toBe(
        isDirectionDisabled('TB', null, 'flowchart')
      )
    })
  })

  describe('usesDirectionStatement', () => {
    it('should return true for diagrams using direction statement', () => {
      expect(usesDirectionStatement('stateDiagram')).toBe(true)
      expect(usesDirectionStatement('classDiagram')).toBe(true)
      expect(usesDirectionStatement('erDiagram')).toBe(true)
      expect(usesDirectionStatement('requirementDiagram')).toBe(true)
    })

    it('should return false for flowchart/graph', () => {
      expect(usesDirectionStatement('flowchart')).toBe(false)
      expect(usesDirectionStatement('graph')).toBe(false)
    })

    it('should return false for gitGraph', () => {
      expect(usesDirectionStatement('gitGraph')).toBe(false)
    })

    it('should return false for null', () => {
      expect(usesDirectionStatement(null)).toBe(false)
    })
  })

  describe('usesColonSyntax', () => {
    it('should return true for gitGraph', () => {
      expect(usesColonSyntax('gitGraph')).toBe(true)
    })

    it('should return false for other diagram types', () => {
      expect(usesColonSyntax('flowchart')).toBe(false)
      expect(usesColonSyntax('stateDiagram')).toBe(false)
      expect(usesColonSyntax('classDiagram')).toBe(false)
    })

    it('should return false for null', () => {
      expect(usesColonSyntax(null)).toBe(false)
    })
  })
})
