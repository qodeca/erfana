// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { describe, expect, it } from 'vitest'
import {
  downloadDoneTitle,
  downloadFailedText,
  downloadFailedTitle,
  downloadFailureMessage,
  executableWarningMessage,
  EXECUTABLE_WARNING_TITLE
} from './downloadNotice'

describe('download notice words (025-FR-020)', () => {
  it('names the file in both titles', () => {
    expect(downloadDoneTitle('a.pdf')).toBe('Downloaded a.pdf')
    expect(downloadFailedTitle('a.pdf')).toBe('Couldn’t download a.pdf')
  })

  it.each([
    ['interrupted', 'The download was interrupted. The partial file was deleted.'],
    ['folderNotWritable', 'Erfana can’t write to that folder. The partial file was deleted.'],
    ['diskFull', 'The disk is full. The partial file was deleted.'],
    ['refusedFolder', 'Erfana doesn’t save downloads inside a .erfana folder.']
  ] as const)('gives the reason for %s, and says a started file is gone', (reason, message) => {
    expect(downloadFailureMessage(reason)).toBe(message)
    expect(downloadFailedText('a.pdf', reason)).toBe(`Couldn’t download a.pdf. ${message}`)
  })

  it('warns that an executable can run programs, naming it', () => {
    expect(EXECUTABLE_WARNING_TITLE).toBe('This file can run programs on your computer')
    expect(executableWarningMessage('setup.exe')).toMatch(/^setup\.exe can run programs on your computer\./)
  })
})
