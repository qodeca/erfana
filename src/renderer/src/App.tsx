import './App.css'
import { AppDockLayout } from './components/DockLayout/AppDockLayout'
import { ToastProvider } from './components/Toast/ToastContext'
import { ToastNotification } from './components/Toast/ToastNotification'

function App() {
  return (
    <ToastProvider>
      <div className="app">
        <AppDockLayout />
        <ToastNotification />
      </div>
    </ToastProvider>
  )
}

export default App
