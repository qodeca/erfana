# Requirements

"Ctrl/Cmd" means Cmd on macOS and Ctrl on Windows and Linux. "The profile folder" is `<project>/.erfana/browser/`. A few requirements (025-FR-005, 025-FR-011, 025-FR-014) group closely related rules of one behaviour under one ID; their acceptance criteria test each rule separately.

## Functional requirements

| ID | Requirement | Priority | Traces to | Acceptance |
|----|-------------|----------|-----------|------------|
| 025-FR-001 | New browser tab command and button | Must | 025-UC-001 | 025-AC-001 |
| 025-FR-002 | Address bar with search fallback | Must | 025-UC-001 | 025-AC-002 |
| 025-FR-003 | Back, Forward, Reload, Stop | Must | 025-UC-002 | 025-AC-003 |
| 025-FR-004 | Several browser tabs in the editor area | Must | 025-UC-002 | 025-AC-004 |
| 025-FR-005 | `http`, `https` and `file://` addresses | Must | 025-UC-002 | 025-AC-005 |
| 025-FR-006 | No browser tabs are restored when a project reopens | Must | – | 025-AC-006 |
| 025-FR-007 | Hidden browser tabs stay loaded | Must | – | 025-AC-007 |
| 025-FR-008 | Find in page and zoom | Should | – | 025-AC-008 |
| 025-FR-009 | Terminal links open in a browser tab; Ctrl/Cmd-click opens the OS browser | Must | 025-UC-002 | 025-AC-009 |
| 025-FR-010 | Open in browser tab from the HTML Preview | Must | – | 025-AC-010 |
| 025-FR-011 | New-tab links and sign-in popups | Must | 025-UC-003 | 025-AC-011 |
| 025-FR-012 | Viewport size presets | Must | 025-UC-005 | 025-AC-012 |
| 025-FR-013 | DevTools in its own window | Must | – | 025-AC-013 |
| 025-FR-014 | Erfana reserves a fixed key list; key routing in browsing and pick states | Must | – | 025-AC-014 |
| 025-FR-015 | One persistent profile per project | Must | 025-UC-003, 025-UC-006 | 025-AC-015 |
| 025-FR-016 | The profile folder ignores itself in git | Must | – | 025-AC-016 |
| 025-FR-017 | Cookies encrypted at rest | Must | 025-UC-003 | 025-AC-017 |
| 025-FR-018 | Linux without a keyring: one-time warning | Must | – | 025-AC-018 |
| 025-FR-019 | Site permission prompts | Must | – | 025-AC-019 |
| 025-FR-020 | Downloads ask first | Must | – | 025-AC-020 |
| 025-FR-021 | Certificate warning with Proceed anyway | Must | 025-UC-003 | 025-AC-021 |
| 025-FR-022 | HTTP basic-auth sign-in box | Must | 025-UC-003 | 025-AC-022 |
| 025-FR-023 | Clear browsing data | Must | 025-UC-006 | 025-AC-023 |
| 025-FR-024 | Best-effort Google sign-in | Could | 025-UC-003 | 025-AC-024 |
| 025-FR-025 | Pick mode on and off | Must | 025-UC-001, 025-UC-004 | 025-AC-025 |
| 025-FR-026 | Hover highlight with a label | Must | 025-UC-001, 025-UC-004 | 025-AC-026 |
| 025-FR-027 | Parent and child refinement | Must | 025-UC-001, 025-UC-004 | 025-AC-027 |
| 025-FR-028 | Picking hover-only elements by shortcut | Must | 025-UC-004 | 025-AC-028 |
| 025-FR-029 | Picking in every frame | Must | 025-UC-001 | 025-AC-029 |
| 025-FR-030 | Confirming a pick opens the web prompt-actions menu | Must | 025-UC-001, 025-UC-004 | 025-AC-030 |
| 025-FR-031 | Which actions open a dialog | Must | 025-UC-001, 025-UC-004 | 025-AC-031 |
| 025-FR-032 | Sending through the prompt-template path | Must | 025-UC-001, 025-UC-004 | 025-AC-032 |
| 025-FR-033 | The context file | Must | 025-UC-001, 025-UC-004, 025-UC-005 | 025-AC-033 |
| 025-FR-034 | The screenshot | Must | 025-UC-001, 025-UC-004, 025-UC-005 | 025-AC-034 |
| 025-FR-035 | Partly visible elements | Must | 025-UC-001 | 025-AC-035 |
| 025-FR-036 | Page-derived content sent as-is, all of it inside the untrusted block | Must | 025-UC-001 | 025-AC-036 |
| 025-FR-037 | React component and source hints | Must | 025-UC-001 | 025-AC-037 |
| 025-FR-038 | Recent console and network errors | Must | 025-UC-001 | 025-AC-038 |
| 025-FR-039 | Captures expire after 7 days | Must | – | 025-AC-039 |
| 025-FR-040 | On for everyone, with no flag | Must | – | 025-AC-040 |
| 025-FR-041 | Separate Dependabot rule for Electron | Must | – | 025-AC-041 |
| 025-FR-042 | Full URLs in logs, as a recorded exception | Must | – | 025-AC-042 |
| 025-FR-043 | Designs linked and approved before UI code | Must | – | 025-AC-043 |
| 025-FR-044 | User guide states the known risks | Must | – | 025-AC-044 |
| 025-FR-045 | Release note on the terminal-link change | Must | – | 025-AC-045 |
| 025-FR-046 | A capture that cannot be saved sends nothing | Must | 025-UC-001, 025-UC-004, 025-UC-005 | 025-AC-060 |

