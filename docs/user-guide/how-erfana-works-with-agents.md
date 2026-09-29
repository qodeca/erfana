<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Understand how Erfana works with your agent

Erfana is a Markdown workspace with an integrated terminal. It runs the shell and CLI agent you choose; the agent supplies its own model, account and edit decisions. Erfana does not include an AI assistant.

## Start your own agent

Open a project, open **Terminal**, and type your installed agent's command. The session runs as a top-level terminal session in the project context. If you close the terminal, reopen it from the right activity bar when you need it; [terminal controls](reference/terminal.md) let you restart it or select **Maximize terminal**.

## Send selected text

Select text in the Markdown editor or preview, right-click, and choose a [prompt template](reference/prompt-templates.md). Erfana formats and sends the prompt to the terminal immediately. **Explain**, **Ask** and **Prompt** request information; **Modify** and **Visualize** can lead to file edits. The agent may still make other changes according to its own permissions, so review its output and your files.

## Read Claude Code status

While Claude Code runs, its [context meter](reference/claude-code-status-bar.md) can show model and context use. It reads Claude Code's transcripts only and does not write its configuration. Other CLI agents run in the same terminal without that meter.
