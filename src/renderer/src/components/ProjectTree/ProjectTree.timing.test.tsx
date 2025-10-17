import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { ProjectTree } from './ProjectTree'

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
    const start = vi.fn(async () => { calls.push('start') })
    const readDirectory = vi.fn(async () => { calls.push('readDirectory') ; return [] })
    const getLastProjectPath = vi.fn(async () => '/proj')

    ;(window as any).api = {
      file: { getLastProjectPath, readDirectory, onProjectChanged: (_cb: any) => { /* no-op; return unsub */ return () => {} } },
      directoryWatch: {
        start,
        stop: vi.fn(async () => {}),
        onDirectoryChanged: () => () => {},
        onProjectDeleted: () => () => {},
        onDirectoryError: () => () => {}
      }
    }

    render(
      <ProjectTree
        onFileSelect={() => {}}
        showControlPanel={false}
        filterMode={'all' as any}
        onFilterModeChange={() => {}}
      />
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
