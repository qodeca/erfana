/**
 * CopilotPanel Component
 *
 * Generic AI assistant interface powered by Claude CLI.
 * Designed to support multiple AI providers in the future.
 *
 * Current implementation: ClaudeCliService for Claude Code integration
 */

import { useState, useEffect } from 'react'
import { ISplitviewPanelProps } from 'dockview'
import { Bot, LogIn, Download, RefreshCw } from 'lucide-react'
import { CopilotChat } from '../Copilot/CopilotChat'
import './CopilotPanel.css'

type SessionState = 'stopped' | 'starting' | 'ready' | 'error'

export function CopilotPanel(_props: ISplitviewPanelProps) {
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [isChecking, setIsChecking] = useState(true)
  const [tokenInput, setTokenInput] = useState('')
  const [isSettingToken, setIsSettingToken] = useState(false)

  // Session state
  const [sessionState, setSessionState] = useState<SessionState>('stopped')
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [restartAttempt, setRestartAttempt] = useState<{ current: number; max: number } | null>(
    null
  )

  // Check Claude CLI status on mount
  useEffect(() => {
    checkClaudeStatus()
  }, [])

  // Start session when authenticated
  useEffect(() => {
    if (isAuthenticated && sessionState === 'stopped') {
      startSession()
    }

    // Cleanup: stop session on unmount
    return () => {
      if (sessionState !== 'stopped') {
        console.log('🛑 Component unmounting, stopping session')
        window.api.claudeCode.stopSession()
      }
    }
  }, [isAuthenticated])

  // Listen to session events
  useEffect(() => {
    const unsubscribeStarted = window.api.claudeCode.onSessionStarted((data) => {
      console.log('✅ Session started:', data.projectPath)
      setSessionState('ready')
      setSessionError(null)
      setRestartAttempt(null)
    })

    const unsubscribeStopped = window.api.claudeCode.onSessionStopped(() => {
      console.log('🛑 Session stopped')
      setSessionState('stopped')
    })

    const unsubscribeRestarting = window.api.claudeCode.onSessionRestarting((data) => {
      console.log(`🔄 Session restarting: ${data.attempt}/${data.maxAttempts}`)
      setSessionState('starting')
      setRestartAttempt({ current: data.attempt, max: data.maxAttempts })
    })

    const unsubscribeError = window.api.claudeCode.onSessionError((error) => {
      console.error('❌ Session error:', error)
      setSessionState('error')
      setSessionError(error.message)

      // If not recoverable, mark as authentication failure
      if (!error.recoverable) {
        setIsAuthenticated(false)
        setAuthError(error.message)
      }
    })

    return () => {
      unsubscribeStarted()
      unsubscribeStopped()
      unsubscribeRestarting()
      unsubscribeError()
    }
  }, [])

  const checkClaudeStatus = async () => {
    setIsChecking(true)

    try {
      // Check if installed
      const installed = await window.api.claudeCode.isInstalled()
      setIsInstalled(installed)

      if (installed) {
        // Check authentication
        const authStatus = await window.api.claudeCode.checkAuth()
        setIsAuthenticated(authStatus.isAuthenticated)
        setAuthError(authStatus.error || null)
      }
    } catch (err: any) {
      console.error('Error checking Claude status:', err)
      setIsInstalled(false)
      setIsAuthenticated(false)
      setAuthError(err.message)
    } finally {
      setIsChecking(false)
    }
  }

  const startSession = async () => {
    try {
      setSessionState('starting')
      setSessionError(null)

      // Get project path from API
      const projectPath = await window.api.file.getProjectPath()

      if (!projectPath) {
        throw new Error('No project path available')
      }

      console.log(`🚀 Starting Claude session for: ${projectPath}`)

      const result = await window.api.claudeCode.startSession(projectPath)

      if (!result.success) {
        throw new Error(result.error || 'Failed to start session')
      }

      // Session state will be updated via event listener
    } catch (err: any) {
      console.error('Failed to start session:', err)
      setSessionState('error')
      setSessionError(err.message)
    }
  }

  const handleSetToken = async () => {
    if (!tokenInput.trim()) {
      setAuthError('Please enter a valid token')
      return
    }

    setIsSettingToken(true)
    setAuthError(null)

    try {
      const result = await window.api.claudeCode.setToken(tokenInput.trim())

      if (result.success) {
        // Clear token input for security
        setTokenInput('')
        // Re-check authentication
        await checkClaudeStatus()
      } else {
        setAuthError(result.error || 'Failed to set token')
      }
    } catch (err: any) {
      console.error('Error setting token:', err)
      setAuthError(err.message)
    } finally {
      setIsSettingToken(false)
    }
  }

  const handleRestartSession = async () => {
    console.log('🔄 Manual session restart requested')
    try {
      await window.api.claudeCode.stopSession()
      setSessionState('stopped')
      await new Promise((resolve) => setTimeout(resolve, 500))
      await startSession()
    } catch (err: any) {
      console.error('Failed to restart session:', err)
      setSessionError(err.message)
    }
  }

  return (
    <div className="copilot-panel sidebar-panel">
      <div className="sidebar-panel-header">
        {sessionState === 'ready' && <span className="session-indicator ready">●</span>}
        {sessionState === 'starting' && <span className="session-indicator starting">●</span>}
        {sessionState === 'error' && <span className="session-indicator error">●</span>}
        <Bot size={16} className="panel-header-icon" />
        <span className="sidebar-panel-title">Copilot</span>
      </div>
      <div className="sidebar-panel-content">
        {isChecking ? (
          // Loading state
          <div className="copilot-loading">
            <div className="loading-spinner"></div>
            <p>Checking Claude CLI status...</p>
          </div>
        ) : !isInstalled ? (
          // Not installed - Show installation guide
          <div className="claude-setup">
            <div className="setup-icon">
              <Download size={48} strokeWidth={1.5} />
            </div>
            <h3>Install Claude CLI</h3>
            <p>
              Claude CLI is not installed on your system. Install it to use Claude Code with your
              MAX subscription.
            </p>

            <div className="setup-help">
              <p>
                <strong>Installation Instructions:</strong>
              </p>
              <div className="install-commands">
                <div className="install-option">
                  <strong>macOS (Homebrew):</strong>
                  <code className="install-code">brew install anthropics/tap/claude</code>
                </div>
                <div className="install-option">
                  <strong>Other Platforms:</strong>
                  <p>
                    Visit the{' '}
                    <a
                      href="https://docs.claude.com/en/docs/claude-code/installation"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Claude Code Installation Guide
                    </a>
                  </p>
                </div>
              </div>

              <button onClick={checkClaudeStatus} className="setup-button">
                Check Again
              </button>

              <p className="help-note">
                After installation, restart Erfana and Claude CLI will be detected automatically.
              </p>
            </div>
          </div>
        ) : !isAuthenticated ? (
          // Not authenticated - Show login guide
          <div className="claude-setup">
            <div className="setup-icon">
              <LogIn size={48} strokeWidth={1.5} />
            </div>
            <h3>Authenticate Claude CLI</h3>
            <p>Paste your Claude OAuth token to authenticate with your MAX subscription.</p>

            {authError && <div className="setup-error">{authError}</div>}

            <div className="setup-form">
              <div className="form-group">
                <label htmlFor="token-input">OAuth Token:</label>
                <input
                  id="token-input"
                  type="password"
                  className="api-key-input"
                  placeholder="sk-ant-oat01-..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isSettingToken) {
                      handleSetToken()
                    }
                  }}
                  disabled={isSettingToken}
                />
              </div>

              <button
                onClick={handleSetToken}
                className="setup-button"
                disabled={isSettingToken || !tokenInput.trim()}
              >
                {isSettingToken ? 'Setting Token...' : 'Connect'}
              </button>
            </div>

            <div className="setup-help">
              <p>
                <strong>How to get your token:</strong>
              </p>
              <ol>
                <li>Open your terminal</li>
                <li>
                  Run: <code className="inline-code">claude setup-token</code>
                </li>
                <li>Copy the generated token</li>
                <li>Paste it above and click "Connect"</li>
              </ol>

              <p className="help-note">
                ✨ Using your Claude MAX subscription - no API key or additional costs required!
              </p>
            </div>
          </div>
        ) : sessionState === 'starting' ? (
          // Starting session
          <div className="copilot-loading">
            <div className="loading-spinner"></div>
            {restartAttempt ? (
              <p>
                Reconnecting to Claude... (attempt {restartAttempt.current}/{restartAttempt.max})
              </p>
            ) : (
              <p>Starting Copilot...</p>
            )}
          </div>
        ) : sessionState === 'error' ? (
          // Session error
          <div className="claude-setup">
            <div className="setup-icon">
              <RefreshCw size={48} strokeWidth={1.5} />
            </div>
            <h3>Session Error</h3>
            <p className="setup-error">{sessionError || 'Unknown error'}</p>

            <button onClick={handleRestartSession} className="setup-button">
              Restart Session
            </button>
          </div>
        ) : (
          // Session ready - Show chat interface
          <CopilotChat />
        )}
      </div>
    </div>
  )
}
