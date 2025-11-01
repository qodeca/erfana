import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { ProjectTree } from './ProjectTree'
import { DialogProvider } from '../Dialog'

declare global {
  interface Window {
    api: any
  }
}

describe('ProjectTree watcher start timing', () => {
  beforeEach(() => {
    ;(window as any).api = undefined
  })

  it('starts directory watcher after initial readDirectory completes', async () => {
    const calls: string[] = []
    const start = vi.fn(async () => { calls.push('start'); return { success: true } })
    const readDirectory = vi.fn(async () => { calls.push('readDirectory') ; return [] })
    const getLastProjectPath = vi.fn(async () => '/proj')

    ;(window as any).api = {
      file: {
        getLastProjectPath,
        readDirectory,
        onProjectChanged: (_cb: any) => { /* no-op; return unsub */ return () => {} },
        // Add missing methods from our refactoring
        moveItem: vi.fn(async () => ({ path: '/moved' })),
        copyItem: vi.fn(async () => ({ path: '/copied' }))
      },
      directoryWatch: {
        start,
        stop: vi.fn(async () => ({ success: true })),
        onDirectoryChanged: () => () => {},
        onProjectDeleted: () => () => {},
        onDirectoryError: () => () => {}
      }
    }

    render(
      <DialogProvider>
        <ProjectTree
          onFileSelect={() => {}}
          showControlPanel={false}
          filterMode={'all' as any}
          onFilterModeChange={() => {}}
        />
      </DialogProvider>
    )

    // wait a tick for effects
    await new Promise((r) => setTimeout(r, 0))

    // Ensure readDirectory was called before start
    const readIdx = calls.indexOf('readDirectory')
    const startIdx = calls.indexOf('start')
    expect(readIdx).toBeGreaterThanOrEqual(0)
    expect(startIdx).toBeGreaterThanOrEqual(0)
    expect(readIdx).toBeLessThan(startIdx)
  })
})
