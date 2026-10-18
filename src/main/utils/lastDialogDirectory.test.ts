// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { afterEach, describe, expect, it } from 'vitest'
import { join, resolve } from 'path'

import { rememberDialogResult, resetLastDialogDirectory, withLastDirectory } from './lastDialogDirectory'

const PROJECT = resolve('/work/project')

describe('lastDialogDirectory', () => {
  afterEach(() => resetLastDialogDirectory())

  it('leaves options unchanged before any dialog completed', () => {
    const options = { title: 'Export', defaultPath: 'report.pdf' }
    expect(withLastDirectory(options)).toBe(options)
    expect(withLastDirectory({ title: 'Open' })).toEqual({ title: 'Open' })
  })

  it('remembers the folder of a saved file and puts a bare name inside it', () => {
    rememberDialogResult(join(PROJECT, 'out', 'first.pdf'))
    expect(withLastDirectory({ defaultPath: 'second.pdf' })).toEqual({
      defaultPath: join(PROJECT, 'out', 'second.pdf')
    })
  })

  it('fills a missing defaultPath with the remembered folder', () => {
    rememberDialogResult([join(PROJECT, 'a.md'), join(PROJECT, 'b.md')])
    expect(withLastDirectory({ title: 'Add files' })).toEqual({ title: 'Add files', defaultPath: PROJECT })
    expect(withLastDirectory({ defaultPath: '' })).toEqual({ defaultPath: PROJECT })
  })

  it('remembers a picked folder as is for a directory dialog', () => {
    rememberDialogResult([PROJECT], true)
    expect(withLastDirectory({})).toEqual({ defaultPath: PROJECT })
  })

  it('keeps an absolute defaultPath the caller chose', () => {
    rememberDialogResult(join(PROJECT, 'x.pdf'))
    const chosen = resolve('/elsewhere/report.pdf')
    expect(withLastDirectory({ defaultPath: chosen })).toEqual({ defaultPath: chosen })
  })

  it('ignores a cancelled, empty or relative result', () => {
    rememberDialogResult(join(PROJECT, 'x.pdf'))
    rememberDialogResult(undefined)
    rememberDialogResult([])
    rememberDialogResult('')
    rememberDialogResult('relative/y.pdf')
    expect(withLastDirectory({})).toEqual({ defaultPath: PROJECT })
  })
})
