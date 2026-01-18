# Overview

## Summary

External file drop functionality enables users to drag files from Finder or any external file manager and drop them directly into the Erfana project tree. This provides a natural, familiar workflow for bringing external content into the project without navigating through file dialogs.

The feature extends the existing internal drag-drop system (dnd-kit) with HTML5 DataTransfer API support for external sources, while reusing established patterns like hover-to-expand folders and visual drop indicators.

## Purpose

Users frequently need to add files from external sources to their projects - screenshots, downloaded documents, exported files from other applications. Currently, this requires:

1. Opening Finder and navigating to the project folder
2. Manually copying/moving files to the correct location
3. Returning to Erfana to see the changes

External file drop eliminates this friction by allowing direct drag-and-drop from any source directly into the project tree, with intelligent options for how to handle the dropped files.

## Scope

### In scope

- HTML5 DataTransfer API integration for detecting external file drags
- Visual feedback during external drag operations (drop zone highlighting)
- Hover-to-expand behavior for navigating into subfolders during drag (reusing existing 1s delay)
- Drop mode selection dialog offering three options:
  - **Move**: Relocate file from source to target folder
  - **Copy**: Duplicate file to target folder
  - **Import**: Process file through existing import flow
- Support for multiple file drops in a single operation
- Conflict resolution when target file already exists
- Validation of drop targets (folders within project only)

### Out of scope

- Folder drops (directories) - only individual files supported in initial implementation
- Remote/URL drops (e.g., dragging from browser)
- Drag FROM project tree TO external destinations
- Custom import rules per file type (uses existing ImportService)
- Undo/redo for drop operations

## Success criteria

| Criterion | Measurement |
|-----------|-------------|
| External drops detected | 100% of standard file drags from Finder/file managers recognized |
| Visual feedback timing | Drop indicators appear within 16ms of drag enter event |
| Auto-expand reliability | Folders expand after 1s hover in 100% of cases |
| Operation completion | Move/copy/import operations complete with appropriate user feedback |
| Error handling | All failure scenarios show actionable error messages |
