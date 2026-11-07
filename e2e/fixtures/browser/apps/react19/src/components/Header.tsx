// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { HoverMenu } from './HoverMenu'

const PRODUCT_LINKS = [
  { id: 'reports', label: 'Reports' },
  { id: 'billing', label: 'Billing' },
  { id: 'settings', label: 'Settings' }
]

export function Header() {
  return (
    <header className="app-header">
      <a className="brand" href="?page=home">
        Fixture shop
      </a>
      <nav className="app-nav" aria-label="Main">
        <HoverMenu label="Products" items={PRODUCT_LINKS} />
        <a href="?page=inspector">Inspector page</a>
        <a href="?page=inject">Hostile page</a>
      </nav>
    </header>
  )
}
