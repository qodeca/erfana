// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('The fixture page has no #root element')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
