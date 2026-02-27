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
import { ProjectManagementProvider } from './context/ProjectManagementContext'
import { TerminalPortalProvider } from './context/TerminalPortalContext'
import { useGlobalSettingsInit } from './hooks/useGlobalSettingsInit'
import { useQuitHandler } from './hooks/useQuitHandler'
import { useGlobalSettingsStore } from './stores/useGlobalSettingsStore'
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
