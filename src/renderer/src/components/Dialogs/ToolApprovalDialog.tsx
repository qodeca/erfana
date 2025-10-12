/**
 * ToolApprovalDialog Component
 *
 * Modal dialog shown when Claude wants to use a tool that hasn't been approved.
 * Allows users to approve or deny the tool use, with option to remember the choice.
 */

import { useState } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import './ToolApprovalDialog.css'

export interface ToolApprovalRequest {
  toolName: string
  toolId: string
  input: any
  description: string
}

interface ToolApprovalDialogProps {
  request: ToolApprovalRequest
  onApprove: (remember: boolean) => void
  onDeny: () => void
}

export function ToolApprovalDialog({ request, onApprove, onDeny }: ToolApprovalDialogProps) {
  const [remember, setRemember] = useState(false)
  const [showParams, setShowParams] = useState(false)

  const handleApprove = () => {
    onApprove(remember)
  }

  const handleDeny = () => {
    onDeny()
  }

  // Format tool parameters for display
  const formattedInput = JSON.stringify(request.input, null, 2)

  return (
    <div className="tool-approval-overlay" onClick={handleDeny}>
      <div className="tool-approval-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="tool-approval-header">
          <AlertTriangle size={24} className="warning-icon" />
          <h2>Tool Approval Required</h2>
        </div>

        {/* Tool Info */}
        <div className="tool-approval-body">
          <div className="tool-info">
            <div className="tool-name-section">
              <label>Tool:</label>
              <span className="tool-name">{request.toolName}</span>
            </div>

            <div className="tool-description">
              <label>Description:</label>
              <p>{request.description}</p>
            </div>

            {/* Parameters (collapsible) */}
            {request.input && Object.keys(request.input).length > 0 && (
              <div className="tool-parameters">
                <button
                  className="parameters-toggle"
                  onClick={() => setShowParams(!showParams)}
                >
                  {showParams ? '▼' : '▶'} View Parameters
                </button>
                {showParams && (
                  <pre className="tool-params-content">{formattedInput}</pre>
                )}
              </div>
            )}
          </div>

          {/* Remember Choice */}
          <div className="tool-approval-options">
            <label className="remember-checkbox">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>Remember this choice for future sessions</span>
            </label>
            <p className="remember-hint">
              {remember
                ? `${request.toolName} will be automatically approved in the future`
                : 'You will be asked again next time'}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="tool-approval-actions">
          <button className="deny-button" onClick={handleDeny}>
            <X size={16} />
            Deny
          </button>
          <button className="approve-button" onClick={handleApprove}>
            <Check size={16} />
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
