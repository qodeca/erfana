// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { Header } from './components/Header'
import { HomePage } from './pages/HomePage'
import { InjectPage } from './pages/InjectPage'
import { InspectorPage } from './pages/InspectorPage'

type PageName = 'home' | 'inspector' | 'inject'

/** The page comes from `?page=`, so every page has its own address and no router is needed. */
function currentPage(): PageName {
  const page = new URLSearchParams(window.location.search).get('page')
  return page === 'inspector' || page === 'inject' ? page : 'home'
}

export function App() {
  const page = currentPage()
  return (
    <div className="app">
      <Header />
      <main className="app-main">
        {page === 'home' && <HomePage />}
        {page === 'inspector' && <InspectorPage />}
        {page === 'inject' && <InjectPage />}
      </main>
    </div>
  )
}
