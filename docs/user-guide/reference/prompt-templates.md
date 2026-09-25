<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Use prompt templates

A prompt template formats selected text or a dialog instruction and sends it to the CLI agent running in Erfana's terminal. Every shipped template is submitted and executed immediately; check the agent's result before accepting file edits.

**On this page**

- [Explain](#explain)
- [Modify](#modify)
- [Ask](#ask)
- [Visualize](#visualize)
- [Prompt](#prompt)
- [Mermaid bug report](#mermaid-bug-report)
- [Change Mermaid direction](#change-mermaid-direction)
- [Diagram chat](#diagram-chat)
- [Organize import](#organize-import)

> [!WARNING]
> **Modify**, **Visualize**, **Mermaid bug report**, **Change Mermaid direction**, and **Diagram chat** ask an agent to edit the document. **Organize Import** can move, rename, or delete an imported file after asking you. Erfana opens the terminal for these prompts even when it was closed; without an agent running, the shell receives the prompt as a command. Start and check your agent before using a template, then review its changes.

| Template | Changes the file? |
| --- | --- |
| **Explain**, **Ask**, **Prompt** | No edit requested |
| **Modify**, **Visualize**, **Mermaid bug report**, **Change Mermaid direction**, **Diagram chat** | Yes, the agent may edit the document |
| **Organize Import** | Can move, rename, or delete the imported file after your decisions |

## Explain

**What it does:** Asks the agent to explain selected text; it does not request a file change. **How to reach it:** right-click selected text in the editor or Markdown Preview and select **Explain**.

## Modify

**What it does:** Opens an instruction dialog and asks the agent to rewrite the selected passage. It can change the file. **How to reach it:** selection context menu > **Modify**; describe the change and submit with <kbd>Cmd</kbd>+<kbd>Enter</kbd> (Windows: <kbd>Ctrl</kbd>+<kbd>Enter</kbd>).

## Ask

**What it does:** Opens a question dialog about the selection without requesting an edit. **How to reach it:** selection context menu > **Ask**.

## Visualize

**What it does:** Asks the agent to add a Mermaid diagram based on selected text; it can change the file. **How to reach it:** selection context menu > **Visualize**, then choose a diagram type. **Options:** Architecture, Block Diagrams, C4 Diagrams, Class Diagrams, Entity Relationship, Flowcharts, Gantt Charts, Git Graphs, Kanban Boards, Mindmaps, Packet Diagrams, Pie Charts, Quadrant Charts, Radar Charts, Requirement Diagrams, Sankey Diagrams, Sequence Diagrams, State Diagrams, Timelines, Treemaps, User Journey and XY Charts. The list in [the screenshot](../how-to/turn-a-selection-into-a-prompt.md) is illustrative.

## Prompt

**What it does:** Sends free-form instructions with selected context without itself requiring a document edit. **How to reach it:** selection context menu > **Prompt**.

## Mermaid bug report

**What it does:** Sends a diagram error and source context with instructions to repair the document in place. **How to reach it:** select the bug-report control in a Mermaid error box. Check that an agent is running first; a bare shell receives the submitted prompt too.

## Change Mermaid direction

**What it does:** Asks the agent to change a Mermaid diagram's direction, which changes source Markdown. **How to reach it:** the direction controls on the Mermaid diagram toolbar.

## Diagram chat

**What it does:** Sends an instruction to edit the open diagram's source. **How to reach it:** **Edit diagram** in the full-screen viewer; submit with <kbd>Cmd</kbd>+<kbd>Enter</kbd> (Windows: <kbd>Ctrl</kbd>+<kbd>Enter</kbd>).

## Organize import

**What it does:** After a single-file import, or when you select **Done** after transcription, sends and submits a request to organize the result. Erfana opens the terminal if closed. An agent can move or rename the file and ask whether to delete the original; a bare shell instead runs the prompt text as a command. **How to reach it:** complete a single-file import or select **Done** after transcription. Start an agent first if you want it to handle the prompt. See [import and transcription](import-and-transcription.md).
