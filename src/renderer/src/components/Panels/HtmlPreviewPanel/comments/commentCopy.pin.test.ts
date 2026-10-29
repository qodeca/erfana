// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Every string `commentCopy.ts` can produce (spec 024, 024-FR-020;
 * architecture note specs/spec-t3-024-unified-comments/architecture/001-shared-comment-base.md
 * § 6 commit 4, § 8 C26).
 *
 * CHARACTERISATION PIN. Each exported string, each string in an exported
 * table, and each exported function called with fixed arguments – on both
 * platforms – is snapshotted under its export name. Update the snapshot only
 * in a `feat:` commit that names the C-xx or OD-xx it serves (024-FR-007 and
 * C-03 will reword some of these); a `refactor:` commit that moves the module
 * must leave it unchanged.
 *
 * A new export fails PIN-C-012 until it is added to the table below, so no
 * string escapes the pin.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '../../../../../../shared/errors'
import {
  CommentSaveOpSchema,
  CommentUnavailableReasonSchema,
  type CommentSaveRequest,
  type CommentUnavailableReason
} from '../../../../../../shared/ipc/preview-comment-schema'

const platform = vi.hoisted(() => ({ mac: false }))
vi.mock('../../../../utils/platform', () => ({
  isMacOS: () => platform.mac,
  isWindows: () => !platform.mac
}))

import * as copy from './commentCopy'

const FILE = 'index.html'

/** The comment error codes main can name, plus one a later main might add. */
const SAVE_CODES = [
  ...Object.values(ErrorCode).filter(code => code.startsWith('COMMENT_')),
  'COMMENT_FROM_A_LATER_MAIN',
  'NOT_A_COMMENT_CODE'
]

/** Every reason `readOnlyReasonText` words, a missing one and an unknown one. */
const READ_ONLY_REASONS = [
  'encoding',
  'conflict-markers',
  'too-large',
  'too-many-blocks',
  'unterminated-block',
  'link',
  'missing',
  undefined,
  'from-a-later-main'
]

/** A save request with only what `writtenAnnouncement` reads. */
const save = (op: string, status?: 'open' | 'resolved'): CommentSaveRequest =>
  ({ op, ...(status ? { status } : {}) }) as unknown as CommentSaveRequest

/**
 * How each exported function is called. Keys must equal the module's function
 * exports exactly (PIN-C-012); each entry lists named calls.
 */
