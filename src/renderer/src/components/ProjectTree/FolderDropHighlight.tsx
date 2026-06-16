// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import './ProjectTree.css'

interface FolderDropHighlightProps {
  targetPath: string
}

/**
 * Visual highlight for folders during "move into" operations
 * Renders nothing - styling applied via CSS class on parent
 * This component exists to signal the highlight state
 */
export function FolderDropHighlight(_props: FolderDropHighlightProps) {
  // This component doesn't render anything itself
  // The highlight is applied via CSS class on the folder node
  // We keep this component for future enhancements (e.g., portal-based overlay)
  return null
}
