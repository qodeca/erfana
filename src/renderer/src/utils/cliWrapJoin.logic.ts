// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Pure logic for detecting and joining CLI-formatted multi-line output.
 *
 * @module cliWrapJoin.logic
 *
 * CLI tools (e.g., Claude Code) format long tool output with explicit `\n` +
 * indentation, splitting file paths across multiple terminal buffer lines.
 * These lines have `isWrapped: false` (they're not xterm-wrapped), so the
 * existing isWrapped joining doesn't help.
 *
 * This module provides pattern-based heuristics to detect and rejoin these
 * CLI-formatted splits before file path detection runs.
 *
 * Pattern: Pure functions with no React/xterm dependencies for testability.
 */

/** A segment of text from a buffer line, tracking its origin */
export interface JoinSegment {
  /** The text content (indentation stripped for continuations) */
  text: string
  /** Original buffer line index (0-based) */
  bufferIndex: number
  /** Number of leading chars stripped (indentation) */
  strippedPrefix: number
  /** Original full line length (before stripping) */
  originalLength: number
}

/** Result of CLI-wrap group detection */
export interface CliWrapGroup {
  /** Joined text with indentation stripped from continuations */
  joinedText: string
  /** Individual segments for position mapping */
  segments: JoinSegment[]
  /** Buffer index of first line in group */
  groupStart: number
  /** Buffer index of last line in group */
  groupEnd: number
}

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

interface CliWrapPattern {
  /** Name for debugging */
  name: string
  /** Regex to detect the start of a multi-line group */
  opener: RegExp
  /** Check if a subsequent line is a continuation of the opened group */
  isContinuation: (line: string) => boolean
  /** Check if a continuation line is the terminal (last) line of the group */
  isTerminal: (line: string) => boolean
  /** Whether a terminal (closing) line must be found for the group to be valid */
  requiresTerminal: boolean
  /** Maximum continuation lines to scan (default: 4) */
  maxLines: number
}

/**
 * Regex that matches common file extensions at end of a string,
 * optionally followed by position notation (:line, :line-range,
 * :line:col) and/or sentence punctuation.
 */
const EXTENSION_ENDING = /\.\w{1,10}(?::\d{1,6}(?:-\d{1,6})?(?::\d{1,6})?)?[).]*$/

/**
 * Lines that look like a new command or output – should stop continuation.
 */
const NEW_COMMAND_PATTERN = /^[⏺●▶►>$#%]\s|^\s*$/

const patterns: CliWrapPattern[] = [
  // Pattern A – Tool output: Read(, Write(, Update(, Edit(, Glob(, Grep(
  {
    name: 'tool-output',
    opener: /(?:Read|Update|Write|Edit|Glob|Grep)\([^)]*$/,
    isContinuation: (line: string) => {
      if (NEW_COMMAND_PATTERN.test(line)) return false
      // A continuation either contains the closing paren or is indented content
      const trimmed = line.trimStart()
      return trimmed.length > 0 && (line.startsWith(' ') || line.startsWith('\t'))
    },
    isTerminal: (line: string) => {
      // Closing paren must follow path-like chars or end the trimmed line
      const trimmed = line.trimEnd()
      return /[a-zA-Z0-9_./-]\)/.test(trimmed) || trimmed.endsWith(')')
    },
    requiresTerminal: true,
    maxLines: 4
  },

  // Pattern B – "Saved to" / "Wrote to"
  {
    name: 'saved-to',
    opener: /(?:Saved|Wrote) to \S+$/,
    isContinuation: (line: string) => {
      if (NEW_COMMAND_PATTERN.test(line)) return false
      const trimmed = line.trimStart()
      // Continuation must be indented and start with path-like chars
      return (
        trimmed.length > 0 &&
        line.length > trimmed.length &&
        /^[a-zA-Z0-9_./-]/.test(trimmed)
      )
    },
    isTerminal: (line: string) => {
      // Terminal when line ends with a file extension (possibly with trailing punctuation)
      const trimmed = line.trimEnd()
      return EXTENSION_ENDING.test(trimmed)
    },
    requiresTerminal: false,
    maxLines: 4
  },

  // Pattern C – @-prefixed file reference (@scope/path and @/path absolute)
  {
    name: 'at-prefix',
    opener: /@(?:[a-zA-Z0-9_-]+)?\/[^\s]*$/,
    isContinuation: (line: string) => {
      if (NEW_COMMAND_PATTERN.test(line)) return false
      const trimmed = line.trimStart()
      // Continuation should start with path-continuation chars (e.g., .md, /subdir)
      return trimmed.length > 0 && /^[a-zA-Z0-9_./-]/.test(trimmed)
    },
    isTerminal: (line: string) => {
      const trimmed = line.trimEnd()
      return EXTENSION_ENDING.test(trimmed)
    },
    requiresTerminal: false,
    maxLines: 4
  }
]

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Try to find a CLI-wrap group containing the given buffer line.
 * Returns null if the line is not part of any CLI-wrapped group.
 *
 * @param targetIndex - The buffer index to check (0-based)
 * @param getLine - Callback to read a buffer line by index (returns null if out of bounds)
 * @param maxLookback - Max lines to look backward (default: 4)
 * @param maxLookahead - Max lines to look forward (default: 4)
 */
