// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
interface ItemRowProps {
  name: string
  price: string
  onSave: (name: string) => void
}

export function ItemRow({ name, price, onSave }: ItemRowProps) {
  return (
    <li className="item-row">
      <span className="item-name">{name}</span>
      <span className="item-price">{price}</span>
      <div className="item-actions">
        <button className="save-button" type="button" onClick={() => onSave(name)}>
          <span className="save-label">Save</span>
        </button>
      </div>
    </li>
  )
}
