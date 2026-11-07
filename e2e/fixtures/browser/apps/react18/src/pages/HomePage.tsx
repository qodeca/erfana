// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { ItemList } from '../components/ItemList'
import { SignupForm } from '../components/SignupForm'
import { StatusCard } from '../components/StatusCard'

export function HomePage() {
  return (
    <div className="home-page">
      <div className="home-cards">
        <StatusCard title="Orders" value="128" actionLabel="View all pending orders" />
        <StatusCard title="Returns" value="7" actionLabel="Review returns" />
      </div>
      <ItemList />
      <SignupForm />
    </div>
  )
}
