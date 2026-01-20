# BRS-015: Image preview viewer

## Summary

Enable users to open and view image files directly within Erfana tabs, providing a dedicated image viewer with zoom, pan, and fit controls similar to the existing Mermaid diagram viewer.

## Problem statement

Currently, Erfana focuses on Markdown editing and preview. When users have images in their project (screenshots, diagrams, photos), they cannot view them within the application. Users must:
- Use external applications to view images
- Lose context by switching between apps
- Cannot quickly reference images while writing documentation

## Solution

Add a dedicated Image Viewer panel that:
- Opens images in tabs (like Markdown files)
- Displays images with proper scaling
- Provides zoom, pan, and fit controls
- Supports keyboard navigation
- Offers full-screen viewing mode

## Scope

### In scope
- Image file opening from project tree (PNG, JPG, JPEG, GIF, WebP, SVG, BMP, ICO)
- Dedicated ImageViewerPanel component
- Zoom controls (in/out/reset/fit)
- Pan functionality when zoomed
- Keyboard shortcuts for all actions
- Full-screen viewing mode
- Image metadata display (dimensions, size, format)
- Tab integration with custom ImageTab component

### Out of scope
- Image editing capabilities
- Image format conversion
- Batch image operations
- Image annotations
- Thumbnail previews in project tree
- Image comparison view

## Prior art

The existing DiagramViewer component (`src/renderer/src/components/Editor/DiagramViewer/`) provides:
- Zoom/pan implementation with transform state
- Keyboard shortcuts (+, -, 0, F)
- Full-screen modal with focus management
- Zoom button states and configuration

This implementation will reuse and adapt these patterns for images.

## UI design

### Image viewer panel layout

```
┌─────────────────────────────────────────────────────────────┐
│ [ImageTab: filename.png]                              [×]   │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │                                                         │ │
│ │                                                         │ │
│ │                    [Image Display]                      │ │
│ │                                                         │ │
│ │                                                         │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 1920×1080 · 245 KB · PNG  │ [-] [100%] [+] [⊡] [⛶]    │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Toolbar components

| Element | Description |
|---------|-------------|
| Image info | Dimensions (W×H), file size, format |
| `[-]` | Zoom out button |
| `[100%]` | Current zoom level (clickable to reset) |
| `[+]` | Zoom in button |
| `[⊡]` | Fit to container toggle |
| `[⛶]` | Full-screen button |

### Full-screen mode

```
┌─────────────────────────────────────────────────────────────┐
│                                                       [×]   │
│                                                             │
│                                                             │
│                    [Image Display]                          │
│                    (centered, fitted)                       │
│                                                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│        [-] [100%] [+] [⊡] · 1920×1080 · PNG                │
└─────────────────────────────────────────────────────────────┘
```

### Visual states

| State | Appearance |
|-------|------------|
| Default | Image centered, fit to container |
| Zoomed in | Scrollbars appear, cursor changes to grab |
| Panning | Cursor shows grabbing hand |
| Loading | Spinner centered in container |
| Error | Error icon with "Failed to load image" message |

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` | Reset to 100% |
| `F` | Fit to container |
| `Escape` | Exit full-screen (when in full-screen) |
| Arrow keys | Pan when zoomed |

### Mouse interactions

| Action | Behavior |
|--------|----------|
| Scroll wheel | Zoom in/out at cursor position |
| Click + drag | Pan image when zoomed beyond container |
| Double-click | Toggle fit/100% zoom |

## Dependencies

- Existing DockviewReact tab system
- Existing design tokens (CSS variables)
- Lucide React icons (ZoomIn, ZoomOut, Maximize2, Minimize2)
