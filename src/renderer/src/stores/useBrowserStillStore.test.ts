// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it } from 'vitest'
import { useBrowserStillStore } from './useBrowserStillStore'

const image = { data: new Uint8Array(4), width: 1, height: 1 }

describe('useBrowserStillStore', () => {
  afterEach(() => {
    useBrowserStillStore.setState({ byTab: new Map() })
  })

  it('keeps one picture per tab and clears it', () => {
    const store = useBrowserStillStore.getState
    store().set('browser-tab-1', { image, source: 'pick' })
    store().set('browser-tab-2', { image, source: 'page' })
    expect(store().byTab.get('browser-tab-1')?.source).toBe('pick')
    store().clear('browser-tab-1')
    expect([...store().byTab.keys()]).toEqual(['browser-tab-2'])
  })

  it('leaves the state untouched when clearing a tab with no picture', () => {
    const before = useBrowserStillStore.getState().byTab
    useBrowserStillStore.getState().clear('browser-tab-9')
    expect(useBrowserStillStore.getState().byTab).toBe(before)
  })
})
