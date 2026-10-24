// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { IpcMainInvokeEvent } from 'electron'
import type {
  ProjectSession,
  ProjectSessionSnapshot
} from '../../services/session/ProjectSession'

const listeners = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()

vi.mock('../registry', () => ({
  registerHandle: (channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
    listeners.set(channel, listener)
  }
}))

vi.mock('../../services/LoggingService', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { logger } from '../../services/LoggingService'
import { getConfinedChannels, registerConfinedHandle } from './registerConfinedHandle'

describe('registerConfinedHandle', () => {
  let base: string
  let root: string
  let outside: string
  let snapshot: ProjectSessionSnapshot | null
  let session: ProjectSession

  const event = (id = 1): IpcMainInvokeEvent => ({ sender: { id } }) as unknown as IpcMainInvokeEvent
  const call = (channel: string, ...args: unknown[]) => listeners.get(channel)!(event(), ...args)

  beforeAll(() => {
    base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'erfana-register-')))
    root = path.join(base, 'proj')
    outside = path.join(base, 'outside')
    mkdirSync(root)
    mkdirSync(outside)
    writeFileSync(path.join(root, 'a.md'), 'a')
    writeFileSync(path.join(outside, 'secret.md'), 's')
  })

  afterAll(() => {
    rmSync(base, { recursive: true, force: true })
  })

  beforeEach(() => {
    listeners.clear()
    vi.clearAllMocks()
    snapshot = {
      generation: 1,
      root,
      realRoot: root,
      caseSensitive: process.platform === 'linux',
      ownerWebContentsId: null
    }
    session = {
      current: () => snapshot,
      require: () => snapshot!,
      onChange: () => () => undefined
    }
  })

  it('lists the channels it registered', () => {
    registerConfinedHandle(
      'test:listed',
      { schema: z.tuple([z.string()]), paths: {}, handler: async () => true },
      session
    )
    expect(getConfinedChannels().has('test:listed')).toBe(true)
    expect(getConfinedChannels().has('test:not-registered')).toBe(false)
  })

  it('hands the handler the checked paths, never the raw ones', async () => {
    const handler = vi.fn(async (_ctx, _args, resolved) => resolved.filePath.real)
    registerConfinedHandle(
      'test:read',
      {
        schema: z.tuple([z.string()]),
        paths: { filePath: { arg: 0, mode: 'project' } },
        handler
      },
      session
    )
    await expect(call('test:read', path.join(root, 'a.md'))).resolves.toBe(path.join(root, 'a.md'))
    expect(handler.mock.calls[0][0]).toMatchObject({ session: snapshot })
  })

  it('refuses an outside path before the handler runs, and logs the code without the path', async () => {
    const handler = vi.fn(async () => true)
    registerConfinedHandle(
      'test:read',
      { schema: z.tuple([z.string()]), paths: { filePath: { arg: 0, mode: 'project' } }, handler },
      session
    )
    await expect(call('test:read', path.join(outside, 'secret.md'))).rejects.toThrow(
      'Cannot read files outside the project directory'
    )
    expect(handler).not.toHaveBeenCalled()
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls)
    expect(logged).toContain('OUTSIDE_PROJECT')
    expect(logged).not.toContain(outside)
  })

  it('logs a refusal at debug when the channel says refusals are routine (#71)', async () => {
    registerConfinedHandle(
      'test:quiet',
      {
        schema: z.tuple([z.string()]),
        paths: { filePath: { arg: 0, mode: 'project' } },
        refusalLogLevel: 'debug',
        onRefusal: () => 'refused',
        handler: async () => 'read'
      },
      session
    )
    await expect(call('test:quiet', path.join(outside, 'secret.md'))).resolves.toBe('refused')
    expect(logger.warn).not.toHaveBeenCalled()
    const logged = JSON.stringify(vi.mocked(logger.debug).mock.calls)
    expect(logged).toContain('OUTSIDE_PROJECT')
    expect(logged).not.toContain(outside)
  })

  it('with lexicalPrecheck, refuses a path outside the root before the file system is asked (#71)', async () => {
    const asked: string[] = []
    const record = <T,>(fn: (target: string) => Promise<T>) => async (target: string): Promise<T> => {
      asked.push(target)
      return fn(target)
    }
    const { lstat, stat, realpath } = await import('node:fs/promises')
    const handler = vi.fn(async () => 'read')
    registerConfinedHandle(
      'test:lexical',
      {
        schema: z.tuple([z.string()]),
        paths: { filePath: { arg: 0, mode: 'project', mustExist: true } },
        lexicalPrecheck: true,
        confinementDeps: {
          path,
          platform: process.platform,
          fs: { lstat: record(lstat), stat: record(stat), realpath: record<string>(realpath) }
        },
        onRefusal: (error) => error.code,
        handler
      },
      session
    )
    for (const target of [path.join(outside, 'secret.md'), path.join(root, '..', 'outside', 'secret.md')]) {
      await expect(call('test:lexical', target)).resolves.toBe('OUTSIDE_PROJECT')
    }
    expect(asked).toEqual([])
    expect(handler).not.toHaveBeenCalled()
    // Inside the root the full check still runs
    await expect(call('test:lexical', path.join(root, 'a.md'))).resolves.toBe('read')
    expect(asked.length).toBeGreaterThan(0)
  })

  it('checks every listed path argument', async () => {
    const handler = vi.fn(async () => true)
    registerConfinedHandle(
      'test:move',
      {
        schema: z.tuple([z.string(), z.string()]),
        paths: {
          from: { arg: 0, mode: 'project-entry' },
          to: { arg: 1, mode: 'project', mustExist: true }
        },
        handler
      },
      session
    )
    await expect(call('test:move', path.join(root, 'a.md'), outside)).rejects.toThrow('outside the project')
    await expect(call('test:move', path.join(outside, 'secret.md'), root)).rejects.toThrow('outside the project')
    expect(handler).not.toHaveBeenCalled()
    await expect(call('test:move', path.join(root, 'a.md'), root)).resolves.toBe(true)
  })

  it('refuses every project channel when no project is open', async () => {
    snapshot = null
    registerConfinedHandle(
      'test:read',
      {
        schema: z.tuple([z.string()]),
        paths: { filePath: { arg: 0, mode: 'project' } },
        handler: async () => true
      },
      session
    )
    await expect(call('test:read', path.join(root, 'a.md'))).rejects.toThrow('No project is open')
  })

  it('refuses a window that does not own the project', async () => {
    snapshot = { ...snapshot!, ownerWebContentsId: 7 }
    registerConfinedHandle(
      'test:read',
      {
        schema: z.tuple([z.string()]),
        paths: { filePath: { arg: 0, mode: 'project' } },
        handler: async () => true
      },
      session
    )
    await expect(listeners.get('test:read')!(event(8), path.join(root, 'a.md'))).rejects.toThrow(
      'does not own'
    )
    await expect(listeners.get('test:read')!(event(7), path.join(root, 'a.md'))).resolves.toBe(true)
  })

  it('rejects a payload that does not match the schema, with the schema message', async () => {
    const handler = vi.fn(async () => true)
    registerConfinedHandle(
      'test:read',
      {
        schema: z.tuple([z.string({ error: 'Invalid file path' })]),
        paths: { filePath: { arg: 0, mode: 'project' } },
        handler
      },
      session
    )
    await expect(call('test:read', 42)).rejects.toThrow('Invalid file path')
    await expect(call('test:read')).rejects.toThrow()
    await expect(call('test:read', path.join(root, 'a.md'), 'extra')).rejects.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })

  describe('staleCheck (row 24)', () => {
    it('refuses when the project changed while the handler ran', async () => {
      registerConfinedHandle(
        'test:walk',
        {
          schema: z.tuple([z.string()]),
          paths: { dirPath: { arg: 0, mode: 'project' } },
          staleCheck: 'after',
          handler: async () => {
            snapshot = { ...snapshot!, generation: 2 }
            return 'tree'
          }
        },
        session
      )
      await expect(call('test:walk', root)).rejects.toThrow('project changed')
    })

    it('refuses when the project was closed while the handler ran', async () => {
      registerConfinedHandle(
        'test:walk',
        {
          schema: z.tuple([z.string()]),
          paths: { dirPath: { arg: 0, mode: 'project' } },
          staleCheck: 'after',
          handler: async () => {
            snapshot = null
            return 'tree'
          }
        },
        session
      )
      await expect(call('test:walk', root)).rejects.toThrow('project changed')
    })

    it('answers normally when nothing changed, and when no stale check was asked for', async () => {
      registerConfinedHandle(
        'test:stable',
        {
          schema: z.tuple([z.string()]),
          paths: { dirPath: { arg: 0, mode: 'project' } },
          staleCheck: 'after',
          handler: async () => 'tree'
        },
        session
      )
      registerConfinedHandle(
        'test:unchecked',
        {
          schema: z.tuple([z.string()]),
          paths: { dirPath: { arg: 0, mode: 'project' } },
          handler: async () => {
            snapshot = { ...snapshot!, generation: 2 }
            return 'tree'
          }
        },
        session
      )
      await expect(call('test:stable', root)).resolves.toBe('tree')
      await expect(call('test:unchecked', root)).resolves.toBe('tree')
    })

    it('keeps the handler error when it failed while the project changed', async () => {
      const failure = new Error('read failed')
      registerConfinedHandle(
        'test:walk',
        {
          schema: z.tuple([z.string()]),
          paths: { dirPath: { arg: 0, mode: 'project' } },
          staleCheck: 'after',
          handler: async () => {
            snapshot = { ...snapshot!, generation: 2 }
            throw failure
          }
        },
        session
      )
      await expect(call('test:walk', root)).rejects.toBe(failure)
    })
  })

  describe('result-shaped channels', () => {
    it('answers a refusal with the onRefusal value instead of rejecting', async () => {
      registerConfinedHandle(
        'test:reveal',
        {
          schema: z.tuple([z.string()]),
          paths: { filePath: { arg: 0, mode: 'project' } },
          onRefusal: (error) => `refused:${error.code}`,
          handler: async () => ''
        },
        session
      )
      await expect(call('test:reveal', path.join(outside, 'secret.md'))).resolves.toBe('refused:OUTSIDE_PROJECT')
      await expect(call('test:reveal', 42)).resolves.toBe('refused:INVALID_PATH')
    })

    it('does not swallow an error the handler itself throws', async () => {
      const failure = new Error('boom')
      registerConfinedHandle(
        'test:reveal',
        {
          schema: z.tuple([z.string()]),
          paths: { filePath: { arg: 0, mode: 'project' } },
          onRefusal: () => 'refused',
          handler: async () => {
            throw failure
          }
        },
        session
      )
      await expect(call('test:reveal', path.join(root, 'a.md'))).rejects.toBe(failure)
    })

    it('a sender gate answers before anything about the path is learned', async () => {
      const handler = vi.fn(async () => 'ok')
      registerConfinedHandle(
        'test:reveal',
        {
          schema: z.tuple([z.string()]),
          paths: { filePath: { arg: 0, mode: 'project' } },
          senderGate: { allow: () => false, denied: () => '' },
          onRefusal: () => 'refused',
          handler
        },
        session
      )
      await expect(call('test:reveal', path.join(outside, 'secret.md'))).resolves.toBe('')
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('optional path arguments', () => {
    const register = (handler: ReturnType<typeof vi.fn>) =>
      registerConfinedHandle(
        'test:optional',
        {
          schema: z.tuple([z.string().optional()]),
          paths: {},
          optionalPaths: { dir: { arg: 0, mode: 'project', mustExist: true, kind: 'directory' } },
          handler
        },
        session
      )

    it('refuses a name listed as both required and optional', () => {
      expect(() =>
        registerConfinedHandle(
          'test:overlap',
          {
            schema: z.tuple([z.string().optional()]),
            paths: { dir: { arg: 0, mode: 'project' } },
            optionalPaths: { dir: { arg: 0, mode: 'project' } },
            handler: async () => true
          },
          session
        )
      ).toThrow(/both required and optional/)
      expect(getConfinedChannels().has('test:overlap')).toBe(false)
    })

    it('lists an optional path with the others', () => {
      register(vi.fn(async () => true))
      expect(getConfinedChannels().get('test:optional')).toEqual(['dir'])
    })

    it('skips the check when the argument is absent', async () => {
      const handler = vi.fn(async (_ctx, _args, resolved) => resolved.dir)
      register(handler)
      await expect(call('test:optional', undefined)).resolves.toBeUndefined()
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('checks the argument when it is present', async () => {
      const handler = vi.fn(async (_ctx, _args, resolved) => resolved.dir.real)
      register(handler)
      await expect(call('test:optional', root)).resolves.toBe(root)
      await expect(call('test:optional', outside)).rejects.toThrow('outside the project')
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('object payloads', () => {
    const request = z.strictObject({
      filePath: z.string(),
      generation: z.number().int().optional()
    })
    const register = (handler: ReturnType<typeof vi.fn>, channel = 'test:object') =>
      registerConfinedHandle(
        channel,
        {
          schema: z.tuple([request]),
          paths: { filePath: { arg: 0, key: 'filePath', mode: 'project' } },
          expectedGeneration: ([payload]) => payload.generation,
          handler
        },
        session
      )

    it('checks the path held in a key of the request object', async () => {
      const handler = vi.fn(async (_ctx, _args, resolved) => resolved.filePath.real)
      register(handler)
      await expect(call('test:object', { filePath: path.join(root, 'a.md') })).resolves.toBe(
        path.join(root, 'a.md')
      )
      await expect(call('test:object', { filePath: path.join(outside, 'secret.md') })).rejects.toThrow(
        'outside the project'
      )
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('refuses a key that is not in the schema before any path is checked', async () => {
      const handler = vi.fn(async () => true)
      register(handler)
      await expect(
        call('test:object', { filePath: path.join(root, 'a.md'), extra: true })
      ).rejects.toThrow('Unrecognized key')
      await expect(call('test:object', path.join(root, 'a.md'))).rejects.toThrow()
      expect(handler).not.toHaveBeenCalled()
    })

    it('runs when the generation is the open project’s, or none is named', async () => {
      const handler = vi.fn(async () => true)
      register(handler)
      await expect(call('test:object', { filePath: path.join(root, 'a.md'), generation: 1 })).resolves.toBe(true)
      await expect(call('test:object', { filePath: path.join(root, 'a.md') })).resolves.toBe(true)
      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('refuses with PROJECT_CHANGED when the generation differs, and never reaches the handler', async () => {
      const handler = vi.fn(async () => true)
      register(handler)
      snapshot = { ...snapshot!, generation: 2 }
      await expect(call('test:object', { filePath: path.join(root, 'a.md'), generation: 1 })).rejects.toThrow(
        'The project changed while the request was running'
      )
      expect(handler).not.toHaveBeenCalled()
      expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).toContain('PROJECT_CHANGED')
    })

    it('refuses with PROJECT_CHANGED when no project is open', async () => {
      const handler = vi.fn(async () => true)
      register(handler)
      snapshot = null
      await expect(call('test:object', { filePath: path.join(root, 'a.md'), generation: 1 })).rejects.toThrow(
        'The project changed while the request was running'
      )
      expect(handler).not.toHaveBeenCalled()
    })

    it('hands a refusal to onRefusal like any other', async () => {
      registerConfinedHandle(
        'test:object-result',
        {
          schema: z.tuple([request]),
          paths: { filePath: { arg: 0, key: 'filePath', mode: 'project' } },
          expectedGeneration: ([payload]) => payload.generation,
          onRefusal: (error) => error.code,
          handler: async () => 'ran'
        },
        session
      )
      snapshot = { ...snapshot!, generation: 5 }
      await expect(call('test:object-result', { filePath: path.join(root, 'a.md'), generation: 1 })).resolves.toBe(
        'PROJECT_CHANGED'
      )
    })
  })
})