### Tabs and navigation

### 025-FR-001: New browser tab command and button

**Description:** Erfana shall offer a **New browser tab** command (command palette and menu) and a button that opens an empty browser tab with the address bar focused.

**Priority:** Must · **Traces to:** 025-UC-001 · **Acceptance:** 025-AC-001

### 025-FR-002: Address bar with search fallback

**Description:** Each browser tab shall have an address bar. Input with the scheme `http://`, `https://` or `file://` shall load that address. Input that starts with any other scheme – letters, digits, `+`, `-` or `.` followed by `:`, for example `chrome://settings`, `javascript:alert(1)` or `mailto:a@b.c` – shall be handled by 025-FR-005 (refused) and never searched; `localhost:` and `host:port` forms are not schemes. `localhost` and an IP address, each with an optional port and path (for example `localhost:5173/admin` or `127.0.0.1:4100/api`), shall load as `http://`. A host name containing a dot, with or without a port or path and with no spaces (for example `github.com` or `staging.example.com/app`), shall load as `https://`. Any other input – including a single word with no dot other than `localhost`, and any input with a space – shall load a DuckDuckGo search for the text. The bar shall show the current address after every navigation, including redirects. Loading an address from the bar shall move keyboard focus to the page.

**Priority:** Must · **Traces to:** 025-UC-001 · **Acceptance:** 025-AC-002

### 025-FR-003: Back, Forward, Reload, Stop

**Description:** Each browser tab shall have Back, Forward and Reload buttons; Reload shall become Stop while a page loads. Back and Forward shall be disabled when there is no history in that direction.

**Priority:** Must · **Traces to:** 025-UC-002 · **Acceptance:** 025-AC-003

### 025-FR-004: Several browser tabs in the editor area

**Description:** Browser tabs shall open in the editor area as tabs that the user can close and reorder by dragging, as preview tabs can. Erfana sets no limit on the number of open browser tabs. Each tab shall show the page title (the address while no title is known) and the site icon, with a generic icon when the site has none.

**Priority:** Must · **Traces to:** 025-UC-002 · **Acceptance:** 025-AC-004

### 025-FR-005: `http`, `https` and `file://` addresses

**Description:** A browser tab shall load `http`, `https` and `file://` addresses. A `file://` page shall not be able to read any other `file://` resource by `fetch`, `XMLHttpRequest` or from inside a frame; it may still display resources it embeds with `<img>`, `<link>` and `<script>`, as Chromium allows. The 025-NFR-001 audit checks this limit. Any other scheme typed into the address bar (for example `javascript:`, `chrome:`, `devtools:`, `about:`, `blob:`, `data:`) shall be refused with an inline message. A page, its frames and its popups may also use, as Chromium allows: `about:blank` for new windows and frames, `blob:` URLs of the page's own origin (for example downloads and generated frames), and `data:` URLs for subresources and frames; a top-level navigation to `data:` stays blocked, as in Chromium. A page's navigation to any other scheme (for example `chrome:`, `devtools:`, `file:` from an `http` or `https` page, `javascript:` in a new window) shall be blocked.

**Priority:** Must · **Traces to:** 025-UC-002 · **Acceptance:** 025-AC-005

### 025-FR-006: No browser tabs are restored when a project reopens

**Description:** When a project is closed and reopened, or Erfana restarts, no browser tab shall be restored. The profile data (025-FR-015) is kept.

**Priority:** Must · **Acceptance:** 025-AC-006

### 025-FR-007: Hidden browser tabs stay loaded

**Description:** A browser tab that is hidden behind another tab shall keep its page loaded; switching back shall show the same page state (scroll position, form input, running scripts) without a reload.

**Priority:** Must · **Acceptance:** 025-AC-007

### 025-FR-008: Find in page and zoom

**Description:** Ctrl/Cmd+F shall open a find bar for the active browser tab that highlights every match, shows the current match number and the total, and moves to the next and previous match with Enter and Shift+Enter. Ctrl/Cmd+Plus and Ctrl/Cmd+Minus shall step the tab's zoom through 25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400 and 500%, and Ctrl/Cmd+0 shall reset it to 100%.

**Priority:** Should · **Acceptance:** 025-AC-008

