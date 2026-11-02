// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockShell } = vi.hoisted(() => ({
  mockShell: { openExternal: vi.fn() }
}))

vi.mock('electron', () => ({ shell: mockShell }))
vi.mock('../services/LoggingService', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { applyWebContentsBaseline, registerWebContentsBaseline } from './webContentsBaseline'
import type { BaselineTarget } from './webContentsBaseline'

type OpenHandler = Parameters<BaselineTarget['setWindowOpenHandler']>[0]
type NavListener = Parameters<BaselineTarget['on']>[1]

function makeTarget(currentUrl = 'file:///app/index.html'): {
  target: BaselineTarget
  open: () => OpenHandler
  navigate: () => NavListener
} {
  let openHandler: OpenHandler | undefined
  let navListener: NavListener | undefined
  const target: BaselineTarget = {
    setWindowOpenHandler: (handler) => {
      openHandler = handler
    },
    on: (_event, listener) => {
      navListener = listener
    },
    getURL: () => currentUrl
  }
  return { target, open: () => openHandler!, navigate: () => navListener! }
}

describe('web contents baseline: window open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShell.openExternal.mockResolvedValue(undefined)
  })

  it.each([
    ['https://example.com/'],
    ['mailto:a@example.com'],
    ['file:///etc/hosts'],
    ['file://host/share/x'],
    ['\\\\host\\share'],
    ['javascript:alert(1)'],
    ['x-custom-scheme://thing']
  ])('denies the window and opens nothing for %s', (url) => {
    const { target, open } = makeTarget()
    applyWebContentsBaseline(target)
    expect(open()({ url })).toEqual({ action: 'deny' })
    expect(mockShell.openExternal).not.toHaveBeenCalled()
  })
})

describe('web contents baseline: navigation', () => {
  it('cancels a navigation away from the current document', () => {
    const { target, navigate } = makeTarget('file:///app/index.html')
    applyWebContentsBaseline(target)
    const event = { preventDefault: vi.fn() }
    navigate()(event, 'https://example.com/')
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('lets a same-document fragment move through', () => {
    const { target, navigate } = makeTarget('file:///app/index.html')
    applyWebContentsBaseline(target)
    const event = { preventDefault: vi.fn() }
    navigate()(event, 'file:///app/index.html#section')
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})

describe('registerWebContentsBaseline', () => {
  it('applies the baseline to every created webContents', () => {
    let listener: ((e: unknown, wc: unknown) => void) | undefined
    registerWebContentsBaseline({
      on: (_event, l) => {
        listener = l as typeof listener
      }
    })
    const { target, open } = makeTarget()
    listener!({}, target)
    expect(open()({ url: 'file:///etc/hosts' })).toEqual({ action: 'deny' })
  })
})

describe('registerWebContentsBaseline with a gate (spec 025, ADR 0009 decision 5)', () => {
  function created(): {
    emit: (wc: BaselineTarget) => void
    gate: { classify: ReturnType<typeof vi.fn>; refuse: ReturnType<typeof vi.fn> }
  } {
    let listener: ((e: unknown, wc: BaselineTarget) => void) | undefined
    const gate = { classify: vi.fn(), refuse: vi.fn() }
    registerWebContentsBaseline<BaselineTarget>(
      { on: (_event, l) => (listener = l) },
      gate
    )
    return { emit: (wc) => listener!({}, wc), gate }
  }

  it('applies the baseline when the gate says so', () => {
    const { emit, gate } = created()
    gate.classify.mockReturnValue('baseline')
    const { target, open } = makeTarget()
    emit(target)
    expect(open()({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
    expect(gate.refuse).not.toHaveBeenCalled()
  })

  it('skips the baseline for an exempt webContents', () => {
    const { emit, gate } = created()
    gate.classify.mockReturnValue('exempt')
    const { target, open } = makeTarget()
    emit(target)
    expect(open()).toBeUndefined()
  })

  it('applies the baseline and then refuses a refused webContents', () => {
    const { emit, gate } = created()
    gate.classify.mockReturnValue('refused')
    const { target, open } = makeTarget()
    gate.refuse.mockImplementation(() => {
      // The baseline is already in place when the refusal runs
      expect(open()({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
    })
    emit(target)
    expect(gate.refuse).toHaveBeenCalledWith(target)
  })
})
