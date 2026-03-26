# 020 – Google Drive link integration: Overview

## Summary

Add reference-based Google Drive integration to Erfana via `.gdrive` link files. These files act as "smart bookmarks" – small YAML-frontmatter files that reference Google Workspace documents, spreadsheets, presentations, and other artifacts. They appear in the project tree with cloud icons, support context menu actions (direct operations and AI prompts), and are discoverable by Claude Code via `gws` CLI.

This is **not** a sync/mirror feature. Erfana remains local-first. Drive artifacts are referenced, not cached or replicated.

## Purpose

Erfana projects often relate to external documents stored in Google Drive – reports, spreadsheets, presentations, shared team artifacts. Currently there's no way to connect these resources to a project. Users must manually manage URLs, copy-paste content, or switch between Erfana and browser tabs.

This feature bridges the gap by making Drive resources first-class citizens in the project tree – visible, actionable, and accessible to both the user (via context menu) and Claude Code (via `.gdrive` file content + `gws` CLI).

## Scope

### In scope

- `.gdrive` file format with YAML frontmatter and optional markdown body
- OAuth2 "Sign in with Google" flow (consumer-grade UX, no GCP knowledge required)
- Google Picker integration for browsing and selecting Drive files
- Four new main process services: DriveAuthService, DriveLinkService, DriveApiService, DrivePickerService
- IPC channels for Drive operations
- Project tree integration (cloud icon, display name from frontmatter, freshness indicator)
- Context menu strategy for `.gdrive` files (direct ops + AI prompts)
- New prompt templates with `area: drive-link`
- Settings overlay "Google Drive" section
- `useDriveStore` Zustand store for renderer-side Drive state management
- Feature flag (`googleDrive.enabled`) to disable the feature without code changes
- CLAUDE.md conventions for Claude Code discovery
- Support for four Google Workspace types: Document, Spreadsheet, Presentation, generic File

### Out of scope

- Bidirectional file sync or local caching of Drive content
- Real-time collaboration features
- Google Drive as a project root (projects remain local folders)
- MCP server for Drive (future upgrade path, not in initial scope)
- Creating or editing Google Docs/Sheets from within Erfana
- Google Drive folder browsing in the project tree (only individual file links)
- Shared Drive / Team Drive specific features
- Background periodic metadata refresh (on-demand only in v1)
- Multiple Google accounts (v1 supports single account)

## Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| File format | `.gdrive` with YAML frontmatter | Git-trackable, self-documenting, individually visible in tree |
| Auth approach | OAuth2 loopback with `drive.file` scope only | Picker grants per-file access; no need for broad read scope. Reduces blast radius of compromised tokens |
| Erfana backend | googleapis Node.js SDK | Typed responses, proper error handling, extensible |
| Claude Code backend | gws CLI via Bash | Already authenticated, works from terminal |
| Metadata strategy | Light cache in frontmatter, refreshed on demand | Shows freshness without background polling |
| Content strategy | Fetched on demand, never cached locally | Stays local-first, avoids sync complexity |
| Tree enrichment | Post-read enrichment via DriveLinkService.enrichNodes() | FileService stays pure; mirrors git status overlay pattern |
| Picker service | Separate DrivePickerService (not on DriveApiService) | SRP: API wrapper vs UI orchestration are different concerns |
| Renderer state | `useDriveStore` Zustand store | Follows `useGitStore` / `useTranscriptionStore` pattern for reactive state management across components |
| Feature flag | `googleDrive.enabled` in GlobalSettings | Allows disabling the feature without code changes; skips tree enrichment and hides UI when off |
