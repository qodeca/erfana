# Scroll Synchronization

Bidirectional scrolling sync between editor and preview in split view mode.

## Features

- **Editor → Preview**: Editor scroll updates preview position
- **Preview → Editor**: Preview scroll updates editor position
- **Line Mapping**: Uses data attributes for precise positioning
- **Dynamic Content**: Waits for images and diagrams to load
- **Smooth Interpolation**: Linear between known points
- **Debouncing**: 50ms delay prevents scroll loops

## Technical Implementation

### Position Calculation (v0.2+)
Uses `getBoundingClientRect()` for viewport-relative positioning:

```typescript
const rect = element.getBoundingClientRect()
const previewOffset = rect.top - containerRect.top + containerScrollTop
```

Correctly accounts for container padding (24px top).

### Dynamic Content Handling
Scroll map waits for all content before building:
- Images: `img.onload`/`img.onerror` events
- Mermaid diagrams: `.mermaid-wrapper` elements
- Rebuilds after all async operations complete

### Race Condition Fix (v0.3+)
- Force component remounting with React keys
- Immediate scroll map building in `handleEditorMount()`
- Simplified listener attachment
- Resolves mode switching issues

## Accuracy

- Maps editor line numbers to preview elements
- Uses react-markdown's `node.position` API
- Enhanced line range tracking for multi-line elements
- Updates on view mode or content changes

## Files

- Scroll map building: `MarkdownEditorPanel.tsx:454-481`
- Dynamic content: `MarkdownEditorPanel.tsx:161-223`
- Sync handlers: `MarkdownEditorPanel.tsx:275-290`
- Line extraction: `MarkdownPreview.tsx:59-66`

## Related
- [Editor README](./README.md)
- [Markdown Preview](./markdown-preview.md)