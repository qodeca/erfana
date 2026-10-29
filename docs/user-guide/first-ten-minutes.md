<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Start with Erfana

In ten minutes you can open a folder, preview a Markdown file and use the terminal with a CLI agent you already have installed. Erfana hosts the agent in its terminal; it does not provide an agent account or model.

## Open a project

1. On Home, select **Open project** and choose a folder containing Markdown files.
2. Select a file in the project tree. New Markdown tabs open in Preview mode.
3. Select **Split Vertical** in the toolbar to see source and preview together.

![Screenshot of a project just opened with its tree and terminal.](images/open-a-project/project-open.png)

## Start and review an agent turn

1. The terminal opens with the project. If you closed it, select **Terminal** on the right activity bar. Type the command for your installed CLI agent.
2. Ask the agent to make a small change to a file in this project.
3. Review the changed source and preview. Erfana autosaves your editor changes, and external file changes reload in the open tab. If the tab has unsaved edits, a "changed on disk" bar lets you choose instead.

![Screenshot of an agent edit appearing in the Markdown preview.](images/run-an-agent/edit-lands.png)

The screenshot uses an isolated demo project and a real Claude Code session. That demo project sets Claude Code to accept edits without asking, so no approval prompt appears in the screenshot.

## Choose what to do next

Use the [how-to guides](README.md#how-do-i) for a task, or the [reference](README.md#reference) to look up a control. Read [how Erfana works with agents](how-erfana-works-with-agents.md) before using a prompt template.

![Screenshot of Erfana with a Markdown document, preview, project tree and terminal.](images/index/overview.png)
