// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The file channels check their paths against the open project in the main
 * process. This drives the real bridge (`window.api.file`) from the renderer
 * with paths outside the project and with a link inside the project that leads
 * out, and asserts each call is refused and the outside folder is untouched.
 * An ordinary in-project call still works.
 *
 * Condition-based waits only.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { test, expect } from './fixtures/index'

const REFUSAL = 'outside the project directory'

test.use({
  testProjectFiles: {
    'notes/inside.md': '# Inside\n'
  }
})

test.describe('File channels check paths against the open project', () => {
  let outside: string

  test.beforeEach(async () => {
    outside = await mkdtemp(join(tmpdir(), 'erfana-e2e-outside-'))
    await mkdir(join(outside, 'folder'))
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await writeFile(join(outside, 'folder', 'keep.txt'), 'keep')
  })

  test.afterEach(async () => {
    await rm(outside, { recursive: true, force: true })
  })

  /** Calls one bridge method in the renderer and returns the rejection message, or null. */
  const refusal = async (
    page: import('@playwright/test').Page,
    method: string,
    args: unknown[]
  ): Promise<string | null> =>
    page.evaluate(
      async ([name, params]) => {
        try {
          const file = (window as unknown as { api: { file: Record<string, (...a: unknown[]) => Promise<unknown>> } })
            .api.file
          await file[name as string](...(params as unknown[]))
          return null
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      },
      [method, args] as const
    )

  const untouched = async (): Promise<void> => {
    expect((await readdir(outside)).sort()).toEqual(['folder', 'secret.txt'])
    expect(await readFile(join(outside, 'secret.txt'), 'utf-8')).toBe('secret')
    expect(await readdir(join(outside, 'folder'))).toEqual(['keep.txt'])
  }

  test('paths outside the project are refused and nothing outside changes', async ({
    windowWithTestProject: page
  }) => {
    const calls: Array<[string, unknown[]]> = [
      ['writeFile', [join(outside, 'secret.txt'), 'changed']],
      ['writeFile', [join(outside, 'new.md'), 'x']],
      ['readDirectory', [outside]],
      ['readFile', [join(outside, 'secret.txt')]],
      ['createFile', [outside, 'created']],
      ['createFolder', [outside, 'created']],
      ['deleteFile', [join(outside, 'secret.txt')]],
      ['deleteFolder', [join(outside, 'folder')]],
      ['rename', [join(outside, 'secret.txt'), 'renamed']],
      ['checkConflict', [outside, 'secret.txt']]
    ]
    for (const [method, args] of calls) {
      expect(await refusal(page, method, args), method).toContain(REFUSAL)
    }
    await untouched()
  })

  test('a link inside the project that leads outside is refused for writes as well as reads', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    test.skip(process.platform === 'win32', 'creating a link needs elevated rights on Windows')
    await symlink(outside, join(testProject.path, 'linked'))

    expect(await refusal(page, 'writeFile', [join(testProject.path, 'linked', 'new.md'), 'x'])).toContain(REFUSAL)
    expect(await refusal(page, 'createFile', [join(testProject.path, 'linked'), 'created'])).toContain(REFUSAL)
    expect(await refusal(page, 'readDirectory', [join(testProject.path, 'linked')])).toContain(REFUSAL)
    expect(await refusal(page, 'copyItem', [join(testProject.path, 'notes', 'inside.md'), join(testProject.path, 'linked')])).toContain(REFUSAL)
    await untouched()
  })

  test('a path inside the project still works', async ({
    windowWithTestProject: page,
    testProject
  }) => {
    const target = join(testProject.path, 'notes', 'inside.md')
    expect(await refusal(page, 'writeFile', [target, '# Changed\n'])).toBeNull()
    await expect.poll(() => readFile(target, 'utf-8')).toBe('# Changed\n')
    expect(await refusal(page, 'createFile', [join(testProject.path, 'notes'), 'second'])).toBeNull()
    await expect.poll(async () => (await readdir(join(testProject.path, 'notes'))).sort()).toEqual([
      'inside.md',
      'second.md'
    ])
  })
})
