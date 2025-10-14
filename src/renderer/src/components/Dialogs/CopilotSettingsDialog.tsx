/**
 * CopilotSettingsDialog Component
 *
 * Modal dialog for configuring Copilot settings (tool authorization, etc.).
 * Accessed from Copilot Control Panel, displays blocking modal overlay.
 */

import { useState, useEffect } from 'react'
import { Settings, AlertCircle } from 'lucide-react'
import { isValidClaudeTool } from '../../constants/claude-tools'
import './CopilotSettingsDialog.css'

interface ToolCategory {
  name: string
  tools: Array<{
    id: string
    name: string
    description: string
  }>
}

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    name: 'File Operations',
    tools: [
      { id: 'Read', name: 'Read', description: 'Read file contents' },
      { id: 'Write', name: 'Write', description: 'Create or overwrite files' },
      { id: 'Edit', name: 'Edit', description: 'Modify existing files' },
      { id: 'MultiEdit', name: 'MultiEdit', description: 'Batch file modifications' },
      { id: 'Glob', name: 'Glob', description: 'Search files by pattern' },
      { id: 'Grep', name: 'Grep', description: 'Search file contents' },
      { id: 'LS', name: 'LS', description: 'List directory contents' }
    ]
  },
  {
    name: 'System Operations',
    tools: [{ id: 'Bash', name: 'Bash', description: 'Execute shell commands' }]
  },
  {
    name: 'AI & Web',
    tools: [
      { id: 'WebSearch', name: 'WebSearch', description: 'Search the web' },
      { id: 'WebFetch', name: 'WebFetch', description: 'Fetch web content' },
      { id: 'Task', name: 'Task', description: 'Delegate to agent' }
    ]
  },
  {
    name: 'Workflow & Tasks',
    tools: [
      { id: 'TodoRead', name: 'TodoRead', description: 'Read to-do list' },
      { id: 'TodoWrite', name: 'TodoWrite', description: 'Manage tasks' },
      { id: 'SlashCommand', name: 'SlashCommand', description: 'Custom commands' },
      { id: 'ExitPlanMode', name: 'ExitPlanMode', description: 'Exit planning' }
    ]
  },
  {
    name: 'Jupyter Notebooks',
    tools: [
      { id: 'NotebookRead', name: 'NotebookRead', description: 'Read .ipynb files' },
      { id: 'NotebookEdit', name: 'NotebookEdit', description: 'Edit notebook cells' }
    ]
  }
]

// Critical tools that should be enabled for basic functionality
const CRITICAL_TOOLS = ['Read', 'LS', 'Grep']

interface CopilotSettingsDialogProps {
  initialTools: string[]
  onClose: () => void
  onSave: (approvedTools: string[]) => Promise<void>
}

