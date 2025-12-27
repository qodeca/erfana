import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react'
import { useToast, Toast } from './ToastContext'
import { TEST_IDS } from '../../constants/testids'
import './Toast.css'

const ICON_MAP = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info
}

export function ToastNotification() {
  const { toasts, removeToast } = useToast()

  if (toasts.length === 0) return null

  return (
    <div className="toast-container" data-testid={TEST_IDS.TOAST_CONTAINER}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon = ICON_MAP[toast.type]

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className={`toast toast-${toast.type}`} data-testid={`${TEST_IDS.TOAST}-${toast.type}`}>
      <div className="toast-icon">
        <Icon size={20} strokeWidth={2} />
      </div>
      <div className="toast-content">
        <div className="toast-title">{toast.title}</div>
        <div className="toast-message" data-testid={TEST_IDS.TOAST_MESSAGE}>{toast.message}</div>
      </div>
      <button
        className="toast-close"
        onClick={onClose}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        aria-label="Close"
        data-testid={TEST_IDS.TOAST_BTN_DISMISS}
      >
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  )
}