### 025-FR-009: Terminal links open in a browser tab; Ctrl/Cmd-click opens the OS browser

**Description:** A plain click on an `http` or `https` link in Erfana's terminal shall open it in a new browser tab. A Ctrl/Cmd-click shall open it in the operating system's default browser through the existing checked external-open path. This changes today's behaviour, where a plain click opens the OS browser.

**Priority:** Must · **Traces to:** 025-UC-002 · **Acceptance:** 025-AC-009

### 025-FR-010: Open in browser tab from the HTML Preview

**Description:** The HTML Preview shall offer an **Open in browser tab** action that opens the previewed file as a `file://` address in a new browser tab. Clicking an HTML file in the project tree shall still open the HTML Preview.

**Priority:** Must · **Acceptance:** 025-AC-010

### 025-FR-011: New-tab links and sign-in popups

**Description:** A link with `target="_blank"` or a middle-click shall open a new browser tab. A `window.open` call without a width or height shall open a new browser tab. A `window.open` call with a width or height (as used by OAuth sign-in) shall open as a separate window at the requested size, limited to the screen's work area, that keeps its `window.opener` link to the page, so the sign-in can report back. The popup shall use the same project profile.

**Priority:** Must · **Traces to:** 025-UC-003 · **Acceptance:** 025-AC-011

### 025-FR-012: Viewport size presets

**Description:** The tab toolbar shall offer size presets: **Phone** (390 px wide), **Tablet** (768 px wide) and **Desktop** (the full panel width). A preset shall set the page's viewport width; pick mode and screenshots shall work at every preset.

**Priority:** Must · **Traces to:** 025-UC-005 · **Acceptance:** 025-AC-012

### 025-FR-013: DevTools in its own window

**Description:** F12 and a toolbar button shall open Chrome DevTools for the active browser tab in a separate window. Closing the tab shall close its DevTools window.

**Priority:** Must · **Acceptance:** 025-AC-013

### 025-FR-014: Erfana reserves a fixed key list; key routing in browsing and pick states

**Description:** The **browser keys** are: Ctrl/Cmd+L (address bar), Ctrl/Cmd+R and F5 (reload), Ctrl/Cmd+W (close tab), Ctrl/Cmd+T (new browser tab), Alt+Left and Alt+Right on Windows and Linux or Cmd+[ and Cmd+] on macOS (back, forward), F12 (DevTools), Ctrl/Cmd+E (pick, 025-FR-025 and 025-FR-028), Ctrl/Cmd+F (find) and the zoom keys of 025-FR-008.

Terms: **page focus** means keyboard focus is inside the web page or one of its frames; **toolbar focus** means keyboard focus is in the tab's own controls (address bar, find bar, toolbar buttons). When keyboard focus is anywhere outside the browser tab (terminal, editor, another panel), that place handles the keys as it does today and the browser tab receives none, whatever state the tab is in.

While keyboard focus is in the browser tab, exactly one of these five rules applies:

1. **Browsing** – pick mode off, no prompt-actions menu or dialog open, page focus: Erfana shall handle the browser keys; every other key, including keys bound to Erfana app shortcuts, shall go to the page.
2. **Pick mode** – pick mode on, no prompt-actions menu or dialog open, page focus: Erfana shall handle the browser keys and Esc, Up, Down and Enter; the page shall receive no key, and every other key does nothing.
3. **Menu** – a prompt-actions menu open: Erfana shall handle Esc, Up, Down, Enter, Tab, Shift+Tab and Space for the menu (025-FR-027, 025-FR-030) and the browser keys except Ctrl/Cmd+E and Ctrl/Cmd+F, which do nothing; the page shall receive no key, and every other key does nothing.
4. **Dialog** – an instruction dialog open (025-FR-031): keyboard focus shall be in the dialog and every key shall go to the dialog; no browser key acts on the tab and the page receives no key. The user leaves the dialog with Esc, **Cancel** or a submit.
5. **Toolbar** – toolbar focus, no prompt-actions menu or dialog open, in either browsing or pick mode (pick mode starts with page focus, 025-FR-025, so this rule applies in pick mode only after the user moves focus to the toolbar): typing goes to the focused control; the browser keys keep their actions except Ctrl/Cmd+E, which does nothing; the page receives no key.

Under rules 1, 2, 3 and 5, a browser key that navigates or closes the tab ends pick mode (025-FR-025) and closes any open menu without sending.

**Priority:** Must · **Acceptance:** 025-AC-014

### Profile and site data

### 025-FR-015: One persistent profile per project

**Description:** Each project shall have its own browser profile under the profile folder. Cookies, local storage, cache, site permissions, certificate exceptions and saved basic-auth credentials shall persist across Erfana restarts and stay separate between projects, and the browser session shall be separate from Erfana's own session and from the HTML Preview's session. Profile data shall live in `.erfana/browser/profile/` and captures in `.erfana/browser/captures/`.

