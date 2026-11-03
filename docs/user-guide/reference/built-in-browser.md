<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Use the built-in browser

A browser tab shows a web page, your dev server or a project HTML file inside Erfana, next to the terminal where your agent runs. You can pick an element on the page and send it to the agent with your instruction. Erfana has no built-in AI – the page and your instruction go to the CLI agent you run in the terminal. What the browser stores, sends and logs is on [browser data handling](browser-data-handling.md).

**On this page**

- [Opening a browser tab](#opening-a-browser-tab)
- [Address bar](#address-bar)
- [Navigation and the More menu](#navigation-and-the-more-menu)
- [Pick and send](#pick-and-send)
- [Permissions and sign-in](#permissions-and-sign-in)
- [Keyring notices on Linux](#keyring-notices-on-linux)
- [Pop-ups](#pop-ups)
- [Certificates](#certificates)
- [A page that stops responding](#a-page-that-stops-responding)
- [Clear and forget browsing data](#clear-and-forget-browsing-data)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Known limits](#known-limits)

## Opening a browser tab

**What it does:** Opens an empty browser tab with the address bar focused. **How to reach it:** the **New browser tab** button after the last tab of an editor strip, **File > New browser tab**, or <kbd>⌘T</kbd> / <kbd>Ctrl+T</kbd>. Two more ways open a page directly:

- A plain click on a web link in the [terminal](terminal.md#web-links) opens it in a new browser tab; <kbd>⌘</kbd>-click / <kbd>Ctrl</kbd>-click opens your system browser instead.
- In an [HTML preview](html-preview.md), **Open in browser tab** (the window icon in the toolbar) opens the previewed file in a browser tab. Selecting an HTML file in the project tree still opens the preview.

Browser tabs are not restored when you reopen a project or restart Erfana. A tab hidden behind another keeps its page loaded.

## Address bar

**What it does:** Loads what you type when you press <kbd>Enter</kbd>. An address with `http://`, `https://` or `file://` loads as written. `localhost` and IP addresses, with or without a port, and a name with a port such as `app.localhost:3000` or `devbox:3000` load over `http://`. Any other name with a dot, such as `github.com`, loads over `https://`. Anything else, including text with a space, is searched with DuckDuckGo. Nothing you type is sent anywhere before you press <kbd>Enter</kbd>. **How to reach it:** the **Address and search** field, or <kbd>⌘L</kbd> / <kbd>Ctrl+L</kbd>.

Other kinds of address, such as `javascript:`, `chrome:` or a Windows path like `C:\site\index.html`, are refused with a message and are never searched. A network path starting with `\\` or `//` is refused too.

A local file shows as a `file://` address. Erfana serves it from your computer only, to that tab, and the page may load images, styles and scripts from its own folder and the folders below it. A file in a folder or with a name that starts with a dot is refused.

## Navigation and the More menu

**What it does:** **Back**, **Forward** and **Reload** work as in other browsers; **Reload** becomes **Stop loading** while a page loads. **More** holds **Zoom in**, **Zoom out**, **Find in page…**, **Open in system browser**, **DevTools**, **Clear browsing data…** and **Forget this project's browser data…**. **How to reach it:** the navigation row above the page.

Zoom steps from 25% to 500% and is kept per site in the project, as in Chrome. **Find in page…** highlights every match and moves with <kbd>Enter</kbd> and <kbd>⇧Enter</kbd> / <kbd>Shift+Enter</kbd>.

## Pick and send

**What it does:** Sends one element of the page to the agent in a terminal, with a screenshot and a context file. **How to reach it:** **Pick element** in the **Pick and send** row under the address bar, or <kbd>⌘E</kbd> / <kbd>Ctrl+E</kbd>.

1. Select **Pick element**. The row reads **Picking – click an element**.
2. Click the element. Erfana holds a still image of the page and opens the actions panel next to the element. **Parent element** and **Child element** (or <kbd>↑</kbd> and <kbd>↓</kbd>) move the pick. The panel shows the element's text and, when the page names it, its source file and line.
3. Choose an action. **Explain** sends at once. **Ask…**, **Change…** and **Prompt…** open a box for your instruction first; **Send** (or <kbd>⌘Enter</kbd> / <kbd>Ctrl+Enter</kbd>) sends it.

After a send, the element you sent flashes briefly with an outline on the live page.

The target button at the end of the row names the terminal that receives the send. When no agent seems to run there, Erfana stops before sending: **No agent is running in** that terminal shows with **Choose terminal**, and with no terminal open, **Open terminal**. When Erfana sees another program or cannot tell, it asks whether to **Send anyway**. The **Page width** button in the same row sets the page to **Phone width (390px)**, **Tablet width (768px)** or **Full width**, so you can pick in that layout.

The text of a page goes to the agent as data, inside a fenced block, never as part of your instruction. A page can still carry hidden instructions – see [browser data handling](browser-data-handling.md#risks).

## Permissions and sign-in

**What it does:** When a site asks for the camera, the microphone, screen sharing, your location or clipboard read, a row at the top of the tab names the site and offers **Allow** and **Block**; camera and microphone also offer **Allow once**. Erfana remembers your answer for this site in this project. Screen sharing always asks. **How to reach it:** answer the row; to undo answers, use **Clear browsing data…**.

A site that asks you to sign in with a browser box shows **Username**, **Password** and **Remember for this project**. A saved sign-in is stored encrypted with your system's keyring in the project's browser data.

## Keyring notices on Linux

**What it does:** On Linux without a keyring, the first browser tab of a project after each start shows **No keyring – cookies and other site data on this computer are stored with weak protection**. **Dismiss** hides it for that project for good. While there is no keyring:

- **Remember for this project** is unticked and disabled, and reads **No keyring – cannot store passwords safely**.
- Your answers to permission requests, certificate exceptions, allowed pop-ups, saved sign-ins and zoom levels last until Erfana closes.

If the keyring changes and stored cookies can no longer be read, the tab says once **Logins were reset because the keyring changed**. Sign in to your sites again.

## Pop-ups

**What it does:** A page may open a tab or window only right after you click or press a key on it, and at most 5 per tab in a minute. A link to a new tab opens a browser tab; a page that keeps a handle to its window opens a separate pop-up window, 800 × 600 unless the page asks for a size. Other attempts are blocked and the tab shows **Pop-up blocked** with **Allow once** and **Always allow for this site**. **How to reach it:** answer the row.

## Certificates

**What it does:** A page with a certificate that is self-signed, expired, for another site or otherwise not valid is not shown. Erfana's own warning page names the host, with **Back to safety** and **Proceed anyway**. **Proceed anyway** loads the page and remembers the choice for that host and certificate for 7 days, or until you clear browsing data. **How to reach it:** the warning page.

## A page that stops responding

**What it does:** When a page's script keeps the page busy, the tab shows **This page is not responding.** with **Wait** and **Reload**. Reloading loses anything not saved on the page. **How to reach it:** answer the row.

## Clear and forget browsing data

**What it does:** **Clear browsing data…** opens a dialog with five kinds of data for this project: **Cookies and other site data**, **Cached files**, **Site permissions, certificate exceptions and pop-up exceptions**, **Saved sign-in credentials** and **Captures**. **Clear** removes the ticked kinds and reloads this project's browser tabs; kinds you did not tick are left alone. **Forget this project's browser data…** closes the project's browser tabs and deletes the `.erfana/browser` folder, after you confirm with **Forget browser data**; the button reads **Forgetting…** until it is done. **How to reach it:** **More** in the navigation row.

## Keyboard shortcuts

These work while a browser tab is active, including while the page has focus.

| Action | macOS | Windows and Linux |
| --- | --- | --- |
| New browser tab | <kbd>⌘T</kbd> | <kbd>Ctrl+T</kbd> |
| Focus the address bar | <kbd>⌘L</kbd> | <kbd>Ctrl+L</kbd> |
| Back | <kbd>⌘[</kbd> | <kbd>Alt+←</kbd> |
| Forward | <kbd>⌘]</kbd> | <kbd>Alt+→</kbd> |
| Reload | <kbd>⌘R</kbd> | <kbd>Ctrl+R</kbd> or <kbd>F5</kbd> |
| Close the tab | <kbd>⌘W</kbd> | <kbd>Ctrl+W</kbd> |
| Pick and send | <kbd>⌘E</kbd> | <kbd>Ctrl+E</kbd> |
| Find in page | <kbd>⌘F</kbd> | <kbd>Ctrl+F</kbd> |
| Zoom in, out, reset | <kbd>⌘+</kbd>, <kbd>⌘-</kbd>, <kbd>⌘0</kbd> | <kbd>Ctrl++</kbd>, <kbd>Ctrl+-</kbd>, <kbd>Ctrl+0</kbd> |
| DevTools | <kbd>F12</kbd> | <kbd>F12</kbd> |
| Next and previous area | <kbd>F6</kbd>, <kbd>⇧F6</kbd> | <kbd>F6</kbd>, <kbd>Shift+F6</kbd> |

## Known limits

- **Framed or linked local pages are limited.** Only the local file you opened gets its folder's storage. A local page shown in a frame, or reached by a link from a local page, opens without storage, without module scripts and without access to the page that opened it. For a local app that needs them, run a dev server and open its `http://localhost` address.
- **Local storage lasts one run.** A local file's storage is tied to an address that changes at every start of Erfana, so it is gone after a restart.
- **Text pasted or dropped into the terminal may ask first.** See [copy and paste](terminal.md#copy-and-paste).
- **Google sign-in may not work** in a browser tab.
