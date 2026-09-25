<!-- SPDX-License-Identifier: GPL-3.0-only -->
# Use prompt templates

A prompt template formats selected text or a dialog instruction and sends it to the CLI agent running in Erfana's terminal. Every shipped template is submitted and executed immediately; check the agent's result before accepting file edits.

## Explain

**What it does:** Asks the agent to explain selected text; it does not request a file change. **How to reach it:** right-click selected text in the editor or Markdown Preview and select **Explain**.

## Modify

**What it does:** Opens an instruction dialog and asks the agent to rewrite the selected passage. It can change the file. **How to reach it:** selection context menu > **Modify**; describe the change and submit with <kbd>Cmd</kbd>+<kbd>Enter</kbd> (Windows: <kbd>Ctrl</kbd>+<kbd>Enter</kbd>).

## Ask

**What it does:** Opens a question dialog about the selection without requesting an edit. **How to reach it:** selection context menu > **Ask**.

## Visualize

**What it does:** Asks the agent to add a Mermaid diagram based on selected text; it can change the file. **How to reach it:** selection context menu > **Visualize**, then choose a diagram type. **Options:** Architecture, Block, C4, Class, Entity Relationship, Flowchart, Gantt, Git Graph, Kanban, Mindmap, Packet, Pie, Quadrant, Radar, Requirement, Sankey, Sequence, State, Timeline, Treemap, User Journey and XY chart. The list in [the screenshot](../how-to/turn-a-selection-into-a-prompt.md) is illustrative.

## Prompt

**What it does:** Sends free-form instructions with selected context without itself requiring a document edit. **How to reach it:** selection context menu > **Prompt**.

## Mermaid bug report

**What it does:** Sends a diagram error and source context to the agent, which may repair the document. **How to reach it:** select the bug-report control in a Mermaid error box. It needs a running terminal agent.

## Change Mermaid direction

**What it does:** Asks the agent to change a Mermaid diagram's direction, which changes source Markdown. **How to reach it:** the direction controls on the Mermaid diagram toolbar.

## Diagram chat

**What it does:** Sends an instruction to edit the open diagram's source. **How to reach it:** **Edit diagram** in the full-screen viewer; submit with <kbd>Cmd</kbd>+<kbd>Enter</kbd> (Windows: <kbd>Ctrl</kbd>+<kbd>Enter</kbd>).

## Organize import

**What it does:** After an import or transcription, sends the resulting document to the terminal agent with a request to organize it; an agent may edit the document. **How to reach it:** complete an import or transcription while an agent is running. See [import and transcription](import-and-transcription.md).