**Priority:** Must · **Traces to:** 025-UC-003, 025-UC-006 · **Acceptance:** 025-AC-015

### 025-FR-016: The profile folder ignores itself in git

**Description:** Before any profile data or capture is written, Erfana shall ensure `.erfana/browser/.gitignore` exists with the content `*`, so git ignores the whole folder. If the file is missing when a browser tab opens, Erfana shall write it again before loading the page. Erfana shall not edit the project's own `.gitignore`. If writing the file fails, the browser tab shall not open and an error toast shall name the reason.

**Priority:** Must · **Acceptance:** 025-AC-016

### 025-FR-017: Cookies encrypted at rest

**Description:** The Electron `EnableCookieEncryption` fuse shall be turned on, so cookies on disk are encrypted with the operating system's key store (Keychain on macOS, DPAPI on Windows, the Secret Service keyring on Linux).

**Priority:** Must · **Traces to:** 025-UC-003 · **Acceptance:** 025-AC-017

### 025-FR-018: Linux without a keyring: one-time warning

**Description:** On Linux, when no keyring is available and Chromium falls back to its built-in key, the first browser tab opened in a project after each Erfana start shall show a notice that logins on this machine are stored with weak protection, until the user dismisses it; after dismissal it shall not appear again for that project. The browser shall keep working.

**Priority:** Must · **Acceptance:** 025-AC-018

### 025-FR-019: Site permission prompts

**Description:** When a site requests camera, microphone, screen sharing, location, notifications or clipboard read, the browser tab shall show a prompt naming the site and the permission, with **Allow** and **Block**. The answer shall be saved per site in the project profile. A **Block** answer shall be saved and later requests from that site denied without a prompt. Closing the prompt without an answer shall deny the request for that page load. Fullscreen, pointer lock, clipboard write (sanitized text and images) and persistent storage shall be allowed without a prompt, as Chrome allows them. Every other permission request (for example MIDI, USB, serial, HID, Bluetooth, idle detection) shall be denied without a prompt.

**Priority:** Must · **Acceptance:** 025-AC-019

### 025-FR-020: Downloads ask first

**Description:** A download shall open a save dialog that starts in the operating system's Downloads folder. Cancelling the dialog shall cancel the download. A finished download shall show a notice with the file name and a **Show in folder** action. A download that fails or is interrupted, or whose folder cannot be written, shall show an error notice naming the file and the reason and shall leave no partial file behind.

**Priority:** Must · **Acceptance:** 025-AC-020

### 025-FR-021: Certificate warning with Proceed anyway

**Description:** When a site presents an invalid, expired, self-signed or mismatched certificate, the browser tab shall show a warning page naming the host and the error, with **Back to safety** and **Proceed anyway**. **Proceed anyway** shall load the page and save an exception for that host and certificate in the project profile; the exception shall be cleared by 025-FR-023.

**Priority:** Must · **Traces to:** 025-UC-003 · **Acceptance:** 025-AC-021

### 025-FR-022: HTTP basic-auth sign-in box

**Description:** When a site answers with an HTTP authentication challenge, Erfana shall show a sign-in box naming the host, with **Username**, **Password**, a **Remember for this project** checkbox, **Sign in** and **Cancel**. With the checkbox ticked, the credentials shall be saved for that host in the project, encrypted with the operating system's key store (on Linux without a keyring, with Chromium's fallback key, covered by the 025-FR-018 notice), and used for later challenges from that host without asking. A rejected saved credential shall show the box again with an error line.

**Priority:** Must · **Traces to:** 025-UC-003 · **Acceptance:** 025-AC-022

### 025-FR-023: Clear browsing data

**Description:** A **Clear browsing data** command shall open a dialog for the current project with four checkboxes – **Cookies and other site data** (cookies, local storage, session storage, IndexedDB, service workers), **Cached files**, **Site permissions and certificate exceptions**, **Saved sign-in credentials** – and **Clear** and **Cancel**. When the dialog opens, **Cookies and other site data** and **Cached files** are ticked and the other two are not; **Clear** is disabled while no box is ticked. **Clear** shall remove the checked data for this project only and reload open browser tabs. If clearing fails (for example a locked profile file), an error toast shall name the reason, and data whose checkbox was not ticked shall stay untouched.

**Priority:** Must · **Traces to:** 025-UC-006 · **Acceptance:** 025-AC-023

### 025-FR-024: Best-effort Google sign-in

**Description:** The browser shall present a user-agent string that matches the bundled Chromium version without Electron or Erfana tokens, to improve the chance that Google sign-in is accepted. Google sign-in working is not a release condition.

**Priority:** Could · **Traces to:** 025-UC-003 · **Acceptance:** 025-AC-024

### Pick and send

### 025-FR-025: Pick mode on and off

