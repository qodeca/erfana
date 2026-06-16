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
mutatesDocument: true
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
<context>
{{#if fileRef}}{{fileRef}}
Source: {{basename filePath}} ({{formatLineRange startLine endLine}})
{{/if}}
Diagram type: {{diagramType}}
</context>

<input>
{{selectedText}}
</input>

<task>
Think hard about how to best represent this content visually, then create a Mermaid {{diagramType}} diagram and insert it into the document immediately after the selected text. Insert a blank line, the mermaid fenced code block, then a trailing blank line, directly after the last line of the selection; leave the selected text and everything else unchanged.
{{#if userInput}}

Additional instructions: {{userInput}}
{{/if}}
</task>

<instructions>
- Use valid Mermaid syntax for {{diagramType}} diagram type
- Keep the diagram clear and readable
- Focus on key concepts and relationships
- Use meaningful labels and descriptions
</instructions>
