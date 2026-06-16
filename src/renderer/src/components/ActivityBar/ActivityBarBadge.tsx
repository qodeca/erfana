// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
interface ActivityBarBadgeProps {
  value: number | string
}

export function ActivityBarBadge({ value }: ActivityBarBadgeProps) {
  // Format badge display
  const displayValue = typeof value === 'number' && value > 99 ? '99+' : String(value)

  return (
    <div className="activity-bar-badge" title={`${value}`}>
      {displayValue}
    </div>
  )
}
