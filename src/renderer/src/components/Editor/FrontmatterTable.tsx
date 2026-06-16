// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import React, { useState } from 'react'
import type { FrontmatterData, FrontmatterValue } from '../../utils/frontmatterParser'
import { ChevronDown, ChevronRight } from 'lucide-react'

/** Maximum number of visible entries before showing "Show more" */
const MAX_VISIBLE_ENTRIES = 10

/** Maximum nesting depth for recursive rendering */
const MAX_NESTING_DEPTH = 3

interface FrontmatterTableProps {
  /** Parsed frontmatter data */
  data: FrontmatterData
  /** Starting line number for scroll sync */
  lineStart?: number
  /** Ending line number for scroll sync */
  lineEnd?: number
}

/**
 * Checks if a value is a plain object (not array, not null)
 */
function isPlainObject(value: FrontmatterValue): value is Record<string, FrontmatterValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Checks if an array contains only primitive values (no objects/arrays)
 */
function isSimpleArray(arr: FrontmatterValue[]): boolean {
  return arr.every(
    (item) => item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
  )
}

/**
 * Renders a primitive value with appropriate styling
 */
function PrimitiveValue({ value }: { value: FrontmatterValue }): React.ReactElement {
  if (value === null) {
    return <span className="frontmatter-null">null</span>
  }

  if (typeof value === 'boolean') {
    return <span className="frontmatter-boolean">{String(value)}</span>
  }

  if (typeof value === 'number') {
    return <span className="frontmatter-number">{value}</span>
  }

  return <span className="frontmatter-string">{String(value)}</span>
}

/**
 * Renders a simple array as inline badges/tags
 */
function SimpleArrayValue({ items }: { items: FrontmatterValue[] }): React.ReactElement {
  return (
    <span className="frontmatter-array-inline">
      {items.map((item, index) => (
        <span key={index} className="frontmatter-tag">
          <PrimitiveValue value={item} />
        </span>
      ))}
    </span>
  )
}

/**
 * Renders a complex array (with objects) as nested items
 */
function ComplexArrayValue({
  items,
  depth
}: {
  items: FrontmatterValue[]
  depth: number
}): React.ReactElement {
  return (
    <div className="frontmatter-array-complex">
      {items.map((item, index) => (
        <div key={index} className="frontmatter-array-item-complex">
          <span className="frontmatter-array-index">[{index}]</span>
          <ValueRenderer value={item} depth={depth} />
        </div>
      ))}
    </div>
  )
}

/**
 * Renders a nested object as indented key-value pairs
 */
function NestedObjectValue({
  obj,
  depth
}: {
  obj: Record<string, FrontmatterValue>
  depth: number
}): React.ReactElement {
  const entries = Object.entries(obj).filter(([, value]) => value !== undefined)

  return (
    <div className="frontmatter-nested">
      {entries.map(([key, value]) => (
        <div key={key} className="frontmatter-nested-row">
          <span className="frontmatter-nested-key">{key}:</span>
          <span className="frontmatter-nested-value">
            <ValueRenderer value={value} depth={depth} />
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Main value renderer that handles all types recursively
 */
function ValueRenderer({
  value,
  depth = 0
}: {
  value: FrontmatterValue
  depth?: number
}): React.ReactElement {
  // Primitive values
  if (value === null || typeof value !== 'object') {
    return <PrimitiveValue value={value} />
  }

  // Arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="frontmatter-empty">[]</span>
    }

    // Simple arrays render as inline tags
    if (isSimpleArray(value)) {
      return <SimpleArrayValue items={value} />
    }

    // Complex arrays (with objects) render nested, but respect depth limit
    if (depth >= MAX_NESTING_DEPTH) {
      return <span className="frontmatter-truncated">[{value.length} items...]</span>
    }

    return <ComplexArrayValue items={value} depth={depth + 1} />
  }

  // Objects
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined)

    if (entries.length === 0) {
      return <span className="frontmatter-empty">{'{}'}</span>
    }

    // Respect depth limit
    if (depth >= MAX_NESTING_DEPTH) {
      return <span className="frontmatter-truncated">{'{'}...{entries.length} keys{'}'}</span>
    }

    return <NestedObjectValue obj={value} depth={depth + 1} />
  }

  // Fallback (shouldn't reach here)
  return <span className="frontmatter-string">{String(value)}</span>
}

/**
 * Renders YAML frontmatter as a styled key-value table.
 * Supports recursive rendering of nested objects and arrays,
 * with collapsible section for large frontmatter.
 */
export function FrontmatterTable({
  data,
  lineStart = 1,
  lineEnd
}: FrontmatterTableProps): React.ReactElement | null {
  const entries = Object.entries(data).filter(([, value]) => value !== undefined)
  const [isExpanded, setIsExpanded] = useState(false)

  if (entries.length === 0) {
    return null
  }

  const hasMore = entries.length > MAX_VISIBLE_ENTRIES
  const visibleEntries = hasMore && !isExpanded ? entries.slice(0, MAX_VISIBLE_ENTRIES) : entries
  const hiddenCount = entries.length - MAX_VISIBLE_ENTRIES

  return (
    <div
      className="frontmatter-wrapper"
      data-line-start={lineStart}
      data-line-end={lineEnd ?? lineStart}
    >
      <div className="frontmatter-header">
        <span className="frontmatter-label">Frontmatter</span>
        <span className="frontmatter-count">{entries.length} {entries.length === 1 ? 'field' : 'fields'}</span>
      </div>
      <table className="frontmatter-table">
        <tbody>
          {visibleEntries.map(([key, value]) => (
            <tr key={key} className="frontmatter-row">
              <td className="frontmatter-key">{key}</td>
              <td className="frontmatter-value">
                <ValueRenderer value={value} depth={0} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && (
        <button
          className="frontmatter-expand-btn"
          onClick={() => setIsExpanded(!isExpanded)}
          type="button"
        >
          {isExpanded ? (
            <>
              <ChevronDown size={14} />
              <span>Show less</span>
            </>
          ) : (
            <>
              <ChevronRight size={14} />
              <span>Show {hiddenCount} more {hiddenCount === 1 ? 'field' : 'fields'}</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}

interface FrontmatterCodeBlockProps {
  /** Raw YAML content */
  rawYaml: string
  /** Starting line number for scroll sync */
  lineStart?: number
  /** Ending line number for scroll sync */
  lineEnd?: number
}

/**
 * Renders invalid frontmatter as a code block with error indicator.
 * Used as fallback when YAML parsing fails.
 */
export function FrontmatterCodeBlock({
  rawYaml,
  lineStart = 1,
  lineEnd
}: FrontmatterCodeBlockProps): React.ReactElement {
  return (
    <div
      className="frontmatter-error-wrapper"
      data-line-start={lineStart}
      data-line-end={lineEnd ?? lineStart}
    >
      <div className="frontmatter-error-header">
        <span className="frontmatter-error-label">Invalid frontmatter</span>
      </div>
      <pre className="frontmatter-error-code">
        <code>{rawYaml}</code>
      </pre>
    </div>
  )
}
