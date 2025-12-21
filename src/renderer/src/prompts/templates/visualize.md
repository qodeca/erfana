---
area: markdown-preview
subArea: context-menu
name: Visualize
icon: layout-grid
targetPanel: terminal
autoExecute: true
requiresInput: true
textareaOptional: true
inputLabel: Additional instructions
inputPlaceholder: e.g., focus on the main flow, highlight decision points, show only the key steps...
order: 2.5
dropdown:
  label: Diagram type
  defaultValue: flowchart
  options:
    - value: architecture-beta
      label: Architecture
    - value: block-beta
      label: Block Diagrams
    - value: C4Context
      label: C4 Diagrams
    - value: classDiagram
      label: Class Diagrams
    - value: erDiagram
      label: Entity Relationship
    - value: flowchart
      label: Flowcharts
    - value: gantt
      label: Gantt Charts
    - value: gitGraph
      label: Git Graphs
    - value: kanban
      label: Kanban Boards
    - value: mindmap
      label: Mindmaps
    - value: packet-beta
      label: Packet Diagrams
    - value: pie
      label: Pie Charts
    - value: quadrantChart
      label: Quadrant Charts
    - value: radar-beta
      label: Radar Charts
    - value: requirementDiagram
      label: Requirement Diagrams
    - value: sankey-beta
      label: Sankey Diagrams
    - value: sequenceDiagram
      label: Sequence Diagrams
    - value: stateDiagram-v2
      label: State Diagrams
    - value: timeline
      label: Timelines
    - value: treemap-beta
      label: Treemaps
    - value: journey
      label: User Journey
    - value: xychart-beta
      label: XY Charts
---
{{#if fileRef}}{{fileRef}}

From {{filePath}} ({{formatLineRange startLine endLine}}):

{{/if}}Content to visualize:
---
{{selectedText}}
---

Create a Mermaid {{diagramType}} diagram that visualizes the content above.
{{#if userInput}}

Additional instructions: {{userInput}}
{{/if}}

Requirements:
1. Use valid Mermaid syntax for {{diagramType}} diagram type
2. Keep the diagram clear and readable
3. Focus on the key concepts and relationships
4. Use meaningful labels and descriptions
5. Return ONLY the Mermaid code block (no explanations)

Format your response as:
```mermaid
{{diagramType}}
    ... diagram content ...
```
