# Overview

## Summary

Unified search is a cross-view search functionality for Erfana that provides consistent find-in-document capabilities across the editor and preview panes. Users can search content using a single keyboard shortcut (Cmd+F) regardless of which pane is focused, with results highlighted in both views simultaneously.

## Purpose

Currently, Monaco editor has its own built-in find widget, but:
- The native Monaco find widget cannot search preview content
- Preview pane has no search capability
- Users must mentally switch contexts when searching across views
- No unified match navigation across panes

This feature creates a cohesive search experience that treats the document as a single searchable entity, regardless of view mode.

## Scope

### In scope

- Unified search UI component (search bar with input, navigation, match count)
- Monaco editor integration (programmatic find API, hiding native widget)
- Preview pane text search with DOM-based highlighting
- Keyboard shortcut unification (Cmd+F opens unified search from any pane)
- Match navigation (previous/next) cycling through all matches across views
- Case-sensitive and whole-word search options
- Extensible architecture for future preview types (e.g., Mermaid diagram search)

### Out of scope

- Find and replace functionality (future enhancement)
- Regex search (future enhancement)
- Multi-file search / project-wide search
- Search history persistence
- Search within collapsed sections
- Mermaid diagram text search (future extension point only)

## Success criteria

1. Users can invoke search with Cmd+F from any pane and search works across both views
2. Match highlighting is visible in both editor and preview simultaneously
3. Navigation (Enter/Shift+Enter or arrows) cycles through all matches
4. Search UI follows Erfana design tokens and style guide (no rounded corners)
5. Performance: search results appear within 100ms for documents up to 50,000 words
6. Monaco native find widget is suppressed when unified search is active

## Context

- **Application**: Erfana v0.6.3 (Electron-based markdown IDE)
- **Related components**: Monaco Editor, Preview pane, keyboard shortcuts system
- **Design constraints**: Must use design tokens from `design-tokens.css`, no rounded corners
- **Accessibility**: Search input must be keyboard accessible, focus management required
