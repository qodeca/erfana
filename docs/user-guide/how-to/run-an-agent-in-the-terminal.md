<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Run an agent in the terminal

Use the terminal to run Claude Code or another CLI agent in your project. Review its edits in the editor or preview.

**Before you start:** open a project. The terminal is available only in a project window.

## Start an agent

1. A terminal opens when the project loads. If it is closed, select **Terminal** in the right activity bar.
2. Select the terminal and type the command for your CLI agent.
3. Tell the agent which file to inspect or change.

The screenshots below were captured in an isolated demo project set to accept Claude Code edits automatically.

![Screenshot of the terminal with a neutral shell prompt.](../images/run-an-agent/shell-prompt.png)
![Screenshot of Claude Code waiting for input in the terminal.](../images/run-an-agent/claude-started.png)

## Review an edit

1. Watch the editor or preview after the agent finishes.
2. Open the changed file from the project tree if it is not already open.
3. Select **Maximize terminal** when you need more terminal space.

![Screenshot of an agent edit landing in the preview beside its terminal summary.](../images/run-an-agent/edit-lands.png)
![Screenshot of the maximized terminal over the editor.](../images/run-an-agent/terminal-maximized.png)

## What happens next / If something goes wrong

Use **Restart terminal** if a shell is stuck. If Claude Code or another program is still running, Erfana asks before it ends it. If the panel shows **Terminal not available**, use [troubleshooting](../reference/troubleshooting.md).

## Related

- [Terminal reference](../reference/terminal.md)
- [Understand how Erfana works with your agent](../how-erfana-works-with-agents.md)
