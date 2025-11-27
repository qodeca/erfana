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
 */

import { useEffect, useRef, useMemo, useCallback } from 'react'
import type { Terminal, ILinkProvider, ILink, ILinkDecorations } from '@xterm/xterm'
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

// Create a module-level cache shared across hook instances
// This ensures cache hits across terminal restarts and multiple terminals
const pathCache = createPathCache(100, 30000)

export interface UseTerminalFileLinksOptions {
  /** xterm Terminal instance */
  terminal: Terminal | null
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
  const { terminal, terminalId, projectRoot, files = [], onFileOpen, onShowPicker, onError } =
    options

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
      console.warn('[FileLinks] Failed to get terminal CWD:', e)
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
        console.warn('[FileLinks] Path validation error:', e)
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
          // Get the line content from xterm buffer
          const line = terminal.buffer.active.getLine(bufferLineNumber - 1)
          if (!line) {
            callback(undefined)
            return
          }

          const lineText = line.translateToString(true)

          // Detect file paths in the line using pure logic
          const matches = detectFilePaths(lineText)
          if (matches.length === 0) {
            callback(undefined)
            return
          }

          // Get CWD for relative path resolution
          const cwd = await fetchCwd()

          // Convert matches to ILinks
          const links: ILink[] = []

          for (const match of matches) {
            // Resolve relative paths
            let resolvedPath = match.path
            if (!match.path.startsWith('/') && !match.path.match(/^[A-Za-z]:/)) {
              // Relative path - resolve against CWD or project root
              resolvedPath = resolvePath(match.path, cwd || '', projectRoot || '')
            }

            // Normalize the path
            resolvedPath = normalizePath(resolvedPath)

            // Try smart resolution (includes exact path validation as first step)
            let finalPath: string | null = null
            let wasSmartResolved = false
            let pendingCandidates: PathScore[] | null = null

            // Use smart resolution if files are available
            if (files.length > 0) {
              const smartResult: SmartResolutionResult = await resolvePathSmart({
                path: resolvedPath,
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
                wasSmartResolved = false
              } else if (smartResult.status === 'single-match') {
                finalPath = smartResult.resolvedPath!
                wasSmartResolved = true
              } else if (smartResult.status === 'multiple-matches') {
                // Store candidates for picker - will be shown on click
                pendingCandidates = smartResult.candidates!
                // Use the best-ranked candidate as default
                finalPath = smartResult.candidates![0].path
                wasSmartResolved = true
              }
              // status === 'no-match' leaves finalPath as null
            } else {
              // Fallback to simple validation (original behavior)
              const validation = await validatePath(resolvedPath)
              if (validation.exists) {
                finalPath = validation.absolutePath || resolvedPath
              }
            }

            // Skip if no valid path found
            if (!finalPath) continue

            const absolutePath = finalPath

            // Create the link with optional smart-resolved decoration
            const link: ILink = {
              range: {
                start: { x: match.startIndex + 1, y: bufferLineNumber },
                end: { x: match.endIndex + 1, y: bufferLineNumber }
              },
              text: match.fullMatch,
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
          console.error('[FileLinks] Error providing file links:', e)
          onError?.(e instanceof Error ? e : new Error(String(e)))
          callback(undefined)
        }
      }
    }
  }, [terminal, fetchCwd, validatePath, projectRoot, files, getIndex, onFileOpen, onShowPicker, onError])

  // Register the link provider with xterm
  useEffect(() => {
    if (!terminal || !linkProvider) return

    // Guard: Check if registerLinkProvider exists (may not exist in mocked terminals)
    if (typeof terminal.registerLinkProvider !== 'function') {
      console.warn('[FileLinks] Terminal does not support registerLinkProvider')
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
