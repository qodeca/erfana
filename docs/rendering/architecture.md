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
hast-util-to-jsx-runtime (react-markdown 10 converts the hast tree to React elements)
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

The allowlist is GitHub's `defaultSchema` from `hast-util-sanitize`, applied verbatim.
Erfana's only customisation adds `tel` and `ftp` to `protocols.href`
(`MarkdownPreview.tsx`) – it does **not** extend `protocols.src`, so `data:` image sources
are stripped even though the CSP would permit them.

### Block elements
`div`, `section`, `p`, `br`, `h1`–`h6`, `blockquote`, `pre`, `hr`

### Lists and tables
`ul`, `ol`, `li`, `dl`, `dt`, `dd`, `table`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td`

### Interactive
`details`, `summary`, `input` (checkbox only – GFM task lists)

### Media
`img`, `picture`, `source`

### Formatting
`strong`, `em`, `b`, `i`, `s`, `strike`, `code`, `tt`, `samp`, `var`, `kbd`, `q`,
`del`, `ins`, `sub`, `sup`, `ruby`, `rt`, `rp`, `span`

### Not allowed – note these are silently *unwrapped*, not removed

`article`, `aside`, `main`, `nav`, `header`, `footer`, `figure`, `figcaption`, `caption`,
`mark`, `abbr`, `time`, `address`, `label`, `button`, `form`, `audio`, `video`, `svg`,
`math`, `iframe`, `object`, `embed`, `style`.

`MarkdownPreview.tsx` registers line-tracking component overrides for several of these
(`mark`, `figure`, `figcaption`, `article`, `aside`, `main`, `time`, `address`). The
sanitizer removes those elements before react-markdown maps components, so those overrides
never run.

## Blocked Elements

Removal semantics differ, and the difference is security-relevant:

| Element | Behaviour |
|---------|-----------|
| `<script>` | Element **and its text content** removed – it is the only tag in the schema's `strip` list |
| `<style>` | Tag removed, **text content kept and rendered as visible body text**. The CSS does not apply, but it is not silently discarded either |
| `<iframe>`, `<object>`, `<embed>` | Unwrapped – tag removed, child content kept |
| Event handlers (`onclick`, …) | Attribute dropped |
| `javascript:`, `data:`, `vbscript:`, `file://` in `href` | Not in `protocols.href`, so the `href` attribute is removed entirely and the anchor renders inert |

Because a disallowed element is unwrapped rather than deleted, any element whose text is
not meant to be read – `<style>`, and likewise `<title>`, `<textarea>`, `<xmp>`,
`<noembed>`, `<plaintext>` – leaks its contents into the rendered page as text.

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