import { describe, it, expect, vi } from 'vitest'
import { showGlobalToast, subscribeGlobalToasts } from './toastService'

describe('ToastNotification', () => {
  it('dispatches and receives global toast events', () => {
    const handler = vi.fn()
    const unsubscribe = subscribeGlobalToasts(handler)

    const payload = { title: 'Hello', message: 'World', type: 'info' as const, duration: 500 }
    showGlobalToast(payload)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(payload)

    // Unsubscribe and ensure no more calls
    unsubscribe()
    showGlobalToast(payload)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
