// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * FileService project-change notification tests (sd-074b §4.9).
 *
 * The HTML preview's main-side teardown seam accepted a `subscribeProjectChanged`
 * callback from the start but had no producer, so it never fired. This is that
 * producer: split into its own file because the mocks here are deliberately
 * minimal compared with the main FileService suite.
 */
import { describe, expect, it, vi } from 'vitest'
import { createFileService } from './FileService'

describe('FileService.onProjectPathChanged', () => {
  it('notifies subscribers with the previous and new path', () => {
    const service = createFileService()
    const listener = vi.fn()
    service.onProjectPathChanged(listener)

    service.setProjectPath('/projects/one')

    expect(listener).toHaveBeenCalledWith(null, '/projects/one')
  })

  it('reports the previous path on a switch', () => {
    const service = createFileService()
    service.setProjectPath('/projects/one')
    const listener = vi.fn()
    service.onProjectPathChanged(listener)

    service.setProjectPath('/projects/two')

    expect(listener).toHaveBeenCalledWith('/projects/one', '/projects/two')
  })

  it('stays silent when the path does not actually change', () => {
    const service = createFileService()
    service.setProjectPath('/projects/one')
    const listener = vi.fn()
    service.onProjectPathChanged(listener)

    service.setProjectPath('/projects/one')

    // Subscribers tear down per-project state, so a no-op set must not churn them.
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying after unsubscribe', () => {
    const service = createFileService()
    const listener = vi.fn()
    const unsubscribe = service.onProjectPathChanged(listener)

    unsubscribe()
    service.setProjectPath('/projects/one')

    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps notifying the other subscribers when one throws', () => {
    const service = createFileService()
    const thrower = vi.fn(() => {
      throw new Error('listener blew up')
    })
    const healthy = vi.fn()
    service.onProjectPathChanged(thrower)
    service.onProjectPathChanged(healthy)

    expect(() => service.setProjectPath('/projects/one')).not.toThrow()
    expect(healthy).toHaveBeenCalledTimes(1)
  })
})
