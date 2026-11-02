// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { useState } from 'react'

import { ItemRow } from './ItemRow'

const ITEMS = [
  { name: 'Notebook', price: '4.50' },
  { name: 'Fountain pen', price: '18.00' },
  { name: 'Desk lamp', price: '32.90' },
  { name: 'Paper clips', price: '1.20' },
  { name: 'Stapler', price: '9.75' }
]

export function ItemList() {
  const [saved, setSaved] = useState<string | null>(null)
  return (
    <section className="item-list">
      <h2>Items</h2>
      <ul className="item-list-rows">
        {ITEMS.map((item) => (
          <ItemRow key={item.name} name={item.name} price={item.price} onSave={setSaved} />
        ))}
      </ul>
      <p className="item-list-status" role="status">
        {saved ? `Saved ${saved}` : 'Nothing saved yet'}
      </p>
    </section>
  )
}
