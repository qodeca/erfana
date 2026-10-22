# Markdown Preview

Live preview rendering with GitHub-Flavored Markdown and extended features.

## Supported Features

### Standard Markdown
- Headers with auto-linked IDs
- Bold, italic, strikethrough
- Lists (ordered, unordered, task lists)
- Blockquotes with accent border
- Tables with hover effects
- Code blocks (see the note on syntax highlighting below)
- Links and images

#### Code blocks: no syntax highlighting

Fenced code blocks render in a single flat colour. No highlighter is installed – the
pipeline is `remarkGfm` (plus `remarkBreaks` when `editor.preserveLineBreaks` is on) →
`rehypeRaw` → `rehypeSanitize`, with no `shiki`, `prismjs`, `highlight.js` or
`rehype-highlight` dependency. The `language-*` class **is** emitted onto both `<pre>` and
`<code>` (the sanitizer allows `className` matching `/^language-./`), but no stylesheet
consumes it. Monaco provides highlighting in the **editor** pane only.

#### Math is not supported

`$x$` and `$$…$$` render as literal text. There is no `remark-math` / `rehype-katex`; KaTeX
appears in `node_modules` solely as a transitive dependency of Mermaid, and no KaTeX
stylesheet is loaded.

### Extended Features

#### Mermaid Diagrams
22 documented diagram types:
- Flowcharts, Sequence, Class, State
- ER Diagrams, User Journey, Gantt
- Pie Charts, Git Graphs, Mindmaps
- And 12 more (see full list below)

Erfana passes every `mermaid` fenced block straight to `mermaid.render` and filters nothing, so
any type the bundled Mermaid version supports will render. Verified against Mermaid 11.16.1,
that also includes `info`, `flowchart-elk`, `C4Container` / `C4Component` / `C4Dynamic` /
`C4Deployment`, `wardley-beta`, `cynefin-beta`, `ishikawa`, `treeView-beta`,
`railroad-beta` (and its `-ebnf` / `-peg` variants), `venn-beta`, `swimlane-beta` and
`eventmodeling`. The list of 22 is the documented, supported set – not a technical limit.

**`zenuml` is a known exception.** `src/renderer/src/utils/mermaidDirections.ts` lists it as
a known chart type, but `@mermaid-js/mermaid-zenuml` is not a dependency, so a `zenuml`
fence fails with "No diagram type detected".

**Usage:**
````markdown
```mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action]
```
````

**Error Handling:**
- User-friendly error messages
- Bug report button (🐛) sends to Terminal
- Links to documentation

#### Full-Screen Diagram Viewer (v0.5.1)

Expand Mermaid diagrams to full-screen overlay for detailed examination.

**Access:**
- Expand button appears on hover over diagrams (always visible on touch devices)
- Click expand button to open full-screen overlay

**Zoom & Pan:**
- Mouse wheel zoom (10% increments)
- +/- toolbar buttons for zoom control
- Click-drag to pan diagram around viewport
- Zoom indicator displays current percentage (e.g., "125%")
- Custom CSS transform-based implementation (no third-party library)

**Navigation:**
- Fit-to-screen button: Scale diagram to fit viewport
- Reset button: Return to 100% zoom, centered
- Zoom range: 10% to 500%

**Keyboard Shortcuts:**
- `+` or `=`: Zoom in
- `-`: Zoom out
- `0`: Reset zoom to 100%
- `F`: Fit to screen

**Close Methods:**
- X button (top-right)
- Click backdrop (outside diagram)

Escape does not close the viewer (`diagramViewer.logic.ts` maps it to no action); it only collapses the chat bubble.

**Accessibility:**
- ARIA labels on all controls
- `role="dialog"` with `aria-modal`
- Focus management (trapped in overlay)
- `aria-live` zoom indicator for screen readers

**Architecture:**
- Pure logic extraction: `diagramViewer.logic.ts` (testable)
- React component: `DiagramViewer.tsx`
- SVG rendering uses same innerHTML injection as preview mode (Mermaid strict security)

**Files:**
- `src/renderer/src/components/Editor/DiagramViewer/`

#### Images (#71)

**Before #71** a project-relative image never rendered. The `src` was handed to the page
unchanged, so it resolved against the app bundle, not the project: in the packaged app
`./assets/icon.svg` became `file:///…/out/renderer/assets/icon.svg`, and both an SVG and a PNG
showed as a broken image with `naturalWidth` 0 (checked by running the app, 2026-10-22; the
e2e test `e2e/preview-images.e2e.ts` now pins the fixed behaviour).

**Now** the `img` renderer is `MarkdownImage.tsx`, and each `src` is classified first
(`markdownImageSource.ts`):

| `src` | What happens |
|---|---|
| `http:` / `https:` | Passed through unchanged, as before. Nothing is fetched by the app. |
| Relative to the document (`./a.png`, `a.png`, `../img/a.svg`) | Read by the main process over `markdown-image:read`, confined to the open project (links and junctions resolved; one that leads out is refused), and shown as a `data:` URL in an `<img>`. |
| Absolute or rooted path, drive or UNC path, protocol-relative `//host/…`, `file:`, `data:`, any other scheme, or a relative path that climbs out of the project | Never loaded: the alt text is shown in a placeholder, with the reason as tooltip. |

