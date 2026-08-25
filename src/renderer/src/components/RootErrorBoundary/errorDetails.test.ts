// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Tests for the crash-detail extraction helpers.
 *
 * These run on the one path where nothing else can be trusted, so the bar is
 * "never throws, for any input" rather than "produces pretty output".
 *
 * @see docs/design/design-issue-60.md §5 (`errorDetails.ts` row)
 */

import { describe, expect, it } from 'vitest'
import {
  APP_VERSION,
  buildErrorDetails,
  buildLogContext,
  ELISION_MARKER_SUFFIX,
  emptyErrorDetails,
  formatElisionMarker,
  formatErrorReport,
  MAX_DISPLAY_STACK_LINES,
  MAX_MESSAGE_CHARS,
  MAX_REPORT_CHARS,
  MESSAGE_TRUNCATION_SUFFIX,
  toError
} from './errorDetails'

/** Build a synthetic stack with the requested number of frame lines. */
function stackWithLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `    at frame${index} (file.ts:${index}:1)`).join(
    '\n'
  )
}

describe('APP_VERSION', () => {
  it('resolves the build-time define (mirrored in vitest.renderer.ts)', () => {
    expect(APP_VERSION).toBe('0.0.0-test')
  })
})

describe('toError', () => {
  it('passes an Error through unchanged', () => {
    const error = new RangeError('Maximum call stack size exceeded')
    expect(toError(error)).toBe(error)
  })

  it('wraps a thrown string', () => {
    const wrapped = toError('plain string throw')
    expect(wrapped).toBeInstanceOf(Error)
    expect(wrapped.message).toBe('plain string throw')
    expect(wrapped.name).toBe('NonError')
  })

  it('wraps undefined without throwing', () => {
    expect(toError(undefined).message).toBe('unknown')
  })

  it('survives a value whose toString throws', () => {
    const hostile = {
      toString(): string {
        throw new Error('toString exploded')
      }
    }
    expect(() => toError(hostile)).not.toThrow()
    expect(toError(hostile).message).toBe('unknown')
  })
})

