// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * useTerminalFileLinks Hook
 *
 * React hook that detects file paths in terminal output and creates clickable links
 * that open files in the Monaco editor.
 *
 * Uses xterm.js ILinkProvider API to detect file paths in terminal lines,
 * validates them via IPC, and provides click handlers to open them.
 *
 * Features:
 * - Detects absolute, relative, and project-relative paths
 * - Supports line:column notation (:42:10, (15,3))
 * - Path validation with LRU cache to minimize IPC calls
 * - CWD resolution for relative paths
 * - Cross-platform path handling (Windows/POSIX)
 * - Smart resolution: Falls back to filename search when exact path not found
 * - File picker dialog when multiple matches exist
 * - CLI-wrap joining: Detects multi-line tool output (Write(, Saved to, etc.)
 *   and joins split paths before detection
 */

import { useEffect, useRef, useMemo, useCallback, useState } from 'react'
import type { Terminal, ILinkProvider, ILink, ILinkDecorations } from '@xterm/xterm'
import type React from 'react'
import type { FileNode } from '../../../preload/index'
import {
  detectFilePaths,
  createPathCache,
  resolvePath,
  normalizePath
} from '../utils/filePathLinks.logic'
import { useFilenameIndex } from './useFilenameIndex'
import {
  resolvePathSmart,
  type SmartResolutionResult
} from '../utils/smartPathResolver.logic'
import type { PathScore } from '../utils/pathScoring'
import { findCliWrapGroup, joinedPosToBuffer, type JoinSegment } from '../utils/cliWrapJoin.logic'
import { logger } from '../utils/logger'

// Create a module-level cache shared across hook instances
// This ensures cache hits across terminal restarts and multiple terminals
const pathCache = createPathCache(100, 30000)

export interface UseTerminalFileLinksOptions {
  /** Reference to xterm Terminal instance */
  terminalRef: React.RefObject<Terminal | null>
  /** Terminal ID for fetching CWD */
  terminalId: string | null
  /** Current project root for resolving project-relative paths */
  projectRoot: string | null
  /**
   * Project file tree for smart resolution.
   * When provided, enables smart file lookup when exact path validation fails.
   */
  files?: FileNode[]
  /**
   * Callback when a file link is clicked.
   * Should open the file in the Monaco editor at the specified position.
   *
   * @param filePath Absolute path to the file
   * @param line Optional line number (1-based)
   * @param column Optional column number (1-based)
   */
  onFileOpen: (filePath: string, line?: number, column?: number) => void
  /**
   * Callback to show file picker when multiple candidates match.
   * If not provided, the first (best-ranked) candidate is used automatically.
   *
   * @param candidates Ranked list of matching file paths
   * @param query The original query string
   * @returns Promise resolving to selected path, or null if cancelled
   */
  onShowPicker?: (candidates: PathScore[], query: string) => Promise<string | null>
  /**
   * Optional error handler for link provider errors.
   * Note: Should be memoized (useCallback) to prevent unnecessary re-renders.
   */
  onError?: (error: Error) => void
}

export interface UseTerminalFileLinksReturn {
  /** The registered ILinkProvider instance (null if terminal not ready) */
  linkProvider: ILinkProvider | null
  /** Whether the link provider is ready and registered */
  isReady: boolean
}

/**
 * Hook for creating clickable file links in terminal output.
 *
 * Automatically:
 * - Detects file paths in terminal lines as they're rendered
 * - Validates paths exist via IPC (with caching)
 * - Resolves relative paths using terminal CWD and project root
 * - Creates clickable links that open files in the editor
 *
 * @param options Configuration and callbacks
 * @returns Object with linkProvider and isReady status
 *
 * @example
 * ```tsx
 * const { isReady } = useTerminalFileLinks({
 *   terminal: xtermRef.current,
 *   terminalId: terminalId,
 *   projectRoot: projectPath,
 *   onFileOpen: (filePath, line, column) => {
 *     // Open file in Monaco editor at line:column
 *     openFileInEditor(filePath, line, column)
 *   }
 * })
 * ```
 */
// Visual decoration for smart-resolved links (blue underline)
const SMART_LINK_DECORATIONS: ILinkDecorations = {
  underline: true,
  pointerCursor: true
}

export function useTerminalFileLinks(
  options: UseTerminalFileLinksOptions
): UseTerminalFileLinksReturn {
  const { terminalRef, terminalId, projectRoot, files = [], onFileOpen, onShowPicker, onError } =
    options

  // Track terminal readiness with state to trigger re-renders when terminal is created
  const [terminalReady, setTerminalReady] = useState(false)

  // Check terminal availability when terminalId changes (terminal created)
  useEffect(() => {
    const checkTerminal = () => {
      const hasTerminal = !!terminalRef.current
      if (hasTerminal !== terminalReady) {
        setTerminalReady(hasTerminal)
      }
    }

    // Check immediately
    checkTerminal()

    // If no terminal yet but we have terminalId, poll briefly
    // (terminal ref is set synchronously after terminal creation)
    if (terminalId && !terminalRef.current) {
      const timeoutId = setTimeout(checkTerminal, 100)
      return () => clearTimeout(timeoutId)
    }

    return undefined
  }, [terminalId, terminalReady, terminalRef])

  // Get terminal from ref (will be null until terminal is created)
  const terminal = terminalRef.current

  // Use filename index for smart resolution
  const { getIndex } = useFilenameIndex({ files })

  // Cache CWD to avoid repeated IPC calls
  const cwdRef = useRef<string | null>(null)

  // Fetch CWD from terminal service
  const fetchCwd = useCallback(async (): Promise<string | null> => {
    if (!terminalId) return null

    try {
      const result = await window.api.terminal.getInfo(terminalId)
      if (result.success && result.info) {
        cwdRef.current = result.info.cwd
        return result.info.cwd
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      logger.warn(`[FileLinks] Failed to get terminal CWD: ${errorMsg}`)
    }

    return cwdRef.current
  }, [terminalId])

  // Validate path via IPC with caching
  const validatePath = useCallback(
    async (path: string): Promise<{ exists: boolean; absolutePath?: string }> => {
      // Check cache first
      const cached = pathCache.get(path)
      if (cached) {
        return {
          exists: cached.exists,
          absolutePath: cached.absolutePath || undefined
        }
      }

      try {
        const result = await window.api.file.validatePath(path, projectRoot || undefined)

        // Cache the result
        pathCache.set(path, {
          exists: result.exists,
          absolutePath: result.absolutePath || null,
          timestamp: Date.now()
        })

        return {
          exists: result.exists,
          absolutePath: result.absolutePath
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e)
        logger.warn(`[FileLinks] Path validation error: ${errorMsg}`)
        return { exists: false }
      }
    },
    [projectRoot]
  )

  // Create ILinkProvider
  const linkProvider = useMemo<ILinkProvider | null>(() => {
    if (!terminal) return null

    return {
      provideLinks: async (
        bufferLineNumber: number,
        callback: (links: ILink[] | undefined) => void
      ) => {
        try {
          const buffer = terminal.buffer.active
          const bufferIndex = bufferLineNumber - 1

          // Get the line content from xterm buffer
          const line = buffer.getLine(bufferIndex)
          if (!line) {
            callback(undefined)
            return
          }

          // Phase 1: Build full logical line by joining xterm-wrapped continuations.
          // xterm.js marks continuation lines with isWrapped when content
          // exceeds terminal.cols and wraps to the next row.
          let logicalStart = bufferIndex
          while (logicalStart > 0) {
            const checkLine = buffer.getLine(logicalStart)
            if (!checkLine?.isWrapped) break
            logicalStart--
          }

          let logicalEnd = bufferIndex
          while (true) {
            const nextLine = buffer.getLine(logicalEnd + 1)
            if (!nextLine?.isWrapped) break
            logicalEnd++
          }

          // Join all lines in the logical group
          let logicalText = ''
          let lineWidths: number[] = []
          for (let i = logicalStart; i <= logicalEnd; i++) {
            const bufLine = buffer.getLine(i)
            if (bufLine) {
              const text = bufLine.translateToString(true)
              lineWidths.push(text.length)
              logicalText += text
            }
          }

          // Phase 2: CLI-wrap joining for tool-formatted line breaks.
          // CLI tools (e.g., Claude Code) insert explicit \n + indentation
          // to wrap long paths. These are separate buffer lines with
          // isWrapped: false, so Phase 1 doesn't catch them.
          let cliSegments: JoinSegment[] | null = null

          const getBufferLine = (idx: number): string | null => {
            const bufLine = buffer.getLine(idx)
            if (!bufLine) return null
            return bufLine.translateToString(true)
          }

          const cliGroup = findCliWrapGroup(logicalStart, getBufferLine)

          if (cliGroup) {
            // Phase 2 replaces Phase 1 data entirely – the CLI group is the
            // authoritative context for file-path detection. This is safe
            // because CLI-formatted lines (explicit \n + indentation) are
            // short and do not also trigger xterm wrapping.
            logicalText = cliGroup.joinedText
            logicalStart = cliGroup.groupStart
            logicalEnd = cliGroup.groupEnd
            lineWidths = cliGroup.segments.map((s) => s.text.length)
            cliSegments = cliGroup.segments
          }

          // Detect file paths in the full logical line
          const matches = detectFilePaths(logicalText)
          if (matches.length === 0) {
            callback(undefined)
            return
          }

          // Helper: convert logical text position to buffer coordinates (1-based)
          const logicalToBuffer = (pos: number): { x: number; y: number } => {
            // When CLI-wrap joining is active, delegate to the tested
            // joinedPosToBuffer and convert 0-based output to xterm 1-based
            if (cliSegments) {
              const mapped = joinedPosToBuffer(pos, cliSegments)
              return {
                x: mapped.columnOffset + 1,
                y: mapped.bufferIndex + 1
              }
            }

            let remaining = pos
            for (let i = 0; i < lineWidths.length; i++) {
              if (remaining < lineWidths[i]) {
                return { x: remaining + 1, y: logicalStart + i + 1 }
              }
              remaining -= lineWidths[i]
            }
            const lastIdx = lineWidths.length - 1
            return { x: lineWidths[lastIdx] + 1, y: logicalStart + lastIdx + 1 }
          }

          // Get CWD for relative path resolution
          const cwd = await fetchCwd()

          // Resolve a candidate path via smart resolution (with file tree) or simple validation
          const tryResolveCandidate = async (
            candidatePath: string
          ): Promise<{
            finalPath: string | null
            wasSmartResolved: boolean
            pendingCandidates: PathScore[] | null
          }> => {
            let finalPath: string | null = null
            let wasSmartResolved = false
            let pendingCandidates: PathScore[] | null = null

            if (files.length > 0) {
              const smartResult: SmartResolutionResult = await resolvePathSmart({
                path: candidatePath,
                cwd,
                projectRoot,
                index: getIndex(),
                files,
                validateExactPath: async (p) => {
                  const v = await validatePath(p)
                  return v.exists
                }
              })

              if (smartResult.status === 'exact') {
                finalPath = smartResult.resolvedPath!
              } else if (smartResult.status === 'single-match') {
                finalPath = smartResult.resolvedPath!
                wasSmartResolved = true
              } else if (smartResult.status === 'multiple-matches') {
                pendingCandidates = smartResult.candidates!
                finalPath = smartResult.candidates![0].path
                wasSmartResolved = true
              }
            } else {
              const validation = await validatePath(candidatePath)
              if (validation.exists) {
                finalPath = validation.absolutePath || candidatePath
              }
            }

            return { finalPath, wasSmartResolved, pendingCandidates }
          }

          // Convert matches to ILinks
          const links: ILink[] = []

          for (const match of matches) {
            // Strip @-prefix from file references (e.g., @/path or @src/path from Claude Code CLI)
            // Keep original path for fallback (e.g., @types/node/index.d.ts is a valid npm scope)
            const hasAtPrefix = match.path.startsWith('@')
            const strippedPath = hasAtPrefix ? match.path.slice(1) : match.path

            // Resolve relative paths
            let resolvedPath = strippedPath
            if (!strippedPath.startsWith('/') && !strippedPath.match(/^[A-Za-z]:/)) {
              // Relative path - resolve against CWD or project root
              resolvedPath = resolvePath(strippedPath, cwd || '', projectRoot || '')
            }

            // Normalize the path
            resolvedPath = normalizePath(resolvedPath)

            // Try smart resolution (includes exact path validation as first step)
            const { finalPath: resolvedFinalPath, wasSmartResolved, pendingCandidates } =
              await tryResolveCandidate(resolvedPath)
            let finalPath = resolvedFinalPath

            // For @-prefixed paths, try the original path with @ if stripped version failed
            // This handles npm scoped packages like @types/node/index.d.ts
            if (!finalPath && hasAtPrefix) {
              let originalResolvedPath = match.path
              if (!match.path.startsWith('/') && !match.path.match(/^[A-Za-z]:/)) {
                originalResolvedPath = resolvePath(match.path, cwd || '', projectRoot || '')
              }
              originalResolvedPath = normalizePath(originalResolvedPath)

              const fallbackValidation = await validatePath(originalResolvedPath)
              if (fallbackValidation.exists) {
                finalPath = fallbackValidation.absolutePath || originalResolvedPath
              }
            }

            // Skip if no valid path found
            if (!finalPath) continue

            const absolutePath = finalPath

            // Map logical positions to buffer coordinates (handles wrapped lines)
            const rangeStart = logicalToBuffer(match.startIndex)
            const rangeEnd = logicalToBuffer(match.endIndex)

            // Only include links that overlap with the requested buffer line
            if (rangeStart.y > bufferLineNumber || rangeEnd.y < bufferLineNumber) continue

            // Create the link with optional smart-resolved decoration
            const link: ILink = {
              range: {
                start: rangeStart,
                end: rangeEnd
              },
              text: match.fullMatch, // includes @ prefix intentionally – shows CLI tool reference context
              decorations: wasSmartResolved ? SMART_LINK_DECORATIONS : undefined,
              activate: async () => {
                // If multiple candidates and picker available, show picker
                if (pendingCandidates && onShowPicker) {
                  const selected = await onShowPicker(pendingCandidates, match.path)
                  if (selected) {
                    onFileOpen(selected, match.line, match.column)
                  }
                  // If null (cancelled), do nothing
                } else {
                  onFileOpen(absolutePath, match.line, match.column)
                }
              },
              hover: () => {
                // Could show tooltip here in future
              },
              leave: () => {
                // Cleanup on hover leave
              }
            }

            links.push(link)
          }

          callback(links.length > 0 ? links : undefined)
        } catch (e) {
          logger.error('[FileLinks] Error providing file links:', e instanceof Error ? e : undefined)
          onError?.(e instanceof Error ? e : new Error(String(e)))
          callback(undefined)
        }
      }
    }
  }, [terminal, terminalReady, fetchCwd, validatePath, projectRoot, files, getIndex, onFileOpen, onShowPicker, onError])

  // Register the link provider with xterm
  useEffect(() => {
    if (!terminal || !linkProvider) return

    // Guard: Check if registerLinkProvider exists (may not exist in mocked terminals)
    if (typeof terminal.registerLinkProvider !== 'function') {
      logger.warn('[FileLinks] Terminal does not support registerLinkProvider')
      return
    }

    const disposable = terminal.registerLinkProvider(linkProvider)

    return () => {
      disposable.dispose()
    }
  }, [terminal, linkProvider])

  return {
    linkProvider,
    isReady: !!linkProvider
  }
}
