# Mermaid diagram viewer

Full-screen interactive viewer for Mermaid diagrams with zoom, pan, and export.

## Access

Click expand icon (↗) on any Mermaid diagram in the markdown preview.

## Features

### Zoom & pan

- **Mouse wheel**: Zoom in/out (centered on cursor)
- **Click & drag**: Pan around diagram
- **Zoom controls**: +/- buttons, reset (fit to view)
- **Min/max zoom**: 10% to 500%

### Direction controls

Change diagram flow direction for supported chart types:

| Direction | Description |
|-----------|-------------|
| TB | Top to bottom (default) |
| BT | Bottom to top |
| LR | Left to right |
| RL | Right to left |

**Supported types**: flowchart, graph, mindmap, block-beta

### Export options

- **Copy SVG**: Copy diagram as SVG to clipboard
- **Download PNG**: Save as PNG image
- **Download SVG**: Save as SVG file

### Chat bubble

AI-powered diagram assistance:
- Select text in diagram
- Chat bubble appears
- Click to open prompt in terminal

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| Escape | Close viewer |
| + / = | Zoom in |
| - | Zoom out |
| 0 | Reset zoom |
| Arrow keys | Pan diagram |

## UI design

- **Dark overlay**: Semi-transparent backdrop
- **Centered container**: White background with shadow
- **Toolbar**: Direction selector, zoom controls, export buttons
- **Close button**: Top-right X icon

## Supported diagram types

All 22 Mermaid diagram types are supported:

flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, journey, gantt, pie, quadrantChart, requirementDiagram, gitGraph, C4Context, mindmap, timeline, sankey-beta, xychart-beta, block-beta, packet-beta, kanban, architecture-beta, radar-beta, treemap-beta

## Implementation

| Component | Location |
|-----------|----------|
| Viewer component | `src/renderer/src/components/Editor/DiagramViewer/DiagramViewer.tsx` |
| Chat bubble | `src/renderer/src/components/Editor/DiagramViewer/ChatBubble.tsx` |
| Pure logic | `src/renderer/src/components/Editor/DiagramViewer/diagramViewer.logic.ts` |
| State store | `src/renderer/src/stores/useDiagramViewerStore.ts` |
| Styles | `src/renderer/src/components/Editor/DiagramViewer/DiagramViewer.css` |

---

See: [Editor](./README.md) | [Export](./export.md) | [Troubleshooting](../troubleshooting.md#mermaid-diagram-rendering-error)
