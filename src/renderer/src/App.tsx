import './App.css'
import { AppDockLayout } from './components/DockLayout/AppDockLayout'
import { ToastProvider } from './components/Toast/ToastContext'
import { ToastNotification } from './components/Toast/ToastNotification'
import { DialogProvider } from './components/Dialog/DialogContext'
import { DialogManager } from './components/Dialog/DialogManager'

function App() {
  return (
    <DialogProvider>
      <ToastProvider>
        <div className="app">
          <AppDockLayout />
          <ToastNotification />
          <DialogManager />
        </div>
      </ToastProvider>
    </DialogProvider>
  )
}

export default App
