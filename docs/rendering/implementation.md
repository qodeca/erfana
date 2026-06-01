# HTML Rendering Implementation

## Configuration

### Plugin Setup
```typescript
const rehypePlugins = [
  rehypeRaw,  // Parse HTML in markdown
  [rehypeSanitize, defaultSchema]  // Security sanitization
]
```

### Custom Components
```typescript
const components = {
  div: withLineRange('div'),
  section: withLineRange('section'),
  img: customImageHandler,
  // ... more components
}
```

## Edge Cases Handled

### Mixed Content
- HTML blocks with markdown
- Nested HTML elements
- Selection spanning HTML/markdown
- Multi-line HTML blocks

### Security Cases
- XSS attempts blocked
- JavaScript URLs sanitized
- Event handlers removed
- Dangerous styles filtered

### Browser Compatibility
- Self-closing tags
- HTML entities
- Malformed HTML auto-fixed
- HTML5 elements supported

## Image Handling

Special handling for `<img>` elements:
```typescript
// Explicitly preserve attributes
img: ({ src, alt, title, width, height, ...props }) => (
  <img
    src={src}
    alt={alt || ''}
    title={title}
    width={width}
    height={height}
    {...extractLineRange(props)}
  />
)
```

## Performance Metrics

| Document Size | HTML % | Overhead |
|--------------|--------|----------|
| 10KB | 0% | 0% |
| 10KB | 20% | 15% |
| 50KB | 50% | 33% |
| 100KB | 70% | 37% |

## Common Issues

### HTML Not Rendering
- Needs blank lines around HTML
- Element must be in allowed list
- Check for syntax errors

### Styles Not Applied
- Inline styles sanitized by default
- Use CSS classes instead
- Consider schema extension

### Line Tracking Missing
- Ensure element uses `withLineRange()`
- Check component registration

## Customization

### Extending Schema
```typescript
// Build a new schema by spreading defaultSchema (no extra deps needed).
const customSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'style'],  // Allow styles
    div: ['data-custom']  // Custom attrs
  },
  tagNames: [...(defaultSchema.tagNames ?? []), 'button']
}
```

⚠️ **Security Warning**: Review all schema changes carefully.

## Testing Checklist

- [ ] Basic HTML renders
- [ ] Nested HTML works
- [ ] Line tracking visible
- [ ] Scroll sync functional
- [ ] Context menu works
- [ ] Scripts blocked
- [ ] Events blocked
- [ ] URLs sanitized
- [ ] Performance acceptable

## Dependencies

| Library | Purpose | Security |
|---------|---------|----------|
| rehype-raw | HTML parsing | ✅ Safe |
| rehype-sanitize | Sanitization | ✅ Industry standard |
| hast-util-sanitize | Schema | ✅ GitHub uses |

## Files

- `MarkdownPreview.tsx:109-112` - Plugin configuration
- `MarkdownPreview.tsx:256-271` - Image handler
- `MarkdownPreview.tsx:266-295` - Component support
- `src/renderer/index.html` - CSP headers

## References

- [rehype-raw](https://github.com/rehypejs/rehype-raw)
- [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize)
- [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)