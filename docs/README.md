# ERFANA Documentation

## Overview
ERFANA is an Electron-based IDE focused on markdown editing with integrated terminal and project management.

## Documentation Structure

### Core Documentation
- [Architecture](./architecture.md) - System architecture and design patterns
- [API Services](./api-services.md) - Main process services and IPC handlers
- [IPC Patterns](./ipc-patterns.md) - Inter-process communication patterns
- [Security](./security.md) - Security considerations and implementations
- [Technical Debt](./technical-debt.md) - Technical debt tracking and priorities

### Feature Documentation
- [Editor](./editor/README.md) - Monaco editor, markdown preview, scroll sync, Mermaid diagrams (full-screen viewer), PDF/DOCX export
- [Image Viewer](./ui-components.md#image-viewer-panel) - Image preview panel with zoom, pan, and fullscreen
- [Terminal](./terminal/README.md) - xterm.js terminal integration
  - [Bootstrap Pattern](./terminal/bootstrap-pattern.md) - Clean initialization without artifacts
  - [Scroll Fixes](./terminal/scroll-fixes.md) - v0.3.1 scroll preservation and scroll to bottom button
  - [Flickering Prevention](./terminal/flickering-prevention.md) - v0.3.2 rendering stability fixes
  - [Troubleshooting](./terminal/troubleshooting.md) - Known issues and solutions
- [Project Panel](./project-panel.md) - File explorer and project management
- [Drag-Drop](./drag-drop/README.md) - VS Code-style file reorganization, external file drop, keyboard shortcuts
- [File Watching](./file-watching/README.md) - Auto-refresh and file monitoring
  - [Patterns & Testing](./file-watching/patterns-and-testing.md) - Implementation patterns and test scenarios
  - [Technical Details](./file-watching/technical-details.md) - Performance, security, edge cases
- [Prompt Templates](./prompts/README.md) - AI-powered text operations (v0.3.4)
  - [AutoExecute Overview](./prompts/autoexecute-overview.md) - Feature overview and architecture
  - [AutoExecute Technical](./prompts/autoexecute-technical.md) - Write pipeline and 200ms delay rationale
  - [AutoExecute Testing](./prompts/autoexecute-testing.md) - Test coverage and mocking strategy
  - [AutoExecute Reference](./prompts/autoexecute-reference.md) - Implementation files and error handling
- [Logging](./logging.md) - Logging layer, log levels, file rotation, settings
- [Audio Transcription](./api-services-features.md#transcriptionservice) - OpenAI-powered audio import (MP3, WAV, M4A, OGG, FLAC)
- [Settings](./settings.md) - Editor, git, logging, and transcription configuration

### UI/UX
- [UI Style Guide](./ui-style-guide.md) - Design tokens, colors, typography (MANDATORY for UI changes)
- [UI Style Guide Reference](./ui-style-guide-reference.md) - Quick reference for design tokens
- [UI Components](./ui-components.md) - React component architecture
- [Keyboard Shortcuts](./keyboard-shortcuts.md) - Application keyboard shortcuts

### Development
- [Development Tasks](./development-tasks.md) - Build, test, and deployment
- [Build](./build/README.md) - electron-builder, ASAR, fuses, troubleshooting
- [Windows enablement](./windows/README.md) - Gap analysis and phased implementation plan for Windows parity (planning)
- [Testing](./testing/README.md) - Testing strategies and coverage
  - [E2E Testing](./testing/e2e-testing.md) - Playwright/Electron E2E guide
  - [E2E Selectors](./testing/e2e-selectors.md) - 211 testids catalog
  - [E2E Helpers](./testing/e2e-helpers.md) - Test utility functions
  - [E2E Third-Party](./testing/e2e-third-party.md) - Monaco, xterm.js, Mermaid patterns
  - [E2E Debugging](./testing/e2e-debugging.md) - Debugging and CI/CD
  - [E2E Troubleshooting](./testing/e2e-troubleshooting.md) - Common issues and fixes
  - [E2E Lessons Learned](./testing/e2e-lessons-learned.md) - Hard-won testing insights
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

### Future Features (Planned)
- [Graph Engine](./future/graph-engine.md) – SQLite + vec + FTS5 knowledge graph (not yet implemented)
- [Source Grounding](./future/source-grounding/README.md) – NotebookLM-style source grounding research for audit document generation

## Quick Links

### For New Developers
1. Start with [Getting Started](./getting-started.md) - Day 1 onboarding
2. Review [Quick Reference](./quick-reference.md) - Commands cheat sheet
3. Read [Glossary](./glossary.md) - Project terminology

### For Development
1. Start with [Architecture](./architecture.md)
2. Review [Development Tasks](./development-tasks.md)
3. Check [Testing](./testing/README.md) for test workflows

### For Feature Implementation
1. See relevant feature documentation above
2. Review [IPC Patterns](./ipc-patterns.md)
3. Follow [UI Style Guide](./ui-style-guide.md) for UI changes

### For Testing
1. Unit/Integration: `npm run test` (Vitest)
2. E2E: `npm run test:e2e` (Playwright)
3. See [E2E Testing](./testing/e2e-testing.md) for patterns

### For Debugging
1. Check [Known Issues](./known-issues.md)
2. Review [Troubleshooting](./troubleshooting.md)
3. See [E2E Troubleshooting](./testing/e2e-troubleshooting.md) for test issues

## Archive

Archived documentation is located in [`./archive/`](./archive/):
- [Resolved Issues](./archive/resolved-issues.md) – Issues fixed in past versions
- [Changelog v0.3–v0.5](./archive/changelog-v03-v05.md) – Historical changelog entries
