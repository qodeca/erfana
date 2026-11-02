// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
interface StatusCardProps {
  title: string
  value: string
  actionLabel: string
}

/** The action button is too narrow for its label, so the label is cut off – a typical "fix this" pick. */
export function StatusCard({ title, value, actionLabel }: StatusCardProps) {
  return (
    <section className="status-card">
      <h2 className="status-card-title">{title}</h2>
      <p className="status-card-value">{value}</p>
      <button className="status-card-action" type="button">
        {actionLabel}
      </button>
    </section>
  )
}
