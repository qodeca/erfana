# Mermaid diagram viewer

Full-screen interactive viewer for Mermaid diagrams with zoom, pan, and export.

## Access

Click the **View fullscreen** button (a maximize icon) in the toolbar that appears when you hover a Mermaid diagram in the markdown preview (`MermaidToolbar.tsx`).

## Features

### Zoom & pan

- **Mouse wheel**: Zoom in/out by 10% per wheel step (the scale changes; the pan offset stays where it was)
- **Click & drag**: Pan around diagram
- **Zoom controls**: +/- buttons, fit to screen (`handleFitToView`, key `F`) and reset view (`handleReset`, key `0`) – two distinct actions, both in the chat bubble's header
- **Min/max zoom**: 10% to 500%

### Direction controls

Change diagram flow direction for supported chart types:

| Direction | Description |
|-----------|-------------|
| TB | Top to bottom (default) |
| BT | Bottom to top |
| LR | Left to right |
| RL | Right to left |

**Supported types** (`supportsDirection` in `src/renderer/src/utils/mermaidDirections.ts`): flowchart and graph (which also accept TD), stateDiagram, classDiagram, erDiagram, requirementDiagram, and gitGraph (LR, TB and BT only)

### Export options

The viewer has no export controls of its own (no Copy SVG / Download PNG / Download SVG). Diagrams are exported as part of the document through [PDF export](./export.md); a standalone image export is the image viewer's feature, not this one.

### Chat bubble

Diagram modification through the CLI agent you run in an embedded terminal – Erfana itself has no built-in AI (`ChatBubble.tsx`):
- A floating action button sits in the bottom-right corner of the viewer
- Clicking it expands a slide-up panel containing an embedded terminal and a prompt textarea (panel height is resizable by dragging its top edge)
- The panel header carries the zoom, fit/reset and layout-direction controls
- Cmd/Ctrl+Enter submits the prompt to the terminal with the diagram context attached; click outside or Escape collapses the panel and keeps the draft

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| + / = | Zoom in |
| - | Zoom out |
| 0 | Reset view |
| F | Fit to screen |

Escape does not close the viewer (use the X button); there is no arrow-key panning – pan with click and drag (`diagramViewer.logic.ts` `getKeyboardAction`).

## UI design

- **Dark overlay**: Semi-transparent backdrop
- **Diagram**: the SVG is drawn on `--color-bg-diagram` (white), centred on the app's primary background
- **Controls**: Direction selector and zoom/fit/reset buttons live in the chat bubble's panel header, not in a separate toolbar
- **Close button**: Top-right X icon

## Supported diagram types

All 22 Mermaid diagram types are supported:

flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, journey, gantt, pie, quadrantChart, requirementDiagram, gitGraph, C4Context, mindmap, timeline, sankey-beta, xychart-beta, block-beta, packet-beta, kanban, architecture-beta, radar-beta, treemap-beta

## Implementation

| Component | Location |
|-----------|----------|
| Viewer component | `src/renderer/src/components/Editor/DiagramViewer/DiagramViewer.tsx` |
| Chat bubble | `src/renderer/src/components/Editor/DiagramViewer/ChatBubble.tsx` |
| Preview toolbar (fullscreen button, directions) | `src/renderer/src/components/Editor/MermaidToolbar/MermaidToolbar.tsx` |
| Pure logic | `src/renderer/src/components/Editor/DiagramViewer/diagramViewer.logic.ts` |
| State store | `src/renderer/src/stores/useDiagramViewerStore.ts` |
| Styles | `src/renderer/src/components/Editor/DiagramViewer/DiagramViewer.css` |

---

See: [Editor](./README.md) | [Export](./export.md) | [Troubleshooting](../troubleshooting.md#mermaid-diagram-rendering-error)
