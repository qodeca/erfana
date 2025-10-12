import { ISplitviewPanelProps } from 'dockview'
import { Bot, Sparkles } from 'lucide-react'
import './AiAssistantPanel.css'

export function AiAssistantPanel(_props: ISplitviewPanelProps) {
  return (
    <div className="ai-assistant-panel sidebar-panel">
      <div className="sidebar-panel-header">
        <Bot size={16} className="panel-header-icon" />
        <span className="sidebar-panel-title">AI Assistant</span>
      </div>
      <div className="sidebar-panel-content">
        <div className="ai-welcome">
          <div className="ai-welcome-icon">
            <Sparkles size={48} strokeWidth={1.5} />
          </div>
          <h3>Claude AI Assistant</h3>
          <p>Your intelligent coding companion powered by Claude.</p>

          <div className="ai-features">
            <div className="ai-feature-item">
              <strong>💬 Chat</strong>
              <span>Ask questions about your code</span>
            </div>
            <div className="ai-feature-item">
              <strong>✨ Generate</strong>
              <span>Create code from descriptions</span>
            </div>
            <div className="ai-feature-item">
              <strong>🔍 Analyze</strong>
              <span>Review and improve your code</span>
            </div>
            <div className="ai-feature-item">
              <strong>📝 Document</strong>
              <span>Generate documentation</span>
            </div>
          </div>

          <div className="ai-status">
            <div className="status-badge status-pending">
              <span className="status-dot"></span>
              <span>Integration in progress</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
