# HTML Rendering Implementation

## Configuration

### Plugin Setup
```typescript
// MarkdownPreview.tsx – sanitizationSchema spreads hast-util-sanitize's defaultSchema
// and extends it (e.g. the tel: href protocol)
// buildRehypePlugins(lineOffset, linkSink) – memoised per frontmatter height
return [
  rehypeRaw,  // Parse HTML in markdown
  [rehypeSanitize, sanitizationSchema],  // Security sanitization
  rehypeHeadingIds,  // after sanitize: no user-content- prefix on heading ids
  [rehypeShiftLines, { offset: lineOffset }],  // line numbers past the frontmatter
  [rehypeCollectLinks, { sink: linkSink }]  // internal links for the broken-link checks
]
```

### Custom Components
```typescript
const components = {
  div: withRange('div'),  // withRange is withLineRange
  section: withRange('section'),
  img({ node, src, alt, title, width, height, ...props }) { /* renders <MarkdownImage> */ },
  source() { return null },  // <picture><source> never rendered; falls back to its <img>
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

Special handling for `<img>` elements – the renderer hands every image to `MarkdownImage`, which classifies the `src` and reads project-relative files through the main process (see [Markdown Preview § Images](../editor/markdown-preview.md#images-71)):
```typescript
img({ node, src, alt, title, width, height, ...props }) {
  const range = extractRange(node)
  return (
    <MarkdownImage
      src={src}
      alt={alt}
      title={title}
      width={width}
      height={height}
      lineStart={range?.start}
      lineEnd={range?.end}
      rest={props}
    />
  )
}
```

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

- `MarkdownPreview.tsx` – `sanitizationSchema` and `buildRehypePlugins()` (plugin configuration)
- `previewRehypePlugins.ts` – `rehypeHeadingIds`, `rehypeShiftLines`, `rehypeCollectLinks`
- `MarkdownPreview.tsx` – the `img(...)` component handler; `MarkdownImage.tsx` does the work
- `MarkdownPreview.tsx` – `withLineRange()` and the `components` map (component support)
- `src/renderer/index.html` – CSP `<meta>` tag

## References

- [rehype-raw](https://github.com/rehypejs/rehype-raw)
- [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize)
- [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)