// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import './ProjectTree.css'

interface DropIndicatorProps {
  depth: number
  indentationWidth?: number
}

/**
 * Visual indicator showing where item will be inserted during drag
 * Displays as a blue horizontal line
 */
export function DropIndicator({ depth, indentationWidth = 16 }: DropIndicatorProps) {
  const leftOffset = depth * indentationWidth + 8 // 8px base padding

  return (
    <div
      className="drop-indicator"
      style={{
        left: `${leftOffset}px`,
        right: '8px'
      }}
      aria-hidden="true"
    />
  )
}
