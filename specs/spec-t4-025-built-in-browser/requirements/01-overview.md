# Overview

## Purpose

Erfana gains a built-in web browser that opens in tabs next to the HTML and Markdown Previews. A user opens any web page – a local dev server, a staging or production site, or an HTML file on disk – picks an element on it, and sends a prompt action to the CLI agent in Erfana's terminal together with a context file and a screenshot that marks the element. With this, Erfana covers the third surface on which a person reviews an agent's work, after HTML and Markdown files.

## Business objectives

| Objective | Success metric | Target |
|-----------|---------------|--------|
| Review an agent's web work without leaving Erfana | Review steps that need an outside browser for the Qodeca team's web projects | None for pages that do not need Google sign-in |
| Point the agent at the right element | First-try hits over 3 runs of a fixed 20-pick set (025-NFR-003) | 54 of 60 or more |
| Replace the screenshot-and-describe routine | Steps from "I see a wrong element" to "prompt submitted" | Pick, choose action, (type), submit – no screenshot tool, no paste |

The first and third objectives are business aims, judged by the owner after release; they sit outside the acceptance suite. The second is measured by 025-AC-048.

## Scope

### In scope

- Browser tabs in the editor area: address bar, Back, Forward, Reload, Stop, page title and site icon, find in page, zoom, width presets, DevTools; hidden tabs stay loaded; a fixed list of keys reserved for Erfana, every other key going to the page while browsing and to no one while picking.
- `http`, `https` and `file://` addresses, with local files confined to their folder and served by a per-folder loopback server (ADR 0012; Erfana's own window keeps loading from `file://`); terminal links and the HTML Preview open pages in a browser tab.
- One persistent browser profile per project in `<project>/.erfana/browser`, kept out of git, with cookies encrypted at rest and a notice on Linux machines without a keyring.
- Chrome-like site behaviour: permission prompts, downloads, certificate warnings, HTTP sign-in, new tabs, sign-in popups with a visible origin, a popup blocker, clearing browsing data.
- Page right-click menu and **Open in system browser**; page dialogs and leave-page prompts; load-error and crashed-tab pages; per-project address history and local addresses seen in the project's terminal output, shown on an empty tab (Should).
- Pick mode: hover highlight with a label, parent and child refinement, hover-only elements, every frame.
- Pick and prompt by mouse alone: every step from starting pick mode to the send notice works with the pointer, except typing the instruction text (025-NFR-011).
- Four web prompt actions (Explain, Ask, Change, Prompt) sent through the existing prompt-template path to a target terminal that runs an agent, with a notice after each send.
- A capture per send: a context file (page facts, HTML, styles, React hints, recent console and network errors) and one annotated screenshot plus an element crop, deleted automatically after 7 days.
- Release work: no feature flag, a separate Dependabot rule for Electron, a hostile-page test suite and a security audit gate, full URLs in log files as a recorded exception, owner-approved designs before UI code, user-guide risk notes, a release note on the terminal-link change.

### Out of scope

- A promise that Google sign-in works (best effort only – 025-FR-024).
- A password manager: saving or auto-filling passwords typed into sites' own forms.
- Browser extensions.
- The agent driving the browser itself (MCP browser tools) – a later feature.
- One prompt that carries several picked elements.
- Restoring browser tabs when a project reopens; unloading hidden tabs to save memory.
- A feature flag or a hidden off-switch.
- Stripping form values or other client data from captures (reconfirmed by the owner on 2026-11-01).
- Picking by keyboard alone (without a mouse).
- Following up on the last picked element after a reload (a follow-up candidate, 05-notes).
- Screen-reader support for pick mode (screen-reader support left Erfana in #440).

## Success criteria

| Criterion | Metric | Target |
|-----------|--------|--------|
| Pick precision | First-try hits, 3 runs of the same 20 pre-registered picks over the sample apps, Claude Code (025-NFR-003) | ≥ 54 of 60 |
| Isolation holds | Hostile-page tests on every pull request, and high or critical findings in the release security audit (025-NFR-001) | All pass; 0 |
| Engine stays patched | Days from an Electron security release to an Erfana release (025-NFR-002) | ≤ 14 |
| Works everywhere Erfana ships | Platforms that pass the acceptance suite (025-NFR-006) | macOS, Windows, Linux |
| Logins survive a restart | Signed-in session still valid after Erfana restarts (025-AC-015) | Yes, on all three platforms |
| Team use | Two-week dogfood log by the Qodeca team, with no telemetry: picks per day, menus closed without sending, dialogs cancelled, action used, re-sends on the same element within 10 minutes; summarised in `docs/testing/browser-dogfood.md` | Owner-judged after the first release (not a release gate) |

## Target users

| User type | Description | Key needs |
|-----------|-------------|-----------|
| Qodeca team reviewer (primary) | Developer or reviewer who has a CLI agent (mainly Claude Code) build or change a web app | Point at a wrong element and get it fixed on the first try; stay signed in to staging per project |
| Public Erfana user | Anyone who installs Erfana and uses it with a CLI agent | The same, without surprises about what is stored, sent or logged |

When the two differ, the Qodeca team's workflow decides.

## Context

- **Origin.** The plan was settled in a grill-me interview on 2026-10-31; the founding owner decisions come from that interview; later ones are dated where they appear.
- **Today's routine.** The team takes a screenshot in Chrome, pastes it into the terminal and describes the element in words. It is slow, and the agent often edits the wrong element.
- **Prior art.** Cursor drops a chip for the picked element into its chat box; VS Code's experimental integrated browser attaches HTML, CSS and a screenshot through **Add Element to Chat**. Both separate human picking from agent-driven browser tools, and Cursor cannot pick inside iframes. Erfana has no chat box, so it reuses its prompt templates, which type into the terminal and submit.
- **What exists.** The HTML Preview already runs pages in a sandboxed `WebContentsView` and has an element picker for comments (spec 024); `capturePage` takes view screenshots; `executePromptTemplate` (`src/renderer/src/utils/panelUtils.ts`) sends prompt templates to the terminal; terminal links open through `createTerminalLinkHandler` (`src/renderer/src/components/Panels/TerminalPanel/terminalPanel.logic.ts`).
- **What is new.** The HTML Preview only loads project files and blocks remote hosts by default. The browser opens any site, so it has its own session, its own security posture, and a lasting duty to ship engine security fixes (025-NFR-002).
- **Designs.** Screen designs live in `docs/designs/browser/` and are part of this spec by link (025-FR-043).