export function CopilotSettingsDialog({ initialTools, onClose, onSave }: CopilotSettingsDialogProps) {
  const [enableAll, setEnableAll] = useState(true)
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [warningMessage, setWarningMessage] = useState<string | null>(null)

  // Initialize from props on mount
  useEffect(() => {
    const toolsSet = new Set(initialTools)
    setSelectedTools(toolsSet)

    // Check if all 17 tools are enabled
    const allTools = TOOL_CATEGORIES.flatMap((cat) => cat.tools.map((t) => t.id))
    const allEnabled = allTools.every((tool) => toolsSet.has(tool))
    setEnableAll(allEnabled)

    setIsLoading(false)
  }, [])

  // Watch for external tool changes (e.g., approval via dialog while settings is open)
  useEffect(() => {
    const toolsSet = new Set(initialTools)
    setSelectedTools(toolsSet)

    // Update "Enable all" state
    const allTools = TOOL_CATEGORIES.flatMap((cat) => cat.tools.map((t) => t.id))
    const allEnabled = allTools.every((tool) => toolsSet.has(tool))
    setEnableAll(allEnabled)

    console.log('🔄 Settings dialog updated with new tools from parent:', initialTools)
  }, [initialTools])

  // Validate selected tools and show warnings
  const validateSelection = (tools: Set<string>): { isValid: boolean; warning: string | null } => {
    // FIXED: At least one tool must be selected
    if (tools.size === 0) {
      return {
        isValid: false,
        warning: 'At least one tool must be selected. Copilot cannot function without any tools.'
      }
    }

    // FIXED: All tools must be valid
    const invalidTools = Array.from(tools).filter((tool) => !isValidClaudeTool(tool))
    if (invalidTools.length > 0) {
      return {
        isValid: false,
        warning: `Invalid tools selected: ${invalidTools.join(', ')}. Please reset settings.`
      }
    }

    // FIXED: Warn if critical tools are disabled
    const disabledCriticalTools = CRITICAL_TOOLS.filter((tool) => !tools.has(tool))
    if (disabledCriticalTools.length > 0) {
      return {
        isValid: true,
        warning: `Warning: Critical tools disabled (${disabledCriticalTools.join(', ')}). Copilot may have limited functionality.`
      }
    }

    return { isValid: true, warning: null }
  }

  // Update validation whenever selection changes
  useEffect(() => {
    const { isValid, warning } = validateSelection(selectedTools)
    setWarningMessage(warning)

    // Clear error if selection becomes valid
    if (isValid && errorMessage?.includes('At least one tool')) {
      setErrorMessage(null)
    }
  }, [selectedTools])

  // Handle global toggle
  const handleEnableAllToggle = () => {
    const newEnableAll = !enableAll
    setEnableAll(newEnableAll)

    if (newEnableAll) {
      // Enable all 17 tools
      const allTools = TOOL_CATEGORIES.flatMap((cat) => cat.tools.map((t) => t.id))
      setSelectedTools(new Set(allTools))
    }

    setHasUnsavedChanges(true)
  }

  // Handle individual tool toggle
  const handleToolToggle = (toolId: string) => {
    if (enableAll) return // Disabled when global toggle is on

    const newSelected = new Set(selectedTools)
    if (newSelected.has(toolId)) {
      newSelected.delete(toolId)
    } else {
      newSelected.add(toolId)
    }

    setSelectedTools(newSelected)
    setHasUnsavedChanges(true)
  }

  // Handle reset
  const handleReset = () => {
    setShowResetConfirm(true)
  }

  const confirmReset = () => {
    setEnableAll(true)
    const allTools = TOOL_CATEGORIES.flatMap((cat) => cat.tools.map((t) => t.id))
    setSelectedTools(new Set(allTools))
    setShowResetConfirm(false)
    setHasUnsavedChanges(true)
    setWarningMessage(null)
    setErrorMessage(null)
  }

  const cancelReset = () => {
    setShowResetConfirm(false)
  }

  // Handle save
  const handleSave = async () => {
    setIsSaving(true)
    setErrorMessage(null)

    try {
      const toolsArray = Array.from(selectedTools)

      // FIXED: Validate before saving
      const { isValid, warning } = validateSelection(selectedTools)

      if (!isValid) {
        setErrorMessage(
          warning || 'Invalid tool selection. Please select at least one valid tool.'
        )
        setIsSaving(false)
        return
      }

      // Show warning if critical tools disabled, but allow save
      if (warning && !window.confirm(`${warning}\n\nDo you want to continue?`)) {
        setIsSaving(false)
        return
      }

      await onSave(toolsArray)
      setHasUnsavedChanges(false)
      onClose()
    } catch (error: any) {
      console.error('Failed to save settings:', error)
      setErrorMessage(error?.message || 'Failed to save settings and restart session')
    } finally {
      setIsSaving(false)
    }
  }

  // Handle cancel
  const handleCancel = () => {
    if (hasUnsavedChanges) {
      if (window.confirm('Discard unsaved changes?')) {
        onClose()
      }
    } else {
      onClose()
    }
  }

  // Handle ESC key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isSaving) {
      handleCancel()
    }
  }

  // Handle overlay click
  const handleOverlayClick = () => {
    if (!isSaving) {
      handleCancel()
    }
  }

  return (
    <div className="copilot-settings-overlay" onClick={handleOverlayClick}>
      <div
        className="copilot-settings-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="copilot-settings-header">
          <Settings size={24} className="settings-icon" />
          <h2>Copilot Configuration</h2>
        </div>

        {/* Body */}
        <div className="copilot-settings-body">
          {isLoading ? (
            <div className="settings-loading">
              <div className="loading-spinner"></div>
              <p>Loading settings...</p>
            </div>
          ) : (
            <>
              <div className="settings-section">
                <h3>Tool Authorization</h3>
                <p className="section-description">
                  Configure which tools Copilot can use without requiring approval.
                </p>

                {/* Global Toggle */}
                <div className="global-toggle-container">
                  <label className="global-toggle-label">
                    <input
                      type="checkbox"
                      checked={enableAll}
                      onChange={handleEnableAllToggle}
                      className="global-toggle-checkbox"
                    />
                    <span>Enable all tools by default</span>
                  </label>
                  {enableAll && (
                    <p className="global-toggle-hint">
                      All 17 tools are enabled. Uncheck to customize individual tools.
                    </p>
                  )}
                </div>

                {/* Tool Categories */}
                <div className="tool-categories-container">
                  <div className="tool-categories-header">
                    Individual Tools ({selectedTools.size} of 17 selected)
                  </div>

                  {TOOL_CATEGORIES.map((category) => (
                    <div key={category.name} className="tool-category">
                      <div className="category-label">{category.name}</div>
                      <div className="category-tools">
                        {category.tools.map((tool) => (
                          <div key={tool.id} className="tool-row">
                            <label className="tool-label">
                              <input
                                type="checkbox"
                                checked={selectedTools.has(tool.id)}
                                disabled={enableAll}
                                onChange={() => handleToolToggle(tool.id)}
                                className="tool-checkbox"
                              />
                              <span className="tool-name">{tool.name}</span>
                              <span className="tool-description">{tool.description}</span>
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="copilot-settings-footer">
          <div className="footer-info">
            {errorMessage ? (
              <div className="footer-error">
                <AlertCircle size={14} />
                <span>{errorMessage}</span>
              </div>
            ) : warningMessage ? (
              <div className="footer-warning">
                <AlertCircle size={14} />
                <span>{warningMessage}</span>
              </div>
            ) : (
              <div className="footer-hint">
                <span>ⓘ Changes will restart the Copilot session</span>
              </div>
            )}
          </div>
          <div className="footer-actions">
            <button className="reset-button" onClick={handleReset} disabled={isSaving || isLoading}>
              {showResetConfirm ? (
                <span className="reset-confirm">
                  Reset to defaults?
                  <button className="reset-yes" onClick={confirmReset}>
                    Yes
                  </button>
                  <button className="reset-no" onClick={cancelReset}>
                    No
                  </button>
                </span>
              ) : (
                'Reset to Defaults'
              )}
            </button>
            <div className="action-buttons">
              <button className="cancel-button" onClick={handleCancel} disabled={isSaving}>
                Cancel
              </button>
              <button
                className="save-button"
                onClick={handleSave}
                disabled={!hasUnsavedChanges || isSaving || isLoading}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