- **`<picture>`:** a `<source srcset>` is kept only when every candidate is `http(s)`; otherwise
  it is dropped and the picture falls back to its `<img>`, which follows the table above.
- **Types and caps:** PNG, JPEG, GIF, WebP, SVG only; 50 MB per image (the image viewer's
  cap); 64 distinct images per document; 4 reads in flight per preview.
- **SVG** is always an `<img src="data:image/svg+xml;base64,…">`, never inlined into the DOM, so
  its scripts do not run and it fetches nothing.
- **CSP:** unchanged. The page already allows `img-src data:`; no custom protocol was added.
- **Refresh:** no new watch. `markdownImageStore.ts` listens to the same signals as the link
  checks – every `directory-watch:changed` batch (content edits included) and this window's own
  file operations – settles a burst (300 ms, at most 2 s), then asks again for every image on
  screen *with the version it shows*. The main process answers `unchanged` after a `stat`, so
  only changed images are re-read and re-sent. New bytes are decoded off the DOM first; a
  half-written file keeps the last good image. The `<img>` element is updated in place.
- **Hidden previews** (the `isVisible` prop) read nothing; they catch up once when shown.
- **Scroll sync and export:** an arriving image reports `onRendered({ reason: 'image' })`, which
  scroll sync treats like a drawn diagram (one debounced re-measure); a loading image counts as
  outstanding work for `flush()`, so PDF / DOCX export waits for it.
- **Limit:** an image in a folder the directory watcher skips (hidden, excluded or ignored by
  version control) updates on the next project change event or when the tab is reopened.

#### HTML Embedding
Safe HTML rendering with security sanitization.

**Allowed elements:**
- Containers: `<div>`, `<section>`
- Interactive: `<details>`, `<summary>`
- Media: `<img>`, `<picture>`, `<source>`
- Tables, lists (including `<dl>`/`<dt>`/`<dd>`), inline formatting

**Blocked (security):**
- `<script>` – element and its text content are both removed
- `<iframe>`, `<object>`, `<embed>` – unwrapped, child content kept
- Event handlers (`onclick`, etc.) and `javascript:` / `data:` / `vbscript:` / `file://` URLs

**Unwrapped, not blocked:** `<article>`, `<aside>`, `<main>`, `<nav>`, `<header>`,
`<footer>`, `<figure>`, `<figcaption>`, `<mark>`, `<abbr>`, `<time>`, `<label>` and
`<style>` are absent from the allowlist, so the tag disappears but its children remain.
For `<style>` that means the CSS text renders as **visible body text** – it is neutralised,
not discarded. The full list and its rationale are in
[rendering/architecture.md](../rendering/architecture.md#allowed-elements).

**Example:**
```html
<details>
<summary>Click to expand</summary>
Content with **markdown** inside
</details>
```

## Typography

GitHub-inspired professional design:
- Font: Charter, Georgia serif stack
- Body: 15px, line-height 1.5
- Max width: 860px centered
- Dark theme with `var(--color-bg-preview)` background (`MarkdownPreview.css`)

## Line Tracking

All elements have line attributes for:
- Scroll synchronization
- Context menu operations
- Source mapping

Attributes:
- `data-line-start` - Start line
- `data-line-end` - End line
- `data-line` - Legacy start line

## Implementation
- Component: `MarkdownPreview.tsx`
- Mermaid: `MermaidDiagram.tsx`
- Images: `MarkdownImage.tsx`, `markdownImageSource.ts`, `markdownImageStore.ts`; main side `src/main/ipc/markdown-image-handlers.ts`
- Line tracking: `extractLineRange()` and `withLineRange()` in `MarkdownPreview.tsx`
- HTML support: `sanitizationSchema`, the `rehypePlugins` list and the `components` map in `MarkdownPreview.tsx`

## Complete Mermaid Diagram Types
1. Flowcharts (`flowchart`)
2. Sequence Diagrams (`sequenceDiagram`)
3. Class Diagrams (`classDiagram`)
4. State Diagrams (`stateDiagram-v2`)
5. Entity Relationship (`erDiagram`)
6. User Journey (`journey`)
7. Gantt Charts (`gantt`)
8. Pie Charts (`pie`)
9. Quadrant Charts (`quadrantChart`)
10. Requirement Diagrams (`requirementDiagram`)
11. Git Graphs (`gitGraph`)
12. C4 Diagrams (`C4Context`)
13. Mindmaps (`mindmap`)
14. Timelines (`timeline`)
15. Sankey Diagrams (`sankey-beta`)
16. XY Charts (`xychart-beta`)
17. Block Diagrams (`block-beta`)
18. Packet Diagrams (`packet-beta`)
19. Kanban Boards (`kanban`)
20. Architecture (`architecture-beta`)
21. Radar Charts (`radar-beta`)
22. Treemaps (`treemap-beta`)