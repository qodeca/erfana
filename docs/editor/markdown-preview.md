# Markdown Preview

Live preview rendering with GitHub-Flavored Markdown and extended features.

## Supported Features

### Standard Markdown
- Headers with auto-linked IDs
- Bold, italic, strikethrough
- Lists (ordered, unordered, task lists)
- Blockquotes with accent border
- Tables with hover effects
- Code blocks with syntax highlighting
- Links and images

### Extended Features

#### Mermaid Diagrams
22 supported diagram types:
- Flowcharts, Sequence, Class, State
- ER Diagrams, User Journey, Gantt
- Pie Charts, Git Graphs, Mindmaps
- And 12 more (see full list below)

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

#### HTML Embedding
Safe HTML rendering with security sanitization.

**Allowed Elements:**
- Containers: `<div>`, `<section>`, `<article>`
- Interactive: `<details>`, `<summary>`
- Semantic: `<figure>`, `<figcaption>`
- Tables, lists, inline formatting

**Blocked (Security):**
- `<script>`, `<iframe>`, `<style>`
- Event handlers (`onclick`, etc.)
- JavaScript URLs

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
- Dark theme with `#1e1e1e` background

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
- Line tracking: Lines 21-28, 143-207
- HTML support: Lines 266-295

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