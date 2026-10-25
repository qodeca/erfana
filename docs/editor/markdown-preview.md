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

- **`<picture>`:** a `<source>` is never rendered, so the picture falls back to its `<img>`,
  which follows the table above.
- **Types and caps:** PNG, JPEG, GIF, WebP, SVG only, and regular files only. 16 MB per image –
  lower than the image viewer's 50 MB, because the document picks what is read. The main
  process opens the file once, checks that handle with `fstat`, and reads at most the cap plus
  one byte from it.
- **Files, not spellings:** `./a.png`, `a.png` and `./x/../a.png` share one read, one `data:` URL
  and one slot. Paths are case-folded on macOS and Windows. A preview holds at most 64 files and
  keeps at most 4 reads in flight, with at most one waiting per file.
- **Memory budget:** all Markdown previews in a window, hidden ones included, share 128 MB of
  `data:` URLs, reserved before the bytes are decoded. An image that does not fit shows its
  alt text and keeps its version, so a re-check costs one `fstat`; it is read in full again
  as soon as other images release enough room.
- **SVG** is always an `<img src="data:image/svg+xml;base64,…">`, never inlined into the DOM, so
  its scripts do not run and it fetches nothing.
- **CSP:** unchanged. The page already allows `img-src data:`; no custom protocol was added.
- **Refresh:** no new watch. `markdownImageStore.ts` listens to the same signals as the link
  checks – every `directory-watch:changed` batch (content edits included) and this window's own
  file operations – settles a burst (300 ms, at most 2 s), then asks again for every image on
  screen *with the version of the last bytes it received* (also when they did not decode). The
  main process answers `unchanged` after an `fstat`, so only changed images are re-read and
  re-sent. New bytes are decoded off the DOM first; a
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

## When the preview updates (deferred preview)

Until v0.22.0 the preview re-parsed the whole document on every keystroke; in a 3,000-line file that blocked the editor long enough to drop typed keys. `MarkdownPreview.tsx` now schedules the body render in two layers (lens review finding [31]):

- **Debounce, only for slow documents.** The preview stays live per keystroke while a body render fits in one frame (`PREVIEW_FRAME_BUDGET_MS`, 16 ms). After two slow renders in a row (`PREVIEW_MODE_SWITCH_STREAK`), and only for a document of at least 2,000 characters (`PREVIEW_DEBOUNCE_MIN_CHARS`), it waits for a 150 ms pause in typing (`PREVIEW_IDLE_DELAY_MS`), and at most 1 s (`PREVIEW_MAX_WAIT_MS`), before it re-renders. As many fast renders in a row switch it back to live.
- **`useDeferredValue`.** Whatever is released renders at transition priority, so a keystroke that arrives meanwhile is handled first. A release forced by the 1 s limit, or by `flush()`, renders at normal priority so the limit holds.
- **Diagrams** redraw only after 300 ms without edits to their code (`MERMAID_IDLE_DELAY_MS` in `MermaidDiagram.tsx`); the first draw is never delayed.
- **Exports** call the preview's `flush()` first (`useExportHandlers.ts`), so a PDF or Word export shows the latest text. Each wait inside `flush()` is capped at 5 s (`PREVIEW_FLUSH_TIMEOUT_MS`).
- The first render is never delayed.

Measurements: [docs/performance/2026-10-21-deferred-preview.md](../performance/2026-10-21-deferred-preview.md).

## Broken-link checks

A relative link whose target does not exist gets the broken-link styling. The preview asks the main process (`file.exists`) once per target and remembers the answer per preview panel (`components/Editor/linkTargetCache.ts`):

- Editing one link asks about that link only, not every link in the document. Typing prose asks nothing.
- Remembered answers are forgotten all at once when the file structure changes – a structural `directory-watch:changed` event, a `catchUp` refresh, or one of this window's own create, delete, rename, move or copy operations (`services/fileStructureSignal.ts`) – and the preview then re-checks its links 400 ms after the burst settles, at most 2 s after it began (`LINK_TARGET_SETTLE_MS`, `LINK_TARGET_MAX_WAIT_MS`).
- Each answer also expires after 30 s (`LINK_TARGET_TTL_MS`), so a change no event reports (a folder the watcher skips) still shows up.
- A hidden tab does not re-check; it re-checks once when shown, if anything changed meanwhile.
- Clicking a link always asks the disk, so a stale "found" never opens a missing file.

Design and measurements: [docs/performance/deferred-markdown-preview.md](../performance/deferred-markdown-preview.md). Link resolution itself (percent-escapes, backslashes, links that leave the project) is in `utils/markdownLinkResolver.ts`.

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
- Component: `MarkdownPreview.tsx` (render scheduling: `PREVIEW_*` constants)
- Link checks: `linkTargetCache.ts`, `utils/markdownLinkResolver.ts`, `services/fileStructureSignal.ts`
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