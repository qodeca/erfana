import './App.css'
import { useEffect } from 'react'
import { AppDockLayout } from './components/DockLayout/AppDockLayout'
import { ToastProvider } from './components/Toast/ToastContext'
import { ToastNotification } from './components/Toast/ToastNotification'
import { DialogProvider } from './components/Dialog/DialogContext'
import { DialogManager } from './components/Dialog/DialogManager'
import { SettingsOverlay } from './components/Settings/SettingsOverlay'
import { UIBlocker } from './components/UIBlocker/UIBlocker'
import { ProjectManagementProvider } from './context/ProjectManagementContext'
import { TerminalPortalProvider } from './context/TerminalPortalContext'
import { useGlobalSettingsInit } from './hooks/useGlobalSettingsInit'
import { useGlobalSettingsStore } from './stores/useGlobalSettingsStore'
import { initializeLogger, logger } from './utils/logger'

function App() {
  const loggingLevel = useGlobalSettingsStore((state) => state.settings?.logging.level)

  // Initialize global settings
  useGlobalSettingsInit()

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
    <DialogProvider>
      <ProjectManagementProvider>
        <TerminalPortalProvider>
          <ToastProvider>
            <div className="app">
              <AppDockLayout />
              <ToastNotification />
              <DialogManager />
              <SettingsOverlay />
              <UIBlocker />
            </div>
          </ToastProvider>
        </TerminalPortalProvider>
      </ProjectManagementProvider>
    </DialogProvider>
  )
}

export default App
