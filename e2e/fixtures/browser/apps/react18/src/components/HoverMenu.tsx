// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useState } from 'react'

interface MenuItem {
  id: string
  label: string
}

interface HoverMenuProps {
  label: string
  items: MenuItem[]
}

/** Opens on hover only – there is no click or keyboard way in (025-UC-004). */
export function HoverMenu({ label, items }: HoverMenuProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="hover-menu" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className="hover-menu-trigger">{label}</span>
      {open && (
        <ul className="hover-menu-list">
          {items.map((item) => (
            <li key={item.id}>
              <a className="hover-menu-item" href={`#${item.id}`}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
