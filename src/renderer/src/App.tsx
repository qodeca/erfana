// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import './App.css'
import { useEffect } from 'react'
import { AppDockLayout } from './components/DockLayout/AppDockLayout'
import { ToastProvider } from './components/Toast/ToastContext'
import { ToastNotification } from './components/Toast/ToastNotification'
import { DialogProvider } from './components/Dialog/DialogContext'
import { DialogManager } from './components/Dialog/DialogManager'
import { SettingsOverlay } from './components/Settings/SettingsOverlay'
import { UIBlocker } from './components/UIBlocker/UIBlocker'
import { TranscriptionDialog } from './components/Transcription/TranscriptionDialog'
import { DocumentImportDialog } from './components/DocumentImport/DocumentImportDialog'
import { ProjectManagementProvider } from './context/ProjectManagementContext'
import { TerminalPortalProvider } from './context/TerminalPortalContext'
import { useGlobalSettingsInit } from './hooks/useGlobalSettingsInit'
import { useQuitHandler } from './hooks/useQuitHandler'
import { useGlobalSettingsStore } from './stores/useGlobalSettingsStore'
import { useClaudeStatusStore } from './stores/useClaudeStatusStore'
import { initializeLogger, logger } from './utils/logger'

/**
 * Inner app content that requires DialogProvider context.
 * Separated from App to ensure useQuitHandler() is called
 * inside DialogProvider (it needs useDialog() from that context).
 */
function AppContent() {
  const loggingLevel = useGlobalSettingsStore((state) => state.settings?.logging.level)

  // Initialize global settings
  useGlobalSettingsInit()

  // Handle quit confirmation (must be within DialogProvider - hence in AppContent)
  useQuitHandler()

  // Initialize logger on mount
  useEffect(() => {
    initializeLogger().catch((error) => {
      console.error('Failed to initialize logger:', error)
    })
  }, [])

  // Sync logger level with settings changes
  useEffect(() => {
    if (loggingLevel) {
      logger.setLevel(loggingLevel)
    }
  }, [loggingLevel])

  // Single global subscription for per-terminal Claude Code status (issue #216).
  // AppContent is always mounted, so this owns the one onChanged listener and
  // routes every payload into the store; individual ClaudeStatusBar instances
  // read only their own slice. Guarded so environments without the bridge
  // (e.g. tests) do not crash.
  useEffect(() => {
    const unsubscribe = window.api?.claudeStatus?.onChanged((payload) => {
      useClaudeStatusStore.getState().setSnapshot(payload)
    })
    return unsubscribe
  }, [])

  return (
    <ProjectManagementProvider>
      <TerminalPortalProvider>
        <ToastProvider>
          <div className="app">
            <AppDockLayout />
            <ToastNotification />
            <DialogManager />
            <SettingsOverlay />
            <UIBlocker />
            <TranscriptionDialog />
            <DocumentImportDialog />
          </div>
        </ToastProvider>
      </TerminalPortalProvider>
    </ProjectManagementProvider>
  )
}

function App() {
  return (
    <DialogProvider>
      <AppContent />
    </DialogProvider>
  )
}

export default App