**Description:** A **Pick element** toolbar button shall toggle pick mode for the active browser tab. Pressing Ctrl/Cmd+E while pick mode is off shall start pick mode; pressing it while pick mode is on and no prompt-actions menu or dialog is open shall pick at once (025-FR-028); while a menu or dialog is open it does nothing (025-FR-014). Starting pick mode, by the button or by Ctrl/Cmd+E, shall move keyboard focus to the page, so 025-FR-014 rule 2 applies. In pick mode, clicks on the page shall not reach the page. Esc, while no prompt-actions menu or dialog is open, or the button shall leave pick mode; leaving pick mode also unfreezes the page if 025-FR-028 froze it. Pick mode shall end when the tab navigates.

**Priority:** Must · **Traces to:** 025-UC-001, 025-UC-004 · **Acceptance:** 025-AC-025

### 025-FR-026: Hover highlight with a label

**Description:** In pick mode, the element under the mouse shall be outlined, and a label next to it shall show the element's tag, then `#id` if it has one, otherwise its first three classes in document order (this tag, id and class text cut to 40 characters), followed by its size in CSS pixels, which is never cut. The outline and label shall not change the page's layout and shall not appear in the page's DOM as seen by the page's own scripts.

**Priority:** Must · **Traces to:** 025-UC-001, 025-UC-004 · **Acceptance:** 025-AC-026

### 025-FR-027: Parent and child refinement

**Description:** In pick mode, the Up arrow shall move the highlight to the parent element and the Down arrow back toward the element first hovered. Up at the root element and Down at the element first hovered shall do nothing. Enter or a click shall confirm the highlighted element. While the prompt-actions menu of a pick is open, Up and Down shall move the picked element the same way, and the menu shall follow it; Enter then runs the focused action (025-FR-030) and does not confirm the element again.

**Priority:** Must · **Traces to:** 025-UC-001, 025-UC-004 · **Acceptance:** 025-AC-027

### 025-FR-028: Picking hover-only elements by shortcut

**Description:** In pick mode, with no prompt-actions menu or dialog open and the mouse over an element, pressing Ctrl/Cmd+E again shall pick the element under the mouse at once, while hover-only content (menus, tooltips) is still shown, and open the menu of 025-FR-030. Entering pick mode shall not close hover-only content the mouse is over. The page state shall be frozen (scripts and timers paused) from the pick until the menu or its dialog closes.

**Priority:** Must · **Traces to:** 025-UC-004 · **Acceptance:** 025-AC-028

### 025-FR-029: Picking in every frame

**Description:** Pick mode, the highlight, refinement and the capture shall work for elements inside iframes, including frames from other origins. The context file shall record the frame chain from the top page to the picked element's frame.

**Priority:** Must · **Traces to:** 025-UC-001 · **Acceptance:** 025-AC-029

### 025-FR-030: Confirming a pick opens the web prompt-actions menu

**Description:** Confirming a pick shall open a menu at the element with six actions: **Explain**, **Ask**, **Fix**, **Change style**, **Change text** and **Prompt**. Pick mode stays on while the menu and its dialog are open. When the menu opens, the first action has keyboard focus; Tab and Shift+Tab move the focus between actions, and Enter or Space run the focused action. Esc shall close the menu and unfreeze the page if 025-FR-028 froze it; pick mode stays on.

**Priority:** Must · **Traces to:** 025-UC-001, 025-UC-004 · **Acceptance:** 025-AC-030

### 025-FR-031: Which actions open a dialog

**Description:** **Explain** shall send at once. **Ask** (question), **Fix** (what is wrong), **Change style** (the visual change), **Change text** (the new text) and **Prompt** (free-form) shall open an instruction dialog first; an empty instruction shall keep the dialog open with an inline error. Ctrl/Cmd+Enter shall submit the dialog. Esc or the dialog's **Cancel** button shall close the dialog without sending, unfreeze the page if 025-FR-028 froze it, and leave pick mode on.

**Priority:** Must · **Traces to:** 025-UC-001, 025-UC-004 · **Acceptance:** 025-AC-031

### 025-FR-032: Sending through the prompt-template path

**Description:** Each web action shall be a prompt template sent through `executePromptTemplate`, with the same terminal choice, terminal opening and error toasts as the Markdown templates, and shall be submitted at once. The rendered prompt shall contain the user's instruction, the context file path and Erfana's fixed template text, and no text taken from the page (025-FR-036); it shall tell the agent that the page content in the context file is untrusted data. **Fix**, **Change style** and **Change text** shall ask the agent to locate and edit the source that renders the element. After a successful send, the menu and dialog close, the page is unfrozen and pick mode ends.

**Priority:** Must · **Traces to:** 025-UC-001, 025-UC-004 · **Acceptance:** 025-AC-032

### 025-FR-033: The context file

