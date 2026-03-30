# HTML Rendering Architecture

## Rendering Pipeline

```
Markdown Input
    ↓
remarkGfm (GitHub Flavored Markdown)
    ↓
remark-rehype (Convert to HTML AST)
    ↓
rehypeRaw (Parse embedded HTML, preserve line info)
    ↓
rehypeSanitize (Filter dangerous content)
    ↓
rehype-react (Convert to React components)
    ↓
React Component Rendering (with custom handlers)
    ↓
Markdown Preview Display
```

## Key Components

### MarkdownPreview.tsx
Main rendering component with:
- rehype plugins configuration
- Custom component handlers
- Line tracking injection
- Security sanitization

### Sanitization Schema
Uses hast-util-sanitize's defaultSchema (GitHub's safe defaults):
- Whitelist-based approach
- XSS prevention
- Safe HTML subset

### Custom Components
React components for enhanced functionality:
- Block elements with line tracking
- Image handling with attribute preservation
- Interactive HTML5 elements
- Semantic markup support

## Security Model

### Three-Layer Protection
1. **rehypeRaw**: Parses HTML, preserves structure
2. **rehypeSanitize**: Removes dangerous content
3. **React Rendering**: Safe virtual DOM

### Threat Protection
Protected against:
- XSS via script injection
- Event handler execution
- DOM clobbering attacks
- Malicious iframe loading
- JavaScript URL execution
- Style-based attacks

### CSP Compatibility
Content Security Policy enforces:
- Scripts from app only
- Images from HTTPS sources and data URIs (base64)
- No inline event handlers
- Controlled style sources

## Allowed Elements

### Block Elements
`div`, `section`, `article`, `aside`, `main`, `nav`, `header`, `footer`

### Text Elements
`p`, `span`, `br`, `h1-h6`, `blockquote`, `pre`

### Lists & Tables
`ul`, `ol`, `li`, `table`, `thead`, `tbody`, `tr`, `th`, `td`

### Interactive
`details`, `summary`, `label`

### Media
`img`, `figure`, `figcaption`

### Formatting
`strong`, `em`, `code`, `del`, `ins`, `mark`, `kbd`, `var`

## Blocked Elements
- `<script>` - Execution risk
- `<iframe>` - Content injection
- `<style>` - Style injection
- `<embed>`, `<object>` - Plugin risk
- Event handlers - XSS prevention

## Line Tracking

All elements include attributes for:
- Scroll synchronization
- Context menu operations
- Source mapping

Attributes:
- `data-line-start` - Start line
- `data-line-end` - End line
- `data-line` - Legacy support

## Performance

### Impact
- Bundle size: ~28KB (0.25% increase)
- Runtime: 0-30% overhead for HTML-heavy docs
- Typical documents: Negligible impact

### Optimization Opportunities
- Lazy HTML parsing
- AST caching
- Worker thread processing
- Incremental rendering

## Related Documentation
- [Implementation Details](./implementation.md)
- [Markdown Preview](../editor/markdown-preview.md)
- [Security](../security.md)