// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import './Toolbar.css'

export function Toolbar() {
  return (
    <div className="toolbar">
      <div className="toolbar-section toolbar-left">
        <div className="toolbar-title">ERFANA</div>
      </div>

      <div className="toolbar-section toolbar-center">
        {/* Future: breadcrumbs or file path */}
      </div>

      <div className="toolbar-section toolbar-right">
        {/* Future: additional controls */}
      </div>
    </div>
  )
}