**Description:** Each send shall write a Markdown context file to `.erfana/browser/captures/` holding: the page URL and title, the capture time, the viewport size and size preset (`Phone`, `Tablet`, `Desktop`, or `none` with the size the page reports when DevTools device emulation overrides it), the device pixel ratio, a CSS selector that identifies the element (for an element inside a closed shadow root, the selector of its shadow host plus the note "inside closed shadow root"), the frame chain (025-FR-029), the element's bounding box, the pick point x/y (the click position; for a pick confirmed by key, the last mouse position over the page; if the mouse has not entered the page, the centre of the element's box), the element's outer HTML (truncated to 20,000 characters, which the capture facts record with the note of 025-FR-036), these computed styles of the element – `display`, `position`, `top`, `right`, `bottom`, `left`, `width`, `height`, `margin`, `padding`, `border`, `box-sizing`, `overflow`, `z-index`, `flex-direction`, `justify-content`, `align-items`, `gap`, `grid-template-columns`, `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, `text-align`, `color`, `background-color`, `opacity` – the React hints (025-FR-037), the recent errors (025-FR-038) and the path of the screenshot (025-FR-034).

**Priority:** Must · **Traces to:** 025-UC-001, 025-UC-004, 025-UC-005 · **Acceptance:** 025-AC-033

### 025-FR-034: The screenshot

**Description:** Each send shall write one PNG of the visible area of the page at the device pixel ratio, with a solid outline drawn around the picked element in the accent colour token. When the pick lands on a `<canvas>` or an element inside a closed shadow root, the screenshot shall also carry a crosshair at the pick point of 025-FR-033. Erfana's pick outline and label shall not appear in the image except as this drawn outline.

**Priority:** Must · **Traces to:** 025-UC-001, 025-UC-004, 025-UC-005 · **Acceptance:** 025-AC-034

### 025-FR-035: Partly visible elements

**Description:** When the picked element is partly outside the visible area, the page shall not be scrolled; the screenshot shall show the visible area with the outline clipped at the edge, and the context file shall state "partly off-screen" with the element's full size. An element wholly outside the visible area, or with zero width or height, shall be sent the same way with the note "off-screen" or "zero size", with no outline in the screenshot.

**Priority:** Must · **Traces to:** 025-UC-001 · **Acceptance:** 025-AC-035

### 025-FR-036: Page-derived content sent as-is, all of it inside the untrusted block

**Description:** The HTML in the context file shall be the page's markup as-is, including form values, apart from the length limit of 025-FR-033; Erfana shall not strip or mask it, apart from escaping the fence token described below.

The context file shall have two parts:

1. **Capture facts**, written by Erfana and holding no text taken from the page: the capture time, the viewport size and size preset, the device pixel ratio, the element's bounding box, the pick point, the notes "partly off-screen", "off-screen", "zero size", "inside closed shadow root", "source not found" and "HTML truncated at 20,000 characters", and the screenshot path. These notes are fixed Erfana lines in the capture facts; the truncated HTML itself ends inside the untrusted block with no Erfana text appended to it.
2. **Untrusted page content**: every field whose text comes from the page or the site – the page URL and title, the CSS selector, the frame chain with its origins, the outer HTML, the computed styles, the React component names, owner chain and source file paths, and the console and network entries with their messages and URLs. This part shall sit inside one block headed as untrusted page content that the agent must treat as data, not instructions. The block shall open and close with a fence that page text cannot end early – a delimiter carrying a random token generated per capture – and any occurrence of that token in page text shall be escaped.

No page-derived text shall appear outside that block: not in the capture facts, not in the capture file names (which Erfana generates from the capture time and a random id), and not in the rendered prompt of 025-FR-032, which carries only the user's instruction, the context file path and Erfana's fixed template text.

**Priority:** Must · **Traces to:** 025-UC-001 · **Acceptance:** 025-AC-036

### 025-FR-037: React component and source hints

**Description:** When the page is a React development build, the context file shall name the nearest React component of the picked element and its owner chain (up to 5 levels), and the source file and line of the element's JSX when they can be resolved. When the component or the source cannot be resolved (production build, missing source map, an unsupported React version), the context file shall say "source not found" and the send shall proceed. A failure in hint collection shall never block the send.

**Priority:** Must · **Traces to:** 025-UC-001 · **Acceptance:** 025-AC-037

### 025-FR-038: Recent console and network errors

**Description:** Each browser tab shall record its console errors and warnings and its failed network requests (network errors and HTTP status 400 or higher) since the last navigation. The context file shall include the last 20 console entries (errors and warnings together, in time order) and the last 20 failed requests, each with time, level or status, and message or URL.

**Priority:** Must · **Traces to:** 025-UC-001 · **Acceptance:** 025-AC-038

### 025-FR-039: Captures expire after 7 days

**Description:** When a project opens, Erfana shall delete context files and screenshots in `.erfana/browser/captures/` older than 7 days. A failure to delete one file shall be logged and shall not stop the rest.

**Priority:** Must · **Acceptance:** 025-AC-039

