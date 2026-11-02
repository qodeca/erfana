<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Understand how Erfana works with your agent

Erfana is a Markdown workspace with an integrated terminal. It runs the shell and CLI agent you choose; the agent supplies its own model, account and edit decisions. Erfana does not include an AI assistant.

## Start your own agent

Open a project, open **Terminal** (<kbd>⌘J</kbd> / <kbd>Ctrl+J</kbd>), and type your installed agent's command. The terminal starts in the project folder. If you close the terminal, reopen it from the right activity bar when you need it. The [terminal controls](reference/terminal.md) let you select **Restart terminal** or **Maximize terminal**.

## Send selected text

Select text in the Markdown editor or preview, right-click, and choose a [prompt template](reference/prompt-templates.md). **Explain** sends at once; the other templates first ask for your input. Erfana then pastes the prompt into the terminal and presses Enter for you. **Explain** and **Ask** request information; **Modify** and **Visualize** can lead to file edits; **Prompt** sends whatever instruction you type. The agent may still make other changes according to its own permissions, so review its output and your files.

## Read Claude Code status

While Claude Code runs, its [context meter](reference/claude-code-status-bar.md) can show model and context use. It reads Claude Code's transcripts and settings file, and never writes to them. Other CLI agents run in the same terminal without that meter.
