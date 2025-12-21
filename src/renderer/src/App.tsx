import './App.css'
import { AppDockLayout } from './components/DockLayout/AppDockLayout'
import { ToastProvider } from './components/Toast/ToastContext'
import { ToastNotification } from './components/Toast/ToastNotification'
import { DialogProvider } from './components/Dialog/DialogContext'
import { DialogManager } from './components/Dialog/DialogManager'
import { SettingsOverlay } from './components/Settings/SettingsOverlay'
import { UIBlocker } from './components/UIBlocker/UIBlocker'
import { ProjectManagementProvider } from './context/ProjectManagementContext'
import { TerminalPortalProvider } from './context/TerminalPortalContext'

function App() {
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