describe('buildErrorDetails', () => {
  it('extracts name, message, stack, component stack and version', () => {
    const error = new TypeError('boom')
    error.stack = 'TypeError: boom\n    at somewhere (file.ts:1:1)'

    const details = buildErrorDetails(error, '\n    in ProjectTree', '9.9.9')

    expect(details.name).toBe('TypeError')
    expect(details.message).toBe('boom')
    expect(details.stack).toBe(error.stack)
    expect(details.componentStack).toBe('\n    in ProjectTree')
    expect(details.version).toBe('9.9.9')
    expect(details.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('leaves a short stack untruncated', () => {
    const error = new Error('short')
    error.stack = stackWithLines(10)

    const details = buildErrorDetails(error, null, '1.0.0')

    expect(details.elidedStackLines).toBe(0)
    expect(details.displayStack).toBe(error.stack)
    expect(details.displayStack).not.toContain(ELISION_MARKER_SUFFIX)
  })

  it('truncates a long stack and appends the literal elision marker', () => {
    const error = new Error('deep')
    error.stack = stackWithLines(MAX_DISPLAY_STACK_LINES + 42)

    const details = buildErrorDetails(error, null, '1.0.0')
    const displayLines = details.displayStack.split('\n')

    expect(details.elidedStackLines).toBe(42)
    // 100 kept frames + one marker line.
    expect(displayLines).toHaveLength(MAX_DISPLAY_STACK_LINES + 1)
    expect(displayLines[displayLines.length - 1]).toBe(
      `… 42 more lines – ${ELISION_MARKER_SUFFIX}`
    )
    // The FULL stack is retained so `Copy error details` stays truthful.
    expect(details.stack.split('\n')).toHaveLength(MAX_DISPLAY_STACK_LINES + 42)
  })

  it('survives an error whose stack getter throws', () => {
    const hostile = {
      name: 'HostileError',
      message: 'hostile message',
      get stack(): string {
        throw new Error('stack getter exploded')
      }
    }

    let details = emptyErrorDetails('1.0.0')
    expect(() => {
      details = buildErrorDetails(hostile, null, '1.0.0')
    }).not.toThrow()

    expect(details.name).toBe('HostileError')
    expect(details.message).toBe('hostile message')
    expect(details.stack).toBe('')
    expect(details.displayStack).toBe('')
  })

  it('survives an error whose message getter throws', () => {
    const hostile = {
      name: 'HostileError',
      get message(): string {
        throw new Error('message getter exploded')
      },
      stack: 'HostileError: ?\n    at nowhere'
    }

    const details = buildErrorDetails(hostile, null, '1.0.0')

    // Falls back to stringifying the value itself, which is also guarded.
    expect(typeof details.message).toBe('string')
    expect(details.stack).toBe('HostileError: ?\n    at nowhere')
  })

  it.each([
    ['a thrown string', 'string throw', 'string throw'],
    ['a thrown number', 42, '42']
  ])('produces a usable report from %s', (_label, thrown, expectedMessage) => {
    const details = buildErrorDetails(thrown, null, '1.0.0')

    expect(details.name).toBe('Error')
    expect(details.message).toBe(expectedMessage)
    expect(details.stack).toBe('')
    expect(formatErrorReport(details)).toContain(expectedMessage)
  })

  it.each([
    ['undefined', undefined],
    ['null', null]
  ])('produces a usable report from a thrown %s', (_label, thrown) => {
    const details = buildErrorDetails(thrown, null, '1.0.0')

    expect(details.name).toBe('Error')
    expect(details.message).toBe('unknown')
    expect(formatErrorReport(details)).toContain('unknown')
  })

  it('produces a usable report from a thrown plain object', () => {
    const details = buildErrorDetails({ code: 'E_WEIRD' }, null, '1.0.0')

    expect(details.message).toBe('[object Object]')
    expect(() => formatErrorReport(details)).not.toThrow()
  })

  it('falls back to "unknown" for an empty version', () => {
    expect(buildErrorDetails(new Error('x'), null, '').version).toBe('unknown')
  })

  it('treats a missing component stack as an empty string', () => {
    expect(buildErrorDetails(new Error('x'), undefined, '1.0.0').componentStack).toBe('')
    expect(buildErrorDetails(new Error('x'), null, '1.0.0').componentStack).toBe('')
  })

  it('leaves a message shorter than the cap untouched', () => {
    const message = 'x'.repeat(MAX_MESSAGE_CHARS)

    const details = buildErrorDetails(new Error(message), null, '1.0.0')

    expect(details.message).toBe(message)
    expect(details.message.endsWith(MESSAGE_TRUNCATION_SUFFIX)).toBe(false)
  })

  it('caps an oversized message at MAX_MESSAGE_CHARS with an ellipsis', () => {
    const details = buildErrorDetails(new Error('y'.repeat(50_000)), null, '1.0.0')

    expect(details.message).toHaveLength(MAX_MESSAGE_CHARS)
    expect(details.message.endsWith(MESSAGE_TRUNCATION_SUFFIX)).toBe(true)
  })

  it('keeps the stack in the copied report however long the message is', () => {
    // The regression this cap exists for: the message is rendered BEFORE the
    // stack, so an uncapped one evicts the stack from the 16 KB report — and
    // the stack is the only part a maintainer can act on.
    const error = new Error('z'.repeat(MAX_REPORT_CHARS * 2))
    error.stack = stackWithLines(20)

    const report = formatErrorReport(buildErrorDetails(error, null, '1.0.0'))

    expect(report.length).toBeLessThanOrEqual(MAX_REPORT_CHARS)
    expect(report).toContain('at frame19')
  })
})

describe('formatElisionMarker', () => {
  it('uses the singular noun for one elided line', () => {
    expect(formatElisionMarker(1)).toBe(`… 1 more line – ${ELISION_MARKER_SUFFIX}`)
  })

  it('uses the plural noun otherwise', () => {
    expect(formatElisionMarker(2)).toBe(`… 2 more lines – ${ELISION_MARKER_SUFFIX}`)
  })
})

describe('formatErrorReport', () => {
  it('includes the version, the component stack and the FULL stack', () => {
    const error = new Error('kaboom')
    error.stack = stackWithLines(MAX_DISPLAY_STACK_LINES + 5)
    const details = buildErrorDetails(error, '\n    in ProjectTree\n    in App', '7.7.7')

    const report = formatErrorReport(details)

    expect(report).toContain('version: 7.7.7')
    expect(report).toContain('Error: kaboom')
    expect(report).toContain('in ProjectTree')
    expect(report).toContain(`at frame${MAX_DISPLAY_STACK_LINES + 4}`)
    expect(report).not.toContain(ELISION_MARKER_SUFFIX)
  })

  it('caps the report at MAX_REPORT_CHARS', () => {
    const error = new Error('huge')
    // ~40 chars per frame line → comfortably past the 16 KB cap.
    error.stack = stackWithLines(5000)
    const details = buildErrorDetails(error, 'x'.repeat(20_000), '1.0.0')

    const report = formatErrorReport(details)

    expect(report.length).toBeLessThanOrEqual(MAX_REPORT_CHARS)
    expect(report.endsWith('… report truncated')).toBe(true)
  })

  it('names the missing pieces rather than emitting blanks', () => {
    const report = formatErrorReport(emptyErrorDetails('1.0.0'))

    expect(report).toContain('(no stack captured)')
    expect(report).toContain('(no component stack captured)')
  })
})

describe('buildLogContext', () => {
  it('carries the component stack, app version and truncation flag', () => {
    const error = new Error('ctx')
    error.stack = stackWithLines(MAX_DISPLAY_STACK_LINES + 1)

    const context = buildLogContext(buildErrorDetails(error, '\n    in App', '3.2.1'))

    expect(context).toEqual({
      componentStack: '\n    in App',
      appVersion: '3.2.1',
      errorName: 'Error',
      stackTruncated: true
    })
  })

  it('reports an untruncated stack as such', () => {
    const context = buildLogContext(buildErrorDetails(new Error('ctx'), null, '3.2.1'))
    expect(context.stackTruncated).toBe(false)
  })
})
