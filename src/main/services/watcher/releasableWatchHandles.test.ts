// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2026 Qodeca sp. z o.o.
/**
 * ReleasableWatchHandles (#486): a release closes the real handles strictly
 * below a folder and opens them again when it ends; a folder gone by then
 * stays closed quietly; one still there is reported as lost events. Over a
 * fake `fs.watch` – the real one on Windows is in `entryProbe.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import path from 'path'
import { ReleasableWatchHandles } from './releasableWatchHandles'
import type { NativeFsWatch, NativeWatchListener } from './NativeRecursiveWatcher'

const ROOT = path.resolve('/proj')
const at = (...segments: string[]): string => path.join(ROOT, ...segments)
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

function fakeFs() {
  const open = new Set<string>()
  const opens: string[] = []
  let failNext: NodeJS.ErrnoException | null = null
  const errorListeners = new Map<string, (error: Error) => void>()
  const fsWatch: NativeFsWatch = (target) => {
    if (failNext) {
      const failure = failNext
      failNext = null
      throw failure
    }
    open.add(target)
    opens.push(target)
    return {
      close: () => open.delete(target),
      on: (_event: 'error', listener: (error: Error) => void) => errorListeners.set(target, listener)
    }
  }
  return {
    fsWatch,
    open,
    opens,
    errorListeners,
    failNextWith: (code: string) => {
      failNext = errno(code)
    }
  }
}

function watchAll(handles: ReleasableWatchHandles, paths: string[]) {
  const listeners = new Map<string, ReturnType<typeof vi.fn<NativeWatchListener>>>()
  const errors = new Map<string, Error[]>()
  for (const target of paths) {
    const listener = vi.fn<NativeWatchListener>()
    listeners.set(target, listener)
    errors.set(target, [])
    handles.fsWatch(target, { recursive: false, persistent: true }, listener).on('error', (e) => errors.get(target)!.push(e))
  }
  return { listeners, errors }
}

describe('ReleasableWatchHandles (#486)', () => {
  it('closes only the real handles strictly below the folder, and opens them again with a lost-events signal', () => {
    const fs = fakeFs()
    const handles = new ReleasableWatchHandles(fs.fsWatch)
    const { listeners } = watchAll(handles, [ROOT, at('docs'), at('docs', 'deep'), at('docs', 'x', 'y'), at('docs2')])

    const end = handles.releaseBelow(at('docs'), true)
    expect([...fs.open].sort()).toEqual([ROOT, at('docs'), at('docs2')].sort())
    expect(handles.openBelow(at('docs'), true)).toBe(0)

    end()
    expect(fs.open.size).toBe(5)
    expect(handles.openBelow(at('docs'), true)).toBe(2)
    expect(listeners.get(at('docs', 'deep'))).toHaveBeenCalledWith('rename', null)
    expect(listeners.get(at('docs'))).not.toHaveBeenCalled()
    end() // a second call is a no-op
    expect(fs.opens).toHaveLength(7)
  })

  it('compares by the case rule it is given', () => {
    const fs = fakeFs()
    const handles = new ReleasableWatchHandles(fs.fsWatch)
    watchAll(handles, [at('Docs', 'Deep')])
    handles.releaseBelow(at('DOCS'), true)
    expect(fs.open.size).toBe(1)
    handles.releaseBelow(at('DOCS'), false)
    expect(fs.open.size).toBe(0)
  })

  it('a folder gone when the release ends stays closed, with no error and no signal', () => {
    const fs = fakeFs()
    const handles = new ReleasableWatchHandles(fs.fsWatch)
    const { listeners, errors } = watchAll(handles, [at('docs', 'deep')])
    const end = handles.releaseBelow(at('docs'), true)

    fs.failNextWith('ENOENT')
    end()
    expect(fs.open.size).toBe(0)
    expect(errors.get(at('docs', 'deep'))).toEqual([])
    expect(listeners.get(at('docs', 'deep'))).not.toHaveBeenCalled()
  })

  it('any other failure to open again reaches the watcher as the handle’s error', () => {
    const fs = fakeFs()
    const handles = new ReleasableWatchHandles(fs.fsWatch)
    const { errors } = watchAll(handles, [at('docs', 'deep')])
    const end = handles.releaseBelow(at('docs'), true)

    fs.failNextWith('EPERM')
    end()
    expect(errors.get(at('docs', 'deep'))?.map((e) => (e as NodeJS.ErrnoException).code)).toEqual(['EPERM'])
  })

  it('forwards a real handle’s error', () => {
    const fs = fakeFs()
    const handles = new ReleasableWatchHandles(fs.fsWatch)
    const { errors } = watchAll(handles, [at('docs')])
    fs.errorListeners.get(at('docs'))!(errno('EIO'))
    expect(errors.get(at('docs'))).toHaveLength(1)
  })

  it('a handle asked for under a release opens only when the release ends', () => {
    const fs = fakeFs()
    const handles = new ReleasableWatchHandles(fs.fsWatch)
    const end = handles.releaseBelow(at('docs'), true)
    watchAll(handles, [at('docs', 'new')])
    expect(fs.open.size).toBe(0)
    end()
    expect([...fs.open]).toEqual([at('docs', 'new')])
  })

  it('overlapping releases: a handle opens again only after the last one ends', () => {
    const fs = fakeFs()
    const handles = new ReleasableWatchHandles(fs.fsWatch)
    watchAll(handles, [at('docs', 'deep', 'x')])
    const outer = handles.releaseBelow(at('docs'), true)
    const inner = handles.releaseBelow(at('docs', 'deep'), true)
    outer()
    expect(fs.open.size).toBe(0)
    inner()
    expect(fs.open.size).toBe(1)
  })

  it('a handle the watcher closes during a release is not opened again', () => {
    const fs = fakeFs()
    const handles = new ReleasableWatchHandles(fs.fsWatch)
    const handle = handles.fsWatch(at('docs', 'deep'), { recursive: true, persistent: true }, vi.fn())
    const end = handles.releaseBelow(at('docs'), true)
    handle.close()
    end()
    expect(fs.open.size).toBe(0)
    expect(fs.opens).toHaveLength(1)
  })

  it('a handle that cannot open throws as fs.watch does, and is not kept', () => {
    const fs = fakeFs()
    const handles = new ReleasableWatchHandles(fs.fsWatch)
    fs.failNextWith('ENOENT')
    expect(() => handles.fsWatch(at('docs'), { recursive: true, persistent: true }, vi.fn())).toThrow('ENOENT')
    expect(handles.openBelow(ROOT, true)).toBe(0)
  })
})
