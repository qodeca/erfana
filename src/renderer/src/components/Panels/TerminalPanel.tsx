/**
 * TerminalPanel Component
 *
 * Terminal emulator panel using xterm.js + node-pty.
 * Follows the panel style established by ProjectPanel and CopilotPanel.
 */

import { useState, useEffect, useRef } from 'react'
import { ISplitviewPanelProps } from 'dockview'
import { Terminal as TerminalIcon, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { useTerminalStore } from '../../stores/useTerminalStore'
import '@xterm/xterm/css/xterm.css'
import './TerminalPanel.css'

export function TerminalPanel(_props: ISplitviewPanelProps) {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null)
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const terminalIdRef = useRef<string | null>(null)

  // Terminal store for cross-component communication
  const setActiveTerminalId = useTerminalStore((state) => state.setActiveTerminalId)

  // Keep ref in sync with state for cleanup
  useEffect(() => {
    terminalIdRef.current = terminalId
  }, [terminalId])

  // Check terminal availability on mount
  useEffect(() => {
    checkAvailability()
  }, [])

  // Create terminal when available
  useEffect(() => {
    if (isAvailable && terminalRef.current && !xtermRef.current) {
      initializeTerminal()
    }

    // Cleanup on unmount only
    return () => {
      if (terminalIdRef.current) {
        window.api.terminal.kill(terminalIdRef.current)
        setActiveTerminalId(null)
      }
      if (xtermRef.current) {
        xtermRef.current.dispose()
      }
    }
  }, [isAvailable, setActiveTerminalId])

  // Handle terminal data
  useEffect(() => {
    if (!terminalId) return

    const unsubscribeData = window.api.terminal.onData((data) => {
      if (data.terminalId === terminalId && xtermRef.current) {
        xtermRef.current.write(data.data)
      }
    })

    const unsubscribeExit = window.api.terminal.onExit((data) => {
      if (data.terminalId === terminalId) {
        console.log(`Terminal exited with code ${data.exitCode}`)
        // Optionally restart or show exit message
      }
    })

    const unsubscribeError = window.api.terminal.onError((data) => {
      if (data.terminalId === terminalId) {
        console.error('Terminal error:', data.error)
        setError(data.error)
      }
    })

    return () => {
      unsubscribeData()
      unsubscribeExit()
      unsubscribeError()
    }
  }, [terminalId])

  // Handle resize (panel drag, window resize, show/hide)
  useEffect(() => {
    if (!fitAddonRef.current || !terminalId || !terminalRef.current) return

    const handleResize = () => {
      try {
        fitAddonRef.current?.fit()

        if (xtermRef.current) {
          const cols = xtermRef.current.cols
          const rows = xtermRef.current.rows
          window.api.terminal.resize(terminalId, cols, rows)
        }
      } catch (error) {
        console.error('Failed to resize terminal:', error)
      }
    }

    // Fit on mount
    setTimeout(handleResize, 100)

    // Use ResizeObserver to detect container size changes
    // This handles panel drag, window resize, and show/hide
    const resizeObserver = new ResizeObserver(() => {
      // Debounce slightly to avoid excessive resize calls
      setTimeout(handleResize, 10)
    })

    resizeObserver.observe(terminalRef.current)

    return () => resizeObserver.disconnect()
  }, [terminalId])

  const checkAvailability = async () => {
    try {
      const result = await window.api.terminal.isAvailable()
      setIsAvailable(result.available)
    } catch (err: any) {
      console.error('Failed to check terminal availability:', err)
      setIsAvailable(false)
      setError(err.message)
    }
  }

  const initializeTerminal = async () => {
    if (!terminalRef.current) return

    // Check if container is visible before initializing xterm
    // xterm.js cannot render properly if opened on hidden element (display:none or 0 dimensions)
    const rect = terminalRef.current.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      console.warn('Terminal container not visible, waiting for visibility...')
      // Retry after container becomes visible
      setTimeout(initializeTerminal, 100)
      return
    }

    try {
      // Create xterm.js instance
      const xterm = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace",
        fontWeight: 'normal',
        fontWeightBold: 'bold',
        allowTransparency: false,
        theme: {
          background: '#000000',
          foreground: '#ffffff',
          cursor: '#4fc1ff',
          cursorAccent: '#000000',
          selectionBackground: '#264f78',
          black: '#000000',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#e5e510',
          blue: '#2472c8',
          magenta: '#bc3fbc',
          cyan: '#11a8cd',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#ffffff'
        },
        scrollback: 10000,
        allowProposedApi: true
      })

      // Add addons (load fit and weblinks BEFORE open)
      const fitAddon = new FitAddon()
      const webLinksAddon = new WebLinksAddon()

      xterm.loadAddon(fitAddon)
      xterm.loadAddon(webLinksAddon)

      // Open terminal in DOM
      xterm.open(terminalRef.current!)

      // Load WebGL renderer AFTER open (fixes canvas rendering issues in Electron)
      try {
        const webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => {
          console.warn('WebGL context lost, disposing addon')
          webglAddon.dispose()
        })
        xterm.loadAddon(webglAddon)
      } catch (error) {
        console.warn('WebGL renderer failed, falling back to canvas:', error)
        // Continue with canvas renderer if WebGL fails
      }

      // Store refs
      xtermRef.current = xterm
      fitAddonRef.current = fitAddon

      // Fit terminal to container
      setTimeout(() => {
        fitAddon.fit()
      }, 50)

      // Get project path for initial CWD
      const projectPath = await window.api.file.getProjectPath()

      // Create PTY
      const result = await window.api.terminal.create({
        cwd: projectPath || undefined,
        cols: xterm.cols,
        rows: xterm.rows
      })

      if (!result.success || !result.terminalId) {
        throw new Error(result.error || 'Failed to create terminal')
      }

      setTerminalId(result.terminalId)
      setActiveTerminalId(result.terminalId) // Register in store

      // Clear screen and show clean prompt
      xterm.write('\x1b[2J\x1b[H')

      // Handle user input
      xterm.onData((data) => {
        if (result.terminalId) {
          window.api.terminal.write(result.terminalId, data)
        }
      })
    } catch (err: any) {
      console.error('Failed to initialize terminal:', err)
      setError(err.message)
    }
  }

  const handleRestartTerminal = async () => {
    // Kill current terminal session
    if (terminalIdRef.current) {
      await window.api.terminal.kill(terminalIdRef.current)
      setActiveTerminalId(null)
    }

    // Dispose xterm instance
    if (xtermRef.current) {
      xtermRef.current.dispose()
      xtermRef.current = null
    }

    // Reset state
    setTerminalId(null)
    setError(null)

    // Wait a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Create new terminal
    if (terminalRef.current && isAvailable) {
      await initializeTerminal()
    }
  }

  return (
    <div className="terminal-panel sidebar-panel">
      <div className="sidebar-panel-header">
        <TerminalIcon size={16} className="panel-header-icon" />
        <span className="sidebar-panel-title">Terminal</span>
        {terminalId && (
          <button
            className="terminal-clear-button"
            onClick={handleRestartTerminal}
            title="Restart Terminal"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="sidebar-panel-content">
        {isAvailable === null ? (
          // Checking availability
          <div className="terminal-status">
            <p>Checking terminal availability...</p>
          </div>
        ) : !isAvailable ? (
          // Not available
          <div className="terminal-status">
            <div className="terminal-error-icon">⚠️</div>
            <h3>Terminal Not Available</h3>
            <p>
              node-pty is not available. Terminal functionality requires node-pty to be built
              successfully.
            </p>
            {error && <p className="error-details">{error}</p>}
          </div>
        ) : error ? (
          // Error occurred
          <div className="terminal-status">
            <div className="terminal-error-icon">❌</div>
            <h3>Terminal Error</h3>
            <p className="error-details">{error}</p>
          </div>
        ) : (
          // Terminal ready
          <div ref={terminalRef} className="terminal-container" />
        )}
      </div>
    </div>
  )
}
