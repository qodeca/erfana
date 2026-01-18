# Overview

## Summary

Unified In-File Search provides a consistent, cross-view search experience for ERFANA's content panels. A single SearchBar component replaces Monaco Editor's built-in search widget and provides identical functionality across Markdown Preview and future preview types (HTML, SVG).

## Purpose

Currently, Monaco Editor has its own built-in search widget with specific styling and behavior, while preview panels have no search capability. This creates an inconsistent user experience when switching between editor and preview modes. Users expect familiar search behavior (Cmd/Ctrl+F) to work identically regardless of which view is active.

This feature establishes:
- A unified visual search interface across all views
- Extensible architecture for future preview types
- Consistent keyboard navigation and behavior

## Scope

### In scope

- Custom SearchBar overlay component replacing Monaco's built-in search
- SearchProvider interface for view-specific implementations
- Monaco Editor search provider (replaces built-in widget)
- Markdown Preview search provider with DOM-based highlighting
- Zustand store for search state management
- Case sensitivity and whole word toggles
- Match count display and navigation
- Keyboard shortcuts: Cmd/Ctrl+F (open), Escape (close), Enter/Shift+Enter (navigate)

### Out of scope

- Regular expression search
- Find and replace functionality
- Cross-file search (project-wide)
- Search history persistence
- Search state persistence across view mode switches
- HTML Preview and SVG Preview implementations (architecture only)

## Success criteria

1. SearchBar appears visually identical in Monaco Editor and Markdown Preview
2. Cmd/Ctrl+F opens search in the currently active view
3. Search results highlight in both editor and preview
4. Match navigation (Enter/Shift+Enter) works correctly in all views
5. Architecture supports adding new preview types without modifying core search logic
6. Monaco's built-in search widget is fully replaced (not visible)
