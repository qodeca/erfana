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
- [Terminal](./terminal/README.md) - xterm.js terminal integration
  - [Bootstrap Pattern](./terminal/bootstrap-pattern.md) - Clean initialization without artifacts
  - [Scroll Fixes](./terminal/scroll-fixes.md) - v0.3.1 scroll preservation and scroll to bottom button
  - [Flickering Prevention](./terminal/flickering-prevention.md) - v0.3.2 rendering stability fixes
  - [Troubleshooting](./terminal/troubleshooting.md) - Known issues and solutions
- [Project Panel](./project-panel.md) - File explorer and project management
- [Drag-Drop](./drag-drop/README.md) - VS Code-style file reorganization with keyboard shortcuts
- [File Watching](./file-watching/README.md) - Auto-refresh and file monitoring
  - [Patterns & Testing](./file-watching/patterns-and-testing.md) - Implementation patterns and test scenarios
  - [Technical Details](./file-watching/technical-details.md) - Performance, security, edge cases
- [Prompt Templates](./prompts/README.md) - AI-powered text operations (v0.3.4)
  - [AutoExecute Overview](./prompts/autoexecute-overview.md) - Feature overview and architecture
  - [AutoExecute Technical](./prompts/autoexecute-technical.md) - Write pipeline and 200ms delay rationale
  - [AutoExecute Testing](./prompts/autoexecute-testing.md) - Test coverage and mocking strategy
  - [AutoExecute Reference](./prompts/autoexecute-reference.md) - Implementation files and error handling
- [Keyboard Shortcuts](./keyboard-shortcuts.md) - Application keyboard shortcuts
- [UI Components](./ui-components.md) - React component architecture

### Development
- [Development Tasks](./development-tasks.md) - Build, test, and deployment
- [Build Optimization](./build/build-optimization.md) - electron-builder configuration and size optimization
- [Testing](./testing/README.md) - Testing strategies and scenarios
  - [Automated Testing Plan](./testing/automated-testing-plan.md) - Phased rollout and setup
  - [Quick Checks](./testing/quick-checks.md) - Minimal Terminal/Watcher smoke checks
- [EPIPE Error Handling](./epipe-error-handling.md) - Console output error prevention

### Troubleshooting
- [Known Issues](./known-issues.md) - Current limitations and workarounds
- [Troubleshooting](./troubleshooting.md) - Common problems and solutions
- [Advanced Troubleshooting](./troubleshooting-advanced.md) - Deep debugging techniques

### Claude Code Integration
- [GitHub Issues Protocol](./claude-code/github-issues-protocol.md) - When/how Claude Code uses `gh` CLI for issues

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

## Future Features

Documentation for planned but not yet implemented features is located in [`./future/`](./future/):
- [Graph Engine](./future/graph-engine.md) - Planned SQLite-based knowledge graph with hybrid search (not yet implemented)