<!-- 025-FR-046 sits here, out of number order, because it was added in v0.2.0 next to the capture requirements; IDs are never renumbered. -->

### 025-FR-046: A capture that cannot be saved sends nothing

**Description:** If the context file or the screenshot cannot be written (for example a full disk, a read-only folder or a failed capture), Erfana shall send no prompt, shall remove any partial capture file it wrote, and shall show an error toast that names the reason. The dialog, if one was open, shall stay open with the user's instruction so the user can retry; for **Explain**, which has no dialog, the prompt-actions menu shall open again at the element. Pick mode stays on and the page stays frozen if 025-FR-028 froze it, until that dialog or menu closes (025-FR-030, 025-FR-031).

**Priority:** Must · **Traces to:** 025-UC-001, 025-UC-004, 025-UC-005 · **Acceptance:** 025-AC-060

### Release and documentation

### 025-FR-040: On for everyone, with no flag

**Description:** The browser shall ship enabled for every user in its first release, with no setting, feature flag or hidden switch that turns it off.

**Priority:** Must · **Acceptance:** 025-AC-040

### 025-FR-041: Separate Dependabot rule for Electron

**Description:** `.github/dependabot.yml` shall keep `electron` out of the grouped npm updates so each Electron update opens its own pull request, which is the owner's trigger for 025-NFR-002.

**Priority:** Must · **Acceptance:** 025-AC-041

### 025-FR-042: Full URLs in logs, as a recorded exception

**Description:** Erfana's log files shall record full browser URLs (path and query included) for navigation errors and load failures, for support. This is a deliberate exception to the `redactUserInput` convention and shall be recorded in `docs/technical-debt.md` and at each logging site, so reviewers do not flag it.

**Priority:** Must · **Acceptance:** 025-AC-042

### 025-FR-043: Designs linked and approved before UI code

**Description:** Static designs of every new surface – tab toolbar (including the find-in-page bar and the inline message for refused addresses), pick overlay and label, prompt-actions menu and dialogs, sign-in box, certificate warning page, permission prompt, download notice, clear-data dialog and Linux keyring notice – shall live in `docs/designs/browser/`, follow the design-system rules, be linked from this spec's registry entry, and be approved by the owner before UI code for that surface is merged. New patterns shall be added as `proposed` design-system cards.

**Priority:** Must · **Acceptance:** 025-AC-043

### 025-FR-044: User guide states the known risks

**Description:** The user guide shall document the browser, and a risk section shall state: page content goes to the agent and can carry hidden instructions (prompt injection), most dangerous when the agent runs without permission checks; captures send client data as-is to the agent's AI provider; Erfana's log files record full browser URLs, including query strings (025-FR-042); `git clean -fdx` deletes the project's browser profile and captures; Google sign-in may not work.

**Priority:** Must · **Acceptance:** 025-AC-044

### 025-FR-045: Release note on the terminal-link change

**Description:** The release notes of the release that ships the browser shall state that a plain click on a terminal link now opens an Erfana browser tab and that Ctrl/Cmd-click opens the OS browser.

**Priority:** Must · **Acceptance:** 025-AC-045

---

## Non-functional requirements

| ID | Category | Requirement | Metric |
|----|----------|-------------|--------|
| 025-NFR-001 | Security | A page cannot reach Erfana's privileged bridge, the terminal or project files | 0 high or critical findings in the release security audit |
| 025-NFR-002 | Security | The browser engine stays patched | Erfana release ≤ 14 days after each Electron security release |
| 025-NFR-003 | Effectiveness | The agent edits the picked element on the first try | ≥ 18 of 20 picks |
| 025-NFR-004 | Performance | The highlight follows the mouse | ≤ 50 ms from mouse move to outline update (95th percentile) |
| 025-NFR-005 | Performance | Confirm to prompt in the terminal | ≤ 2 s for Explain (95th percentile) |
| 025-NFR-006 | Portability | The browser works on every platform Erfana ships | The acceptance suite passes on macOS, Windows and Linux |
| 025-NFR-007 | Security | Cookies are not readable as plain text from disk | 0 cookie values found in plain text in the profile folder on macOS and Windows |
| 025-NFR-008 | Accessibility | Toolbar controls work by keyboard | 100% of toolbar controls reachable by Tab with a visible focus indicator |

### 025-NFR-001: Isolation from Erfana

**Category:** Security

**Description:** Web pages, their frames and popups shall have no access to Erfana's preload bridge, IPC channels, the terminal or the file system. The pick overlay shall run in an isolated world and accept no input from the page that can trigger a send. The browser session shall be separate from Erfana's own session and from the HTML Preview's session: no cookie, storage entry or permission set in one is visible in another.

**Metric:** 0 high or critical findings.

**Measurement method:** Before release, a security audit (the `security-auditor` agent plus manual review) runs hostile test pages that try to call IPC, reach `window.electron`, forge pick events, open the terminal, read local files and escape through popups, frames and `file://`. The audit report is linked from the release.

