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
import '@xterm/xterm/css/xterm.css'
import './TerminalPanel.css'

export function TerminalPanel(_props: ISplitviewPanelProps) {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null)
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // Check terminal availability on mount
  useEffect(() => {
    checkAvailability()
  }, [])

  // Create terminal when available
  useEffect(() => {
    if (isAvailable && terminalRef.current && !xtermRef.current) {
      initializeTerminal()
    }

    // Cleanup on unmount
    return () => {
      if (terminalId) {
        window.api.terminal.kill(terminalId)
      }
      if (xtermRef.current) {
        xtermRef.current.dispose()
      }
    }
  }, [isAvailable])

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
        console.log(`🏁 Terminal exited with code ${data.exitCode}`)
        // Optionally restart or show exit message
      }
    })

    const unsubscribeError = window.api.terminal.onError((data) => {
      if (data.terminalId === terminalId) {
        console.error('❌ Terminal error:', data.error)
        setError(data.error)
      }
    })

    return () => {
      unsubscribeData()
      unsubscribeExit()
      unsubscribeError()
    }
  }, [terminalId])

  // Handle resize
  useEffect(() => {
    if (!fitAddonRef.current || !terminalId) return

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

    // Fit on window resize
    window.addEventListener('resize', handleResize)

    return () => window.removeEventListener('resize', handleResize)
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

    try {
      // Create xterm.js instance
      const xterm = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace",
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
          cursor: '#4fc1ff',
          cursorAccent: '#1e1e1e',
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

      // Add addons
      const fitAddon = new FitAddon()
      const webLinksAddon = new WebLinksAddon()

      xterm.loadAddon(fitAddon)
      xterm.loadAddon(webLinksAddon)

      // Open terminal
      xterm.open(terminalRef.current)

      // Store refs
      xtermRef.current = xterm
      fitAddonRef.current = fitAddon

      // Fit terminal to container
      setTimeout(() => fitAddon.fit(), 50)

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
      console.log(`✅ Terminal created: ${result.terminalId}`)

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

  const handleClearTerminal = () => {
    if (xtermRef.current) {
      xtermRef.current.clear()
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
            onClick={handleClearTerminal}
            title="Clear Terminal"
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
