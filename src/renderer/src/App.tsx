import './App.css'
import { AppDockLayout } from './components/DockLayout/AppDockLayout'
import { ToastProvider } from './components/Toast/ToastContext'
import { ToastNotification } from './components/Toast/ToastNotification'
import { DialogProvider } from './components/Dialog/DialogContext'
import { DialogManager } from './components/Dialog/DialogManager'
import { UIBlocker } from './components/UIBlocker/UIBlocker'
import { ProjectManagementProvider } from './context/ProjectManagementContext'

function App() {
  return (
    <DialogProvider>
      <ProjectManagementProvider>
        <ToastProvider>
          <div className="app">
            <AppDockLayout />
            <ToastNotification />
            <DialogManager />
            <UIBlocker />
          </div>
        </ToastProvider>
      </ProjectManagementProvider>
    </DialogProvider>
  )
}

export default App