**Traces to:** 025-FR-005, 025-FR-011, 025-FR-015, 025-FR-025, 025-FR-029

### 025-NFR-002: Engine security updates

**Category:** Security

**Description:** For as long as the browser ships, each Electron release that carries a Chromium security fix shall be followed by an Erfana release that bundles it. The owner is the project owner.

**Metric:** ≤ 14 calendar days from the Electron release to the Erfana release.

**Measurement method:** Compare the Electron release date with the Erfana release tag date for each security release; reviewed at each Erfana release.

**Traces to:** 025-FR-041

### 025-NFR-003: Pick precision

**Category:** Effectiveness

**Description:** Using the Fix, Change style or Change text action, Claude Code shall change the source that renders the picked element on its first attempt.

**Metric:** ≥ 18 of 20 picks.

**Measurement method:** A fixed list of 20 picks over three sample apps – a local React dev server app, a static site, and a staging-style site behind a login – with the expected source location written down before the run. The builder runs the list once on the release candidate and records hit or miss per pick.

**Traces to:** 025-FR-033, 025-FR-037

### 025-NFR-004: Highlight responsiveness

**Category:** Performance

**Description:** In pick mode, the outline and label shall follow the element under the mouse without visible lag.

**Metric:** ≤ 50 ms from mouse move to outline update, 95th percentile.

**Measurement method:** Performance trace over 200 mouse moves on the React sample app on a reference machine of each platform. A reference machine has at least 4 CPU cores and 8 GB of RAM; each machine's model, CPU, RAM and OS version are recorded in the test plan before the run.

**Traces to:** 025-FR-026

### 025-NFR-005: Send latency

**Category:** Performance

**Description:** From confirming **Explain** to the prompt appearing in the terminal, including the screenshot and the context file.

**Metric:** ≤ 2 s, 95th percentile.

**Measurement method:** 20 timed sends on the React sample app on a reference machine of each platform, as defined in 025-NFR-004.

**Traces to:** 025-FR-032, 025-FR-033, 025-FR-034

### 025-NFR-006: Platforms

**Category:** Portability

**Description:** Every functional requirement shall hold on each of macOS, Windows and Linux where it applies; 025-FR-018 applies to Linux only, and 025-NFR-007 states the Linux exception for cookies at rest.

**Metric:** The acceptance suite passes on all three platforms.

**Measurement method:** E2E and manual acceptance runs on each platform before release.

**Traces to:** all FRs

### 025-NFR-007: Cookies at rest

**Category:** Security

**Description:** Login cookies in the profile folder shall be encrypted with the operating system's key store.

**Metric:** 0 cookie values found in plain text. Linux is covered by 025-FR-018 (keyring notice) and 025-AC-017 (fuse on), because a Linux machine without a keyring cannot meet this metric.

**Measurement method:** Sign in to a test site that sets a known cookie value, close Erfana, then search the profile folder's files for that value on macOS and Windows.

**Traces to:** 025-FR-017

### 025-NFR-008: Keyboard access to the toolbar

**Category:** Accessibility

**Description:** Every control in the browser tab toolbar shall be reachable and operable by keyboard.

**Metric:** 100% of toolbar controls reachable by Tab, each with a visible focus indicator.

**Measurement method:** Keyboard walk-through of the toolbar on each platform.

**Traces to:** 025-FR-002, 025-FR-003, 025-FR-012, 025-FR-013, 025-FR-025

---

## Naming contracts

Proposed canonical names; the solution design may refine them before code, and any change is a spec change.

| Domain | Canonical name | Type | Referenced in |
|--------|---------------|------|--------------|
| IPC channel names | `src/shared/ipc/browser-channels.ts` | module | 025-FR-001 to 025-FR-039 |
| IPC payload schemas | `src/shared/ipc/browser-schema.ts` | module | 025-FR-001 to 025-FR-039 |
| IPC channel prefix | `browser:` | string | 025-FR-001 to 025-FR-039 |
| Panel type | `browser` | panel id | 025-FR-004 |
| Profile data folder | `.erfana/browser/profile/` | path | 025-FR-015 |
| Captures folder | `.erfana/browser/captures/` | path | 025-FR-033, 025-FR-039 |
| Self-ignore file | `.erfana/browser/.gitignore` (content `*`) | file | 025-FR-016 |
| Prompt template ids | `browser-explain`, `browser-ask`, `browser-fix`, `browser-change-style`, `browser-change-text`, `browser-prompt` | string | 025-FR-030, 025-FR-032 |
| Pick shortcut | Ctrl/Cmd+E (once: pick mode; again: pick at once) | key | 025-FR-014, 025-FR-025, 025-FR-028 |
| Electron fuse | `EnableCookieEncryption: true` | build config | 025-FR-017 |
| Design folder | `docs/designs/browser/` | path | 025-FR-043 |
