# HTML Rendering Documentation

Markdown to HTML conversion architecture for the preview pane.

## Overview

Erfana renders markdown to HTML with:
- GitHub-Flavored Markdown support
- Security sanitization
- Line tracking for scroll sync
- Mermaid diagram rendering
- Safe HTML embedding

## Documentation

- [Architecture](./architecture.md) - Rendering pipeline and components
- [Implementation](./implementation.md) - Technical details and code

## Key Features

### Markdown Processing
- react-markdown for AST generation
- remark-gfm for GitHub features
- rehype-raw for HTML parsing
- rehype-sanitize for security

### Line Tracking
All rendered elements include line attributes:
- `data-line-start` - Start line number
- `data-line-end` - End line number
- `data-line` - Legacy compatibility

### Security
- XSS prevention via sanitization
- Dangerous elements blocked
- CSP-compliant rendering
- Safe HTML subset allowed

## Related Documentation
- [Editor Documentation](../editor/README.md)
- [Markdown Preview](../editor/markdown-preview.md)
- [Scroll Synchronization](../editor/scroll-sync.md)