const CALLS: Record<string, () => Record<string, string | copy.SaveFailureCopy>> = {
  commentModeShortcutLabel: () => ({ '()': copy.commentModeShortcutLabel() }),
  commentModeAriaShortcut: () => ({ '()': copy.commentModeAriaShortcut() }),
  saveShortcutLabel: () => ({ '()': copy.saveShortcutLabel() }),
  saveShortcutAria: () => ({ '()': copy.saveShortcutAria() }),
  unavailableTooltip: () =>
    Object.fromEntries(
      [...CommentUnavailableReasonSchema.options, 'from-a-later-main'].map(reason => [
        reason,
        copy.unavailableTooltip(reason as CommentUnavailableReason)
      ])
    ),
  readOnlyReasonText: () =>
    Object.fromEntries(READ_ONLY_REASONS.map(reason => [String(reason), copy.readOnlyReasonText(reason, FILE)])),
  fillFile: () => ({
    twice: copy.fillFile('{file} and {file} again.', FILE),
    none: copy.fillFile('No placeholder.', FILE)
  }),
  saveFailureCopy: () => Object.fromEntries(SAVE_CODES.map(code => [code, copy.saveFailureCopy(code, FILE)])),
  unsavedSourceText: () => ({ [FILE]: copy.unsavedSourceText(FILE) }),
  unsavedConflictText: () => ({ [FILE]: copy.unsavedConflictText(FILE) }),
  fieldHint: () => ({ [FILE]: copy.fieldHint(FILE) }),
  tooLongText: () => ({ '4001': copy.tooLongText(4001), '12345': copy.tooLongText(12_345) }),
  savedAnnouncement: () => ({ [FILE]: copy.savedAnnouncement(FILE) }),
  threadsTitle: () => ({
    one: copy.threadsTitle('button#buy.cta', 1),
    two: copy.threadsTitle('button#buy.cta', 2),
    zero: copy.threadsTitle('button#buy.cta', 0)
  }),
  deleteCommentText: () => ({ [FILE]: copy.deleteCommentText(FILE) }),
  deleteThreadText: () => ({ '0': copy.deleteThreadText(0), '1': copy.deleteThreadText(1), '2': copy.deleteThreadText(2) }),
  deleteBlockText: () => ({ [FILE]: copy.deleteBlockText(FILE) }),
  notFoundText: () => ({ 'line 42': copy.notFoundText(FILE, 42) }),
  scriptBuiltText: () => ({ '<section>': copy.scriptBuiltText('<section>') }),
  frameFileText: () => ({ 'frame.html': copy.frameFileText('frame.html') }),
  readErrorText: () => ({ [FILE]: copy.readErrorText(FILE) }),
  unreadFilesText: () => ({ '1': copy.unreadFilesText(1), '3': copy.unreadFilesText(3) }),
  inFrameTag: () => ({ 'frame.html': copy.inFrameTag('frame.html') }),
  modeTooltip: () => ({ on: copy.modeTooltip(true), off: copy.modeTooltip(false) }),
  listButtonName: () => ({
    'none yet': copy.listButtonName(0, 0),
    'none open': copy.listButtonName(0, 0, 2),
    'open only': copy.listButtonName(3, 0),
    'one needs': copy.listButtonName(3, 1),
    'two need': copy.listButtonName(3, 2),
    'attention only': copy.listButtonName(0, 1)
  }),
  writtenAnnouncement: () => ({
    ...Object.fromEntries(
      CommentSaveOpSchema.options.filter(op => op !== 'setStatus').map(op => [op, copy.writtenAnnouncement(save(op), FILE)])
    ),
    'setStatus resolved': copy.writtenAnnouncement(save('setStatus', 'resolved'), FILE),
    'setStatus open': copy.writtenAnnouncement(save('setStatus', 'open'), FILE)
  })
}

/** A string table's entries; a function entry is called with fixed arguments. */
function tableStrings(table: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === 'string') out[key] = value
    else if (key === 'deleted') out[key] = copy.ANNOUNCE.deleted(FILE)
    else if (key === 'pickerShowing') {
      out[`${key} (tag)`] = copy.ANNOUNCE.pickerShowing({ tag: 'section', line: 12 })
      out[`${key} (no tag)`] = copy.ANNOUNCE.pickerShowing({ line: 12 })
      out[`${key} (added)`] = copy.ANNOUNCE.pickerShowing({ tag: 'section', line: 12, added: true })
      out[`${key} (added, no tag)`] = copy.ANNOUNCE.pickerShowing({ line: 12, added: true })
    } else throw new Error(`commentCopy: no fixed call for table entry ${key}`)
  }
  return out
}

/** Every string the module produces, on the current platform. */
function everyString(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const name of Object.keys(copy).sort()) {
    const value = (copy as Record<string, unknown>)[name]
    if (typeof value === 'string') out[name] = value
    else if (typeof value === 'function') out[name] = CALLS[name]()
    else out[name] = tableStrings(value as Record<string, unknown>)
  }
  return out
}

describe('commentCopy strings (characterisation)', () => {
  beforeEach(() => {
    platform.mac = false
  })

  it('PIN-C-010 every string on Windows and Linux', () => {
    expect(everyString()).toMatchSnapshot()
  })

  it('PIN-C-011 every string on macOS', () => {
    platform.mac = true
    expect(everyString()).toMatchSnapshot()
  })

  it('PIN-C-012 the pin covers every export: each function has its fixed calls, nothing else is unknown', () => {
    const exports = Object.entries(copy as Record<string, unknown>)
    const functions = exports.filter(([, value]) => typeof value === 'function').map(([name]) => name)
    expect(functions.sort()).toEqual(Object.keys(CALLS).sort())
    for (const [name, value] of exports) {
      expect(['string', 'function', 'object'], name).toContain(typeof value)
    }
  })
})
