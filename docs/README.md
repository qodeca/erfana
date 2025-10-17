# ERFANA Documentation

## Overview
ERFANA is an Electron-based IDE focused on markdown editing with integrated terminal and project management.

## Documentation Structure

### Core Documentation
- [Architecture](./architecture.md) - System architecture and design patterns
- [API Services](./api-services.md) - Main process services and IPC handlers
- [IPC Patterns](./ipc-patterns.md) - Inter-process communication patterns
- [Security](./security.md) - Security considerations and implementations

### Feature Documentation
- [Editor](./editor/README.md) - Monaco editor, markdown preview, and scroll sync
- [Terminal](./terminal.md) - xterm.js terminal integration
- [Project Panel](./project-panel.md) - File explorer and project management
- [File Watching](./file-watching.md) - Auto-refresh and file monitoring
- [Prompt Templates](./prompts/README.md) - AI-powered text operations
- [Keyboard Shortcuts](./keyboard-shortcuts.md) - Application keyboard shortcuts
- [UI Components](./ui-components.md) - React component architecture

### Development
- [Development Tasks](./development-tasks.md) - Build, test, and deployment
- [Testing](./testing/README.md) - Testing strategies and scenarios
  - [Automated Testing Plan](./testing/automated-testing-plan.md) - Phased rollout and setup
- [EPIPE Error Handling](./epipe-error-handling.md) - Console output error prevention

### Troubleshooting
- [Known Issues](./known-issues.md) - Current limitations and workarounds
- [Troubleshooting](./troubleshooting.md) - Common problems and solutions
- [Advanced Troubleshooting](./troubleshooting-advanced.md) - Deep debugging techniques

### Technical Details
- [HTML Rendering](./rendering/README.md) - Markdown to HTML conversion architecture

## Quick Links

### For Development
1. Start with [Architecture](./architecture.md)
2. Review [Development Tasks](./development-tasks.md)
3. Check [API Services](./api-services.md)

### For Feature Implementation
1. See relevant feature documentation above
2. Review [IPC Patterns](./ipc-patterns.md)
3. Check [UI Components](./ui-components.md)

### For Debugging
1. Check [Known Issues](./known-issues.md)
2. Review [Troubleshooting](./troubleshooting.md)
3. See [EPIPE Error Handling](./epipe-error-handling.md) for console issues