export function findCliWrapGroup(
  targetIndex: number,
  getLine: (index: number) => string | null,
  maxLookback: number = 4,
  maxLookahead: number = 4
): CliWrapGroup | null {
  const targetLine = getLine(targetIndex)
  if (targetLine === null) return null

  // Try forward scan first: check if targetIndex is an opener
  for (const pattern of patterns) {
    if (pattern.opener.test(targetLine)) {
      const group = scanForward(targetIndex, pattern, getLine, maxLookahead)
      if (group) return group
    }
  }

  // Backward scan: check if targetIndex is a continuation
  for (const pattern of patterns) {
    const group = scanBackward(targetIndex, pattern, getLine, maxLookback, maxLookahead)
    if (group) return group
  }

  return null
}

/**
 * Scan forward from an opener line to collect continuations.
 */
function scanForward(
  openerIndex: number,
  pattern: CliWrapPattern,
  getLine: (index: number) => string | null,
  maxLookahead: number
): CliWrapGroup | null {
  const openerLine = getLine(openerIndex)
  if (openerLine === null) return null

  const segments: JoinSegment[] = [
    {
      text: openerLine,
      bufferIndex: openerIndex,
      strippedPrefix: 0,
      originalLength: openerLine.length
    }
  ]

  const limit = Math.min(pattern.maxLines, maxLookahead)
  let foundTerminal = false

  for (let i = 1; i <= limit; i++) {
    const nextLine = getLine(openerIndex + i)
    if (nextLine === null) break
    if (!pattern.isContinuation(nextLine)) break

    const trimmed = nextLine.trimStart()
    const strippedPrefix = nextLine.length - trimmed.length

    segments.push({
      text: trimmed,
      bufferIndex: openerIndex + i,
      strippedPrefix,
      originalLength: nextLine.length
    })

    if (pattern.isTerminal(nextLine)) {
      foundTerminal = true
      break
    }
  }

  // Need at least 2 segments (opener + continuation) to form a group
  if (segments.length < 2) return null
  // Some patterns (e.g. tool-output) require a closing terminal line to be valid
  if (pattern.requiresTerminal && !foundTerminal) return null

  return {
    joinedText: segments.map((s) => s.text).join(''),
    segments,
    groupStart: segments[0].bufferIndex,
    groupEnd: segments[segments.length - 1].bufferIndex
  }
}

/**
 * Scan backward from a potential continuation line to find the opener.
 */
function scanBackward(
  targetIndex: number,
  pattern: CliWrapPattern,
  getLine: (index: number) => string | null,
  maxLookback: number,
  maxLookahead: number
): CliWrapGroup | null {
  const targetLine = getLine(targetIndex)
  if (targetLine === null) return null

  // Check that the target looks like it could be a continuation
  if (!pattern.isContinuation(targetLine)) return null

  // Scan backward for an opener
  for (let back = 1; back <= maxLookback; back++) {
    const checkIndex = targetIndex - back
    const checkLine = getLine(checkIndex)
    if (checkLine === null) break

    if (pattern.opener.test(checkLine)) {
      // Found the opener – now scan forward from it to build the full group
      const group = scanForward(checkIndex, pattern, getLine, maxLookahead)
      if (group) {
        // Verify the target is actually within this group
        if (targetIndex >= group.groupStart && targetIndex <= group.groupEnd) {
          return group
        }
      }
      // Even if forward scan didn't include targetIndex, stop looking further back
      break
    }

    // If this intermediate line isn't a valid continuation, stop
    if (!pattern.isContinuation(checkLine)) break
  }

  return null
}

/**
 * Convert a position in joined text back to buffer coordinates.
 *
 * @param pos - Position in the joined text (0-based)
 * @param segments - Segments from the CliWrapGroup
 * @returns Buffer coordinates with bufferIndex (0-based) and columnOffset (0-based)
 */
export function joinedPosToBuffer(
  pos: number,
  segments: JoinSegment[]
): { bufferIndex: number; columnOffset: number } {
  let remaining = pos
  for (let i = 0; i < segments.length; i++) {
    if (remaining < segments[i].text.length) {
      return {
        bufferIndex: segments[i].bufferIndex,
        // Add back the stripped prefix to get the actual column in the buffer
        columnOffset: remaining + segments[i].strippedPrefix
      }
    }
    remaining -= segments[i].text.length
  }

  // Past the end – return end of last segment
  const last = segments[segments.length - 1]
  return {
    bufferIndex: last.bufferIndex,
    columnOffset: last.text.length + last.strippedPrefix
  }
}
