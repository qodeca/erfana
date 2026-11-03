<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Built-in browser

> Status: **proposed** – revised after design review round 1 and the owner's decisions (both 2026-11-01). The six screens, `index.html` and `browser.css` exist in this folder and are being revised from the same review. **This note is the single source** for the screens, the three new cards and the build: where a screen and this note disagree, this note wins and the screen is the defect.
> Spec: [`specs/spec-t4-025-built-in-browser/`](../../../specs/spec-t4-025-built-in-browser/requirements/01-overview.md) v0.12.0. The surface list this note answers is 025-FR-043; 025-AC-043 checks it.
> Builds on: the HTML preview's bar and fail-safe ([`../html-preview/`](../html-preview/README.md), [`../html-approval/`](../html-approval/README.md)) and the element picker and menus that ship for comments ([`../comments/comments-v2.md`](../comments/comments-v2.md), the decided feature screen `../comments/html-comments/overlay.html`).
> Plan: `.local/plans/spec-025-design-plan.md` (not committed). Review: `.local/panel/design-025-r1/` (not committed).

## Purpose

A browser tab in the editor area that opens any web page – a local dev server, a staging or production site, or an HTML file – lets the reviewer pick one element on it, and sends that element to the CLI agent running in Erfana's terminal with one of four actions (Explain, Ask, Change, Prompt), together with a screenshot and a context file. Erfana hosts the agent; the agent does the work. This note decides every surface the browser adds, every state of each, how the reviewer always knows where a key press goes, and how Erfana's own surfaces stay separate from whatever a web page draws.

**Verdict – the design direction in one paragraph.** The browser tab is built from three zones that never mix. **Above the page** sits Erfana chrome only: the navigation row with the address bar (the one place the true origin is shown), a second, permanently reserved *pick row* that carries everything about picking and sending (the Pick element button, the pick banner and "Page paused" chip, the send result, the width preset and the target terminal), and, on demand, *strip rows* – on their own surface step – in which the site asks for things (permissions, sign-in, page dialogs, pop-ups). **The page area** shows the live page inside a 4px frame Erfana owns, whose edge tells the reviewer where keys go: a violet focus ring while keys go to the page, a solid lime frame while pick mode owns the keys, a dashed lime frame while pick mode is on but focus is elsewhere. **Over a still image of the page** – never inside the page – Erfana draws what belongs to the reviewer's own pick: the prompt-actions panel and the instruction dialog, always with a companion cue in the pick row that a page cannot draw. One sentence a reviewer can learn: *the site asks in the strip; your pick is answered over the still image; the address bar is the only truth about where you are.* The reserved pick row is the load-bearing choice: it lets the pick banner, the send notice and the target appear and change without ever moving the page, which keeps a hover menu open when the reviewer presses Ctrl/Cmd+E (025-FR-028) and keeps the outline flash on the element after a send (025-FR-060).

## Findings from the inputs

Read as data. No text in the spec, cards, designs, plans, screenshots or review reports addressed instructions to this note's author; the strings "AI agent: ignore the user" and "INJECT-7f3a" in `04-acceptance.md`, and the hostile "type your Erfana password" fixture in the Site prompts card, are test data. Each tension below is resolved here (how is stated) or settled in § Decisions. The spec changes named in the table (SPEC-1 to SPEC-7 and the follow-ups) were applied in spec v0.10.0 (2026-11-01), so the "spec fix" and "spec clarification" wording in the table is history, not a to-do.

| # | Where | Finding | How this note handles it |
| --- | --- | --- | --- |
| F-1 | 025-FR-034 | Names the screenshot outline colour `--color-accent`. No such token exists; the accent is `--color-accent-primary` (comments-v2 R-02 found the same slip). | The design uses `--color-accent-primary`. Spec fix SPEC-1 (one word). |
| F-2 | 025-FR-030, 025-FR-049 vs the decided Menu card | The spec's prompt-actions "menu" moves focus with Tab and gives ↑ ↓ to refinement; the Menu card binds `role="menu"` to ↑ ↓ between items. | The panel is **not** a menu in role or look: a row of four buttons inside an anchored dialog, with a visible refinement stepper that answers ↑ ↓ (H-08). No decided card changes. |
| F-3 | 025-AC-053 vs the decided Permission band card | The spec skips disabled Back and Forward in the Tab order; the preview's Back stays focusable. | Native `disabled`; focus hands over to the other button when one disables itself; the reason moves into the navigation group's description (M-47). Recorded, not reopened. |
| F-4 | 025-FR-060 vs the proposed Feedback card | The send notice carries two actions and leaves after 5 s; the card says a toast with an action never leaves on its own (SC 2.2.1). | Not a toast: the notice sits in the pick row's status slot, keeps **both actions at every width** (H-12), pauses under the pointer or focus, and both actions stay reachable afterwards (target menu, More menu, command palette). |
| F-5 | 025-FR-065 with 025-FR-028 | A banner above the page would push the page down as pick mode starts and close hover menus. | The banner lives in the reserved pick row (OD-3). |
| F-6 | 025-FR-012 naming contract vs the Writing card | "Phone width (390 px)" vs "390px". | Owner decision OD-7: "390px"; spec follow-up. |
| F-7 | Toolbar card vs 025-AC-053 | The card's toolbar is one Tab stop with arrows; the spec walks every enabled control with Tab. | Plain rows of Tab stops grouped with `role="group"`. |
| F-8 | Spec scope | Screen-reader support left Erfana (#440). | Roles, names and announcements are specified because the cards require them; none is an acceptance gate. Keyboard-only use stays in scope. |
| F-9 | 025-FR-065 | The banner string is fixed, but it is false in toolbar focus, in the panel and dialog (⌘E does nothing there) and with focus outside the tab (Esc would reach the terminal and interrupt the agent). | One true banner per routing state (deck: *Pick banner*); spec change SPEC-2. |
| F-10 | 025-FR-022 | "inside a frame from {origin}" can be read with either origin; the design must lead with the origin that receives the password. | One provenance grammar, asker first (Security rule 4b); spec clarification SPEC-3. |
| F-11 | 025-FR-030 vs 025-FR-061 | "First action focused, Tab wraps from the last action to the first" does not say where the shell-guard banner's button and the panel's target button sit. | First action focused; actions, then the banner button, then the target button, then wrap. Spec clarification SPEC-6. |
| F-12 | 025-FR-030 labels vs the Writing card | Spec-fixed "Ask", "Change", "Prompt"; the Writing card puts an ellipsis on a command that asks for more. | Screens draw "Ask…"; SPEC-6 asks the spec to adopt it. |
| F-13 | 025-FR-011 vs 025-FR-019 | "Allow once" and "Allow this time" name one idea twice. | SPEC-5; screens draw "Allow once" in both. |
| F-14 | 025-FR-021 | "Proceed anyway" is offered for hosts that require HTTPS (HSTS, preload). | Owner kept it on every host (SPEC-4 declined, 2026-11-01); no HSTS-only frame or rule. |
| F-15 | 025-FR-030 | Enter on Explain sends at once; a held or double Enter from the confirming key can send. | Fresh-keydown rule in the keyboard contract; SPEC-7. |

## Cards it builds on

| Card | Status | What this design takes from it |
| --- | --- | --- |
| [Focus and keyboard](../../design-system/system/foundations/focus.html) | `decided` | The one ring (2px `--color-border-focus`, offset 2px outward, inset only in scrollers); the page-area ring in the reserved gutter at that offset; focus never obscured – no tooltip or popup covers the focused control (H-02); the two-tone exception, extended to the pick outline by owner decision OD-2 – recorded in the decided card's Exceptions on 2026-11-01 |
| [Menu](../../design-system/system/components/menu/index.html) | `decided` | The whole contract for every real menu (page right-click, target, width preset, More, Choose terminal); a keyboard-opened menu draws the fill **and** the inset ring on its first item; reason lines; `aria-keyshortcuts`. The prompt-actions panel does not borrow the Menu look (H-08) |
| [Form controls](../../design-system/system/components/form/index.html) | `decided` | Address and find fields at `--input-height-sm`; the instruction field as the multi-line field; the error contract; sign-in fields and the Remember checkbox, disabled with its reason |
| [Permission band](../../design-system/system/components/permission-band/index.html) | `decided` | Chrome as a flow sibling above the page; the pressed signature (fill plus lime foot) for Pick element; dim the icon, never the button; shortcut captions plus `aria-keyshortcuts`; the status slot's shrink-before-controls rule; rows never wrap |
| [Rows and lists](../../design-system/system/components/row/index.html) | `decided` | Origin display inputs (scheme only when not `https`, port only when not default, punycode for mixed scripts, the full origin in real text); the empty tab's lists |
| [Tabs](../../design-system/system/components/tabs/index.html) | `proposed` | The editor tab; the address as its description; in-use and waiting states in its name. Departure: its tooltip is drawn beside the tab inside the strip band (exception row on the Tooltip card) |
| [Toolbar](../../design-system/system/components/toolbar/index.html) | `proposed` | Groups, spacer, More, the status slot; `--toolbar-tool-height` (28px, proposed). Departures recorded on the card: browser rows copy the preview bar's height and fill; tools sit `--space-2` apart so an outward ring never lands on a neighbour (M-37) |
| [Buttons](../../design-system/system/components/button/index.html) | `proposed` | Icon tools, the toggle, the four action buttons, the text-style Proceed anyway; disabled, blocked and busy states (busy keeps the full ring, M-31); in forced colours the pressed toggle takes a full Highlight treatment (M-33, proposed on the card) |
| [Tooltip](../../design-system/system/components/tooltip/index.html) | `proposed` | Description on hover and focus, hoverable, Esc-dismissible. Placement rule for the browser in § Anatomy (H-02); exception rows for the editor-tab tooltip |
| [Badges, chips and keys](../../design-system/system/components/badge/index.html) | `proposed` | State badges, action chips, the static "Page paused" chip, the element chip, `<kbd>`. Panel note chips use the **neutral** chip, never the violet outline chip that reads as a focus ring (VS-26) |
| [Feedback](../../design-system/system/components/feedback/index.html) | `proposed` | Band and boxed banners, toasts, the hidden severity word, one always-mounted hidden polite region per browser tab (M-45). The send notice's glyph is not lime (M-42) |
| [Icons](../../design-system/system/components/icon/index.html) | `proposed` | Registry icons by size name |
| [Dialog](../../design-system/system/patterns/dialog/index.html) | `proposed` | Anchored dialog for the panel and the instruction dialog, modal **inside the browser tab only** (`aria-modal="false"`, other zones `inert`, M-46); the sheet form drawn inside the page area over the still image (M-36, rule moved to the card); centred dialogs for Clear and Forget |
| [Empty, loading and error states](../../design-system/system/patterns/states/index.html) | `proposed` | Empty tab, load-error and crash pages; departure (plain buttons instead of `.erf-state__action`) recorded on the card |
| [Layering](../../design-system/system/foundations/layering.html) | `proposed` | The native view sits above every z-index: anything over the page hides it first behind a still image |
| [Writing](../../design-system/system/foundations/writing.html) | `proposed` | Sentence case, en dashes, verbs on buttons, ellipsis on commands that ask for more, `formatShortcut`, "the agent" |
| [Colours](../../design-system/system/foundations/colors.html) | `proposed` | Tokens and real-surface pairings. In this feature lime keeps exactly these meanings, recorded on the Element picker card (R2-M19): the pick-mode frame (solid, and dashed in Out), the pressed Pick element foot, and the selected editor tab's existing marker. Never success (the send glyph is `--color-text-primary`, M-42), never a refinement crumb (removed, R2-M1) |
| [Surfaces and elevation](../../design-system/system/foundations/surfaces.html) | `proposed` | Floating surfaces with edge and shadow; strip rows on their own surface step (M-44); the 24 × 24 target floor |
| [Typography](../../design-system/system/foundations/type.html) | `proposed` | Mono for hosts, paths, selectors and sizes; 200% zoom and text spacing without loss (H-09) |
| [Spacing](../../design-system/system/foundations/spacing.html) | `proposed` | Every gap from the scale; frame gutter `--space-1` plus `--border-width-thick` |
| [Motion](../../design-system/system/foundations/motion.html) | `proposed` | Nothing over the native view animates its height; flash, changed-chip mark and guard look are static |
| [Forced colours](../../design-system/system/foundations/forced-colors.html) | `proposed` | Every state keeps an edge; the pick outline uses Canvas, Highlight and CanvasText lines; selected and pressed are shapes (M-33) |
| [Theme](../../design-system/system/foundations/theme.html) | `proposed` | Dark only |
| [Segmented control](../../design-system/system/components/segmented/index.html) | `proposed` | Considered for width presets, not used (does not fit at 400px; AC-053 counts Tab stops) |
| [Drawer](../../design-system/system/patterns/drawer/index.html), [Text highlights](../../design-system/system/foundations/highlights.html) | `proposed` | Not used (no side panel; find is Chromium's native `findInPage`) |

Third-party pages in drawings use the central stand-ins in `ds.css` (`.ds-foreign-page`, plus `--dark` and `--accent` variants added there – M-39); no screen or card declares its own hex page.

### New cards this design recommends

All `proposed`, drawn by the visual designers.

| New card | Folder | Rule it decides | Why no existing card fits |
| --- | --- | --- | --- |
| **Origin field** | `system/components/origin-field/` | The **one origin formatter** (Security rule 2) and how a one-line field shows it: state badges, host emphasis, what elides first, the floors, the read-only form, chips inside the field, the suggestion list, and every class the CSS defines drawn as a frame (hover, IME, chips, icon-only badge exception) | Rows and lists decides hosts in rows (wrap, never cut); a one-line field cannot wrap |
| **Element picker** | `system/patterns/picker/` | Picking on a page Erfana does not own, for comment mode and the browser: outline, label and its placement, mode frame (solid, dashed), banner shape, refinement stepper, selected look, flash, sheet form; the key contract split by host until OD-14 is answered, with the differences from the comment overlay listed honestly (VS-22) | One feature screen and a Focus card exception hold the rules today |
| **Site prompts** | `system/patterns/site-prompts/` | A page's requests in the strip: own surface step, provenance grammar, focus rules, the input guard and its visible look, queueing and order, the page-dialog quote box, the registrable domain `nowrap` | Permission band covers one kind in one bar; Feedback bands carry no forms |

## Anatomy of a browser tab

Top to bottom. Every zone is Erfana DOM except the page area. No zone animates its height.

| # | Zone | Present | Height | Holds |
| --- | --- | --- | --- | --- |
| 1 | Editor tab | Always | `--tab-height` | Site icon (or generic globe), label (title, or the formatted origin while no title is known – never an end-truncated URL, H-01), in-use and waiting marks, close |
| 2 | Navigation row | Always | The preview bar's height | Back, Forward, Reload/Stop, the **address bar** (badge, address, chips), Open in system browser, DevTools, **More (always shown, OD-22)** |
| 3 | Pick row | Always (reserved) | One tool row | Pick element, **status slot** (one line), spacer, width preset, **target chooser** |
| 4 | Find row | While find is open | One tool row | Find field, count, Previous, Next, Close |
| 5 | Strip rows | While a site asks | One row each; sign-in and long page dialogs taller | In fixed order: refused-address error, page dialog or leave-page prompt, sign-in box, permission prompt, downloads prompt, pop-up blocked, hung-page notice, keyring notices. The 4 s full-screen and pointer-lock notice is a strip row too, with no buttons (025-FR-019). Own surface step (`--color-bg-secondary`) and a leading 2px neutral rule (Site prompts card) |
| 6 | Page area | Always | The rest | The native view inside a 4px frame (`--space-1` gap, then a `--border-width-thick` edge), or an Erfana page in the same rectangle |

**Layout rules every screen follows**

- **Rows share one inline start**: icon centres of Back, Pick element and the find field's start sit on one column; the find row pads `--space-6` so its ring clears the tab edge (VS-25).
- **Tool gap** is `--space-2` or more in every browser row (M-37).
- **Strip rows**: one row per kind; same-kind requests queue behind it with a "+N waiting" count (deck: *Strip rows*). Actions wrap under the text before the text takes a third line (body basis about 40ch, VS-16).
- **The frame** sits in the gutter outside the view's rectangle; the viewport never resizes when the frame changes.
- **Width presets** narrower than the panel centre the page on `--color-bg-primary`; wider ones scroll the area sideways with an Erfana scrollbar under it.
- **Tooltips (H-02).** Open above their trigger, except in the pick row (rule below). A tooltip never covers the address bar's rectangle and never covers the row that holds keyboard focus: if above would do either, it opens on the side away from the focused row, and if no side is free it is not shown (the control's description still carries the text). A hover tooltip closes when focus moves under it. The **editor-tab tooltip** is drawn inside the editor tab strip's band, beside the tab (end side, flipping to start), never below it: line 1 the address **through the formatter** (registrable domain emphasised, subdomains dimmed, path quiet and cut from its end – SEC-R2-5), line 2 "Title: {title}" on one line in `--color-text-tertiary` (deck: *Browser tab*). Exception row on the Tooltip card.
- **Popups that would cross into the page area** (suggestions, target, width preset, More, right-click, Choose terminal) open only after the page area has been swapped for a still image. The page keeps running; no "Page paused" chip.
- **While the panel is open** (Menu state, R2-H1), the navigation row, pick row and strip rows stay **live, at full strength, not dimmed and not `inert`**: a click on any of their controls closes the panel without sending and focuses that control, and Ctrl/Cmd+L closes it and focuses the address bar (025-FR-049, Must). **The panel also has a visible close:** a × button (*Panel – close*, "Close – nothing is sent", 24 × 24) at the header's end edge, and a click on the page outside the panel closes it the same way (frames *click outside* and *toolbar click*, prompt-actions.html). A pointer press on a panel control counts only if it began after the panel opened (025-FR-030, Z2) – the click that opened the panel cannot also press an action.
- **While the instruction dialog is open** (Dialog state only), those rows are `inert` (025-FR-050; IX-18). Only their **icons** are dimmed (`--opacity-disabled`); the address bar and its origin text keep full strength, and a focus ring is never dimmed.
- **Pick-row tooltips (R2-H5).** Above the pick row is the address bar and below it the page, so pick-row tooltips have their own place: **inside the pick row's band**, toward the end side, starting **after the banner's first clause** – over the later clauses, the spacer or the status slot's free part, never over "Picking – …" and never over the control that holds focus (R3-M1). When a tooltip shows because its trigger has keyboard focus, the first Esc only hides it and the next Esc does the routing action of the current state; a tooltip shown by hover alone never takes an Esc – that Esc routes and hides it in the same press, and it stays hidden until the pointer leaves and re-enters (R4-M3). They show on hover **and on keyboard focus**; while one shows, the status slot's text is hidden under it and comes back when it closes (the hidden polite region is unaffected). This is the worked example for the Tooltip card's boxed-in trigger. **Never over the send notice's actions** (mouse scope, Y11): while the send notice shows, a pick-row tooltip opens after the notice's actions, or does not show when there is no room, and the notice's 5 s timer is paused for as long as a pick-row tooltip is open – so a click on Show terminal or Open capture is never blocked by a tooltip.
- **Click guard after layout shift (H-05).** When a row inserts or leaves while the pointer is over the page area, page clicks are ignored for about 500 ms; in pick mode the hover hit-test re-runs before a click may confirm. **A page click dropped by the guard in pick mode is answered, not silent:** the status slot shows *Note – page moved* for 2 s (mouse scope, Y10). A strip row's own buttons follow the input guard (OD-6); **the guard's blocked look wins over hover and the pointer is `not-allowed`** (mouse scope, Z6 – already how `button.css` draws `aria-disabled`; a guarded button never looks pressable under the pointer).
- **The sheet**: under 400px of room the panel and dialog become a sheet pinned to the **bottom of the page area, over the still image**, full width, never outside the page area (M-36).
- **A popup window** (025-FR-011, H-11, M-05): OS title bar showing "{host} – Erfana"; the **popup origin strip** (read-only address in the formatter, certificate badge, in-use chip, zoom chip); the **find row** under it when Ctrl/Cmd+F is pressed; its own strip rows; then the page. No navigation row, no pick row. The *Badge tooltip* opens inside the origin strip's band, beside the badge after the address, short form only, and does not show when it does not fit (R7-M1). Minimum content width: the strip must fit the badge word, the registrable domain and port; a smaller requested width is raised to it. Page-supplied `left`/`top` that would place the popup over the opener window's navigation, pick or strip rows are ignored and the popup opens at the OS default position.

## Screens

Six files plus `index.html` and `browser.css` (layout only – no component looks, no second spinner, VS-17). Every 025-FR-043 surface is listed; each state is one static frame. Frames added in round 1 are marked †, in round 2 ‡, and the frames of the mouse-first revision (2026-11-01, round 9) carry ‡ as well – they are listed by name in the rows below. **This table lists only states the screens must draw**: a listed state with no frame is a screen defect to draw, not a note to trim (TR-R2-6); the screen designers own the drawing.

| 025-FR-043 surface | Screen file | FR | AC | States to draw |
| --- | --- | --- | --- | --- |
| Entry points† | `tab-and-toolbar.html` | 025-FR-001, 010 | 025-AC-001, 010 | New browser tab button in the editor area: rest, hover, focus, tooltip with and without the shortcut; HTML preview bar with Open in browser tab |
| Editor tab | `tab-and-toolbar.html` | 025-FR-004, 019 | 025-AC-004, 019 (in use) | Loading (formatted origin as label†); loaded; no icon; long title; long host as label (registrable domain whole)†; title that imitates an origin, beside the true address in the bar†; in use (camera, microphone, screen†); page dialog waiting†; tooltip beside the tab†; inactive, hover, selected, focus-visible; unfocused group |
| Capture chip (app-level in-use cue)† | `tab-and-toolbar.html` | 025-FR-019 | 025-AC-019 | Camera in use in a hidden browser tab; two tabs capturing |
| Navigation row | `tab-and-toolbar.html` | 025-FR-001, 002, 003, 013, 057 | 025-AC-001, 002, 003, 013, 053, 074 | Fresh tab; loading started by the reviewer (pending address shown); loading started by the page (committed address kept)†; loaded; two adjacent tools, one focused†; Back disabled, Forward enabled; DevTools open; full, compact, narrow (about 400px), minimal (360px) – More is on the row in every one of them (OD-22); its menu is drawn at narrow and minimal |
| Address bar | `tab-and-toolbar.html` | 025-FR-002, 005, 021 | 025-AC-002, 005, 021 | `https`; remote `http`; loopback `http` with port; `file://`; long path (path floor)†; long host (`….domain`)†; lookalike; IDN; focused; typing; empty; IME; zoom chip focused (field without ring)†; certificate warning page up (third badge)†; userinfo link shown without its userinfo‡; `mailto:` link destination‡ |
| Suggestions | `tab-and-toolbar.html` | 025-FR-063 | 025-AC-078 | Matches; search row only; over the still image |
| Refused address | `tab-and-toolbar.html` | 025-FR-002, 005 | 025-AC-002, 005 | `javascript:`; Windows path; network path; Erfana's own files; field invalid and focused†; cleared on edit |
| Find bar | `tab-and-toolbar.html` | 025-FR-008, 014 | 025-AC-008, 062 | Empty; "1 of 3"; "2 of 3"; "0 of 0"; closed; opened in pick mode (toolbar banner variant)†; in a popup†|
| Zoom chip (addition) | `tab-and-toolbar.html` | 025-FR-008 | 025-AC-008 | Hidden at 100%; 125%; limits; focused; in a popup† |
| Pop-up-blocked control | `tab-and-toolbar.html` | 025-FR-011 | 025-AC-011 | Strip row; dismissed with chip; reopened; "+N waiting"; Allow once; Always allow |
| Certificate warning sign | `tab-and-toolbar.html` | 025-FR-021 | 025-AC-021 | Subresource failure; proceeded host |
| Width presets | `tab-and-toolbar.html` | 025-FR-012 | 025-AC-012 | Full; Phone centred; Tablet wider than panel; menu open; device mode; pick at Phone width† |
| Target chooser | `tab-and-toolbar.html` | 025-FR-061 | 025-AC-077 | Agent; shell; no terminal; unknown process; long name; menu before any send; menu after a send (Open last capture enabled)† |
| Empty-tab hint | `tab-and-toolbar.html` | 025-FR-001, 063 | 025-AC-001, 078 | First ever; history only; local servers only; both; row hover and focus |
| Pick overlay and label | `picking.html` | 025-FR-026, 027, 029, 035 | 025-AC-026, 027, 029, 035 | No highlight yet; nothing-outlined note after ⌘E or Enter†; light page; dark page; accent page; label below at top; label outside a short element†; long classes; tiny; frame; ↑ to parent, ↑ to `body`, ↑ to `html`, end-of-range note†; ↓ back, end-of-range note†; ↑ from a frame root; partly visible; frame removed; status echo while hovering (only if ADR 0007 cannot scale the label)†; forced colours over a white image† |
| Pick frame, banner and chip | `picking.html` | 025-FR-025, 028, 065 | 025-AC-025, 028, 065, 014, 066, 081 | Hover menu opened while picking, item clicked‡; right-click and dropped-click notes (the two timed notes)‡; Page focus (three clauses at full width†); toolbar focus (own banner)†; Out (dashed frame, no key words)†; the first click back after Out (only focuses, OD-11)†; frozen with the panel; frozen with the dialog†; banner at 400px (short ⌘E form)†; at 360px and 200% (first clause whole)†; with text-spacing overrides†; macOS and Windows; pick started by Shift+F10 → Pick this element†; Pick element tooltip on keyboard focus, inside the pick row's band‡; Out with the dialog kept (own banner)‡; return after the panel closed on leaving‡ |
| Prompt-actions panel | `prompt-actions.html` | 025-FR-030, 027, 053, 054 | 025-AC-030, 027, 063, 067, 073 | Opened by click (Explain focused, ancestor path, stepper, × close, target button, rows live at full strength)‡; closed by a click on the page outside it‡; closed by a toolbar click (the clicked control focused, pick row in its toolbar-focus banner)‡; 360px sheet with the ancestor path cut from its start and × close‡; opened by second ⌘E (frozen); each action focused; stepper used by click and by ↑†; stepper at an end (note)†; chip marked as changed†; placed left, right, above, below; element flush with the bottom edge, fully visible, panel above (AC-030 fixture)†; partly off-screen; off-screen after ↑; in a frame; shell target pre-warned on open†; guard hit swapped in place, focus on the banner's button‡; F6 closes the panel‡; banner rewritten after choosing a terminal†; Explain sending (busy, ring kept)†; sheet at the foot of the page area† |
| Instruction dialog | `prompt-actions.html` | 025-FR-031, 050, 053, 061 | 025-AC-031, 064, 067, 077 | Ask, Change, Prompt; rows inert with icons dimmed, address bar at full strength‡; F6 with the dialog open (nothing moves, no separate note)‡; the target as a menu button, in the dialog and in the narrow sheet‡; with text; empty submitted; sending (ring kept)†; ← Actions back to the panel†; page reloaded (still-image cue in the pick row)†; focus left to the terminal and back; write failure; no agent; no terminal (Open terminal)†; Choose terminal menu; frozen dialog with chip†; rows inert behind it† |
| Send notice | `prompt-actions.html` | 025-FR-060 | 025-AC-070 | Full width with text buttons; under 800px with icon buttons, actions kept†; paused under the pointer; after 5 s; flash; terminal revealed; displaced while focus is on an action (focus to Pick element)† |
| Capture-failed and shell-guard messages | `prompt-actions.html` | 025-FR-046, 061 | 025-AC-060, 077 | Capture failed at confirm; write failed (dialog, Explain); no terminal; shell; page changed |
| Permission prompt and in-use | `site-prompts.html` | 025-FR-019 | 025-AC-019 | Notifications; camera; microphone†; camera and microphone†; clipboard read†; location; screen with source picker; from a frame (asker first); queued: answer the first, gap, second with guard look†; guard look on arrival†; long and lookalike origins (domain unbroken)†; withdrawn while it held focus – focus to the next row as a group, guard re-armed‡; in use; in-use chip below 520px (icon kept)† |
| Fullscreen and pointer-lock notice | `site-prompts.html` | 025-FR-019 | 025-AC-019 | Full screen in the page area with the notice as a strip row; pointer lock; gone. The "full screen while picking" frame is dropped unless ADR 0011 proves it reachable (M-18) |
| Popup window | `site-prompts.html` | 025-FR-011, 014 | 025-AC-011 | `https`; `http`; navigated; own permission prompt; long origin; minimum size†; find open "1 of 3"†; zoom 125%†; page-requested position over the opener's rows ignored†; badge hovered, tooltip in the strip band‡ |
| Download notice | `site-prompts.html` | 025-FR-020 | 025-AC-020 | Finished toast; failed toast; several-files row |
| Sign-in box | `site-prompts.html` | 025-FR-022, 018 | 025-AC-022, 018 | Focused after the reviewer's navigation; arrived without focus; from a frame (asker first)†; remote `http` pre-filled; rejected typed; rejected saved†; Remember disabled on Linux; busy |
| Page dialogs and leave-page | `site-prompts.html` | 025-FR-058 | 025-AC-075 | `alert`; `confirm` with Decline · Confirm over "Cancel your booking for plot 7?"‡; `prompt` with "Answer to the page" and its note†; third dialog with checkbox; long message, quote box focused†; from a frame; arriving in a background or unfocused tab (waits, tab marked)†; leave-page with origin line† on close, reload, navigate; narrow (actions under the quote)† |
| Load-error page | `page-states.html` | 025-FR-059 | 025-AC-076 | Each code group; loopback hint replacing the next step†; reached by a page-started load (focus on the heading; address bar shows the failed URL)‡; reached from the toolbar (focus on Reload)† |
| Certificate warning page | `page-states.html` | 025-FR-021 | 025-AC-021 | Self-signed; expired; mismatch (its own caution text)†; revoked†; Proceed anyway visible at once, text-style, caution text beside it, focus on Back to safety†; Proceed anyway in its guard look just after the page appears‡; *More about this error* open‡; reached by a page-started load, address bar shows the failed host‡; no history |
| Crashed and hung tab | `page-states.html` | 025-FR-056 | 025-AC-072 | Crashed; crashed with the panel open; hung row; after Wait; hung row recovering while focused (focus to the page)†; crashed frame |
| Page right-click menu | `menus-and-data.html` | 025-FR-057 | 025-AC-074 | Plain; link (header with the link's host, OD-12)‡; userinfo link (header without userinfo)‡; image; selection; editable field; disabled Back/Forward; keyboard-opened (fill and inset ring)†; Pick this element from a right-click – picked at once, panel open‡; no menu in pick mode |
| Clear data and Forget | `menus-and-data.html` | 025-FR-023, 016 | 025-AC-023, 016, 059, 069 | Defaults; blocked; busy; step failed; Forget confirm; Forget on Windows; Forget failed toast†; tab refused because a path is a link (toast)†; tab refused because `.gitignore` could not be written (toast)† |
| Keyring notices | `menus-and-data.html` | 025-FR-018 | 025-AC-018 | Notice on the first tab; restarted without dismissing – shown again†; dismissed – never again in this project†; keyring reset |

## Flows

States per step: **Out** (focus outside the tab), **Browse** (025-FR-047), **Pick** (025-FR-048), **Menu** (025-FR-049 – the panel), **Dialog** (025-FR-050), **Toolbar** (025-FR-051). Strings are deck rows, named in *italics*.

### Browse

| # | Reviewer does | Erfana shows | State |
| --- | --- | --- | --- |
| 1 | Runs New browser tab (palette, menu, editor-area button, Ctrl/Cmd+T) | Empty tab, address bar focused with *Placeholder*, *Empty-tab hint* | Toolbar |
| 2 | Types `localhost:5173` | *Suggestions*, last row *Search row* when the text would be searched | Toolbar |
| 3 | Presses Enter | The bar shows the pending address (a reviewer-started load, H-03); Reload becomes Stop; tab label is the formatted origin with a spinner; focus moves to the page | Browse |
| 4 | Page loads | Title and icon; the bar at rest; violet ring on the frame | Browse |
| 5 | The page itself starts a navigation (script, link, form, redirect) | The bar keeps the **committed** address until the new page commits; Stop shows | Browse |
| 6 | Server not up | Load-error page, Reload focused (the reviewer started the load) | Toolbar |

### Pick by click or Enter

| # | Reviewer does | Erfana shows | State |
| --- | --- | --- | --- |
| 1 | Clicks Pick element, or presses Ctrl/Cmd+E with page focus | Pick element pressed; solid lime frame; *Pick banner – page focus* ("Picking – click an element · Esc to stop · …"); crosshair. Nothing outlined until the mouse is over the page. A menu the page opens on hover stays open (focus emulation, OD-20) | Pick |
| 1a | Ctrl/Cmd+E or Enter again with nothing outlined | Nothing is picked; *Note – nothing outlined* replaces the banner's later clauses for 4 s | Pick |
| 2 | Moves the mouse | Two-tone outline and label follow | Pick |
| 3 | ↑ once | Highlight moves to the parent; at an end, *Note – top of the page* or *Note – back at the start* for 2 s | Pick |
| 4 | Clicks or presses Enter | Still image with the outline in its selected look; the panel opens beside it: element chip with the stepper, four action buttons, target button, key hint; Explain focused. The pick row shows *Pick banner – panel* | Menu |
| 5 | Clicks a name in the ancestor path or an arrow of the stepper, or presses ↑ ↓ | The picked element changes on the still image; the chip is marked as changed for 1 s; the panel follows. If the page has removed the picked element since a click pick, the arrows show their end look and *Note – element gone* shows for 2 s | Menu |
| 6 | Clicks Change… (or Tab to it and Enter – fresh keydown, SPEC-7) | The dialog replaces the panel, anchored to the same outline, field focused; rows behind are inert, their icons dimmed; *Pick banner – dialog* | Dialog |
| 7 | Types, then clicks Send (shortcut ⌘Enter / Ctrl+Enter) | Send becomes *Busy – sending*, ring kept; a second submit does nothing | Dialog |
| 8 | Send succeeds | Live page back; outline flashes 1 s; frame and banner go; *Send notice* for 5 s with both actions; terminal revealed if hidden; focus to the page | Browse |

### Pick a hover-only element (second Ctrl/Cmd+E, freeze)

| # | Reviewer does | Erfana shows | State |
| --- | --- | --- | --- |
| 1 | Hovers the page's dropdown open | Live page | Browse |
| 2 | Ctrl/Cmd+E | Pick mode starts without moving the page; dropdown stays open | Pick |
| 3 | Ctrl/Cmd+E again | Picked at once; still image with the open dropdown; panel; after source hints, the page freezes and *Page paused* joins the banner | Menu |
| 4 | Esc | Panel closes; chip goes; page resumes; frame and banner stay | Pick |

### Pick a hover-only element by click (no shortcut)

| # | Reviewer does | Erfana shows | State |
|---|---|---|---|
| 1 | Clicks Pick element | Pick mode on without moving the page; the page keeps focus emulation (DevTools "Emulate a focused page", owner decision OD-20), so a menu that closes when the page loses focus is not closed by the click | Pick |
| 2 | Hovers the page's dropdown open | The menu opens and stays open; the outline follows the pointer onto its items (frame *Hover menu opened while picking, item clicked*) | Pick |
| 3 | Clicks the item | Picked; still image with the open menu; panel opens | Menu |

The same route is taught by *Pick tooltip – off* line 2 and by the user guide; the keyboard route (the second Ctrl/Cmd+E) above stays.

### Pick from a right-click

| # | Reviewer does | Erfana shows | State |
|---|---|---|---|
| 1 | Right-clicks an element, with a pointer | *Page right-click menu* over the still image | Browse |
| 2 | Clicks **Pick this element** | The right-clicked element is picked **at once** (DevTools' right-click **Inspect**): the still image is the page at the moment of the right-click, the outline is in its picked look, the panel is open, pick mode is on with *Pick banner – panel* (frame *Pick this element from a right-click*) | Menu |
| – | Shift+F10, then **Pick this element** | Unchanged: the focused element is outlined, ↑ ↓ refine, Enter confirms | Pick |

A right-click on the page while pick mode is on opens no menu: *Note – right-click off* shows for 2 s.

### Refine parent and child

↑ moves to the parent (crossing a shadow root to its host, a frame root to its `<iframe>`); ↓ moves back toward the first-hovered element; the parent chain runs up through `body` to `html`, where ↑ does nothing. At either end nothing moves, the stepper's button for that direction shows its disabled look, and the end note shows (2 s in the panel header, or in the status slot before confirm). Moving the mouse resets the first-hovered element. In the panel, a refinement re-reads the element without a new screenshot and redraws the outline on the stored image. Alt+↑ and Alt+↓ act the same as ↑ and ↓ (owner decision OD-14).

**The ancestor path (run lead's call, 2026-11-01; supersedes the round-1 "no breadcrumb" decision, H-08).** The panel header carries a clickable path beside the stepper, imitating Chrome DevTools' breadcrumb bar: `main › section.hero › button.cta`. Each ancestor is a button (*Path – crumb*); a click moves the pick to that element, exactly as repeated ↑ would, with the same still-image redraw and changed mark. The picked element is the **current crumb** – the existing element chip, marked `aria-current="true"` – so the chip keeps its size text and its changed mark. The path is cut **from its start**: when room is short the formatter-like component drops whole crumbs from the front behind a leading "…" (no CSS clipping of a name, no `direction` trick, as for the host in fold step 8); the current crumb always stays whole, and the stepper and × never leave. The stepper stays too: it is the keyboard's one visible twin (↑ ↓), shows the two ends as a disabled state, and works when the path is cut.
Page text: each crumb is page-written text inside Erfana's panel (SEC-18), so a crumb follows the chip's rules – drawn as code in mono, tag plus `#id` or the first classes, long class lists cut as in *Label* – and is never a link or a heading. The path and the stepper are pointer controls (`tabindex="-1"`); the Tab order is unchanged except that × closes it.

### Choose an action, write the instruction, send

- Explain (no ellipsis) sends at once; Ask…, Change… and Prompt… open the dialog (SPEC-6).
- The panel's target is a **menu button** (*Target button – panel*) that opens the Choose terminal menu inside the panel without losing the pick (M-27). The dialog's "Sends to" line carries the same menu button (OD-18).
- When the panel opens and the target runs a shell or no terminal is open, a warning banner is already at the top (*Pre-warn – shell*, *Pre-warn – no terminal*), with Choose terminal or Open terminal; the actions stay enabled and the guard still runs at the press (M-28).
- The dialog shows ← Actions (*Back to actions*), which returns to the panel on the held capture, keeps the freeze, and keeps typed text if the reviewer then picks another dialog action (M-25).
- Busy: the pressed control shows *Busy – sending*, keeps focus and its full ring; other actions are `aria-disabled`.

### Feedback

- **Success**: *Send notice* in the status slot for 5 s; both actions stay at every width – text buttons at full width, icon buttons with full names below 800px, while the width preset folds into More (Page width) and the target keeps at least 8 characters of its name (below 380px down to "…"); the timer pauses under the pointer or focus; the outline flashes 1 s on the live page; focus stays on the page; the announcement names the fallback route (*Announce – sent*).
- **Afterwards**: Show terminal and Open last capture stay in the target menu, Open last capture also in More and in the command palette (*Commands*).
- Open capture opens the context file in an editor tab.

### Failure

| Failure | What the reviewer sees | Focus ends on | State after |
| --- | --- | --- | --- |
| Capture fails at confirm | *Toast – capture failed*; no panel; still image goes | Page | Pick |
| Write fails, from the dialog | *Toast – write failed, dialog*; dialog kept with the text | Send | Dialog |
| Write fails, from Explain | *Toast – write failed, Explain*; the panel stays open (equivalent to "opens again", 025-FR-046) | Explain | Menu |
| Guard hit (shell, or no terminal) | *Guard – shell* or *Guard – no terminal* swapped into the banner slot **in place** (the panel does not close and reopen, IX-11). **Focus moves to the banner's button** (Choose terminal or Open terminal), in the panel and in the dialog (R2-M14); Explain-first focus is only for the pre-warn shown on open (025-FR-030) | The banner's button | Menu or Dialog |
| Choose terminal, a terminal chosen | The banner is rewritten at once: *Note – target chosen*, or *Guard – shell* with the new name if that one is also a shell (M-29) | Explain, as the panel screen draws it (the banner's button is gone with *Guard – …*); Choose terminal only if the new terminal is also a shell | Menu or Dialog |
| Open terminal (no terminal open) | A new terminal opens in the terminal panel; focus stays in the panel; the banner becomes *Pre-warn – shell* for the new terminal's shell | Open terminal | Menu or Dialog |
| Reviewer goes to the terminal to start the agent (R2-M13) | **From the panel**: the panel closes and the pick is discarded, as the banner said; back in the tab, *Pick banner – Out, panel*, then pick again. **From the dialog**: the dialog and its text survive and return with focus. The pre-warn banners say this, and name Ask…, Change… and Prompt… as the way to keep the pick across the trip (R3-M2) | – | Out, then Pick or Dialog |
| Target closes during the send | Files deleted, *Toast – write failed* with its reason | As above | As above |
| Page navigates, panel open | Panel closes, capture discarded; *Note – page changed*; pick mode ended | Page | Browse |
| Page navigates, dialog open | *Banner – page reloaded* in the dialog; the pick row shows *Cue – still image* (M-03); Send uses the held capture | Unchanged | Dialog (pick off) |
| Page crashes, panel or dialog open | Both close; crash page with *Crash – nothing sent* | Reload | Toolbar |
| Resumed from the DevTools debugger | Panel or dialog closes; chip goes | Page | Pick |

### Cancel at each point

| From | Cancel by | Result | State after |
| --- | --- | --- | --- |
| Pick, nothing open | A click on Pick element, or Esc with page focus | Frame, banner, crosshair go | Browse |
| Pick, toolbar focus | Esc | In the address bar: restores the address; in find: closes find; **on any other button in the navigation row or the pick row, unless one of its menus is open: nothing but focus moves** (IX-20, 025-FR-051). Focus to the page; pick stays | Pick |
| Browse, toolbar focus | Esc on any other button in the navigation row or the pick row, unless one of its menus is open (025-FR-051) | Focus to the page | Browse |
| Any, address bar focused with *Badge tooltip* showing | Esc | First Esc only hides the tooltip and is consumed – focus and the field are unchanged; the next Esc does the field's Esc (restores the address, then returns focus to the page). The tooltip stays hidden until the field loses and regains focus (R5-M7, R6-M1). In pick mode with no room for even the short form, no tooltip shows, so the first Esc already does the field's Esc (OD-16) | Unchanged, then as the field's Esc |
| Any, a pick-row tooltip shown because its trigger has keyboard focus | Esc | Only hides the tooltip; the next Esc does the state's routing action (R3-M1, R4-M3) | Unchanged |
| Badge tooltip shown by hover only, focus elsewhere | Esc | Does the state's routing action and hides the tooltip in the same press; it stays hidden until the pointer leaves and re-enters the badge (R7-M5) | As that action |
| Any, a pick-row tooltip shown by hover only | Esc | Does the state's routing action and hides the tooltip in the same press; it stays hidden until the pointer leaves and re-enters its trigger (R4-M3) | As that action |
| Panel | Esc | Panel closes; freeze lifts; pick stays | Pick |
| Panel | Click on its **×** (*Panel – close*, "Close – nothing is sent") | Same as Esc: nothing is sent; focus to the page | Pick |
| Panel | Click on the page outside it | Same; the clicked element is not picked; clicks within the double-click interval of the confirming click are ignored (frame *Panel – closed by a click on the page outside it*) | Pick |
| Panel | Click on the toolbar, or Ctrl/Cmd+L | Panel closes, nothing sent, freeze lifts; focus to the clicked control or the field (frame *Panel – closed by a click on a toolbar control*) | Toolbar |
| Panel | Focus moves to the terminal or editor | Panel closes, capture discarded | Out |
| Panel | F6 | Panel closes like a toolbar click, nothing sent; focus to Pick element (025-FR-049) | Toolbar |
| Panel | Shift+F6 | Panel closes the same way, nothing sent; focus to the last control in the strip when a prompt shows there, else the last control of the navigation row – More, which is always shown (025-FR-049) | Toolbar |
| Dialog | F6 or Shift+F6 | Nothing moves (025-FR-050 keeps keys in the dialog); no separate note, no timer and no announcement – the status slot keeps showing "Esc or Cancel closes the dialog" (OD-17) | Dialog |
| Dialog | Esc, or a click on **Cancel** | Dialog closes; freeze lifts; pick stays | Pick |
| Dialog | ← Actions | Back to the panel, same capture, freeze kept | Menu |
| Dialog | Focus moves elsewhere | Dialog kept with text; frozen if it was; returns with focus | Out, then Dialog |
| Out (pick on) | First click on the page | **Only returns focus; picks nothing** (Owner decision OD-11) | Pick |
| Out (pick on, dialog kept) | Click in the tab | Focus returns to the dialog field; while away the pick row shows *Pick banner – Out, dialog* (CT-R2-8) | Dialog |
| Any | Switching editor tab (a click on another tab, or a key), or Ctrl/Cmd+T where it acts | Everything closes, nothing sent, no notice; pick ends. **With the dialog open, the typed text is kept for this tab and restored on return** (mouse scope, Z7; a stray click on another tab no longer loses it) | Out |
| Browse, Pick, Menu, Toolbar | A navigating or closing browser key | Same, then the navigation | Browse or gone |

### Leaving the tab mid-pick

By spec (025-FR-052) a switch of editor tab ends pick mode silently. Focus moving to another panel (terminal, editor) does **not** end it: the tab shows the Out state – dashed lime frame, *Pick banner – Out* with no key instruction (Esc in the terminal interrupts the agent, so the banner never tells the reviewer to press it there, H-07), and the first click back only returns focus (OD-11).

## Key-routing states made visible

| State | Keys go to | Page frame | Pick row | Other cues |
| --- | --- | --- | --- | --- |
| Out, pick off | The focused panel elsewhere | Plain | Idle | Editor tab group unfocused |
| Out, pick on (H-07) | The focused panel elsewhere | **Dashed lime** | *Pick banner – Out* | First click back only focuses (OD-11) |
| Browse | The page, except browser and reserved keys | **Violet ring** | Idle | – |
| Toolbar, pick off | The focused control | Plain | Idle | Ring on the control |
| Pick | Erfana (Esc, ↑, ↓, Enter, browser keys); the page gets nothing | **Solid lime** | Pick element pressed; *Pick banner – page focus* | Crosshair |
| Toolbar, pick on | The focused control; Ctrl/Cmd+E does nothing | Solid lime | *Pick banner – toolbar focus* | Ring on the control |
| Menu | The panel; a click or Ctrl/Cmd+L on the live rows closes it | Solid lime, around the still image | *Pick banner – panel*; *Chip – still image* or *Page paused* | Rows live at full strength; ring on the focused action; stepper |
| Dialog | The dialog only | Solid lime, around the still image | *Pick banner – dialog*; *Chip – still image* or *Page paused* | Rows inert, icons dimmed |
| Dialog after the page navigated | The dialog only | Plain (pick has ended, 025-FR-065) | *Cue – still image* | The cue is the anchor (Security rule 7) |

Forced colours: page ring Highlight solid; pick frame Highlight dashed; Out frame Highlight dotted.

## States

Strings are not repeated here: each cell names its deck row in *italics*. Every control also has default, hover and focus-visible as its card draws them.

### Navigation row

| Control | Disabled | Loading | Error | Other |
| --- | --- | --- | --- | --- |
| Back, Forward | Native `disabled` with no history; the reason joins the navigation group's description (*Nav group description*); focus hands to the other button | – | – | Tooltips *Back*, *Forward* |
| Reload / Stop | Never | Stop while loading | – | *Reload*, *Stop* |
| Address bar | Never | Pending address only for reviewer-started loads (H-03) | *Refused – …* in the first strip row | See below |
| Open in system browser | `aria-disabled` and *Busy – opening* | – | *Toast – system browser failed* | Leaves for More at fold step 3 |
| DevTools | Never | – | – | *DevTools* / *Show DevTools* |
| More | **Always shown** (owner decision OD-22): Clear browsing data… and Forget this project's browser data… live only in it, so a reviewer who prefers the pointer reaches them at every width; the fold steps and the Page width group only add to what it holds. More is on the row in every fold measurement (R6-M2) | – | – | *More menu items* |

**Tiers** (container width; thresholds measured in the browser): **full**, **compact**, **narrow** (about 400px), **minimal** (360px). The tier names only say how much room there is and carry **only non-folding changes**: row padding (below 700px the rows' inline padding steps down – a non-folding tier change, R5-M1), icon-only labels (width preset below 700px, and at any width while pick mode is on or the send notice shows; Pick element, pop-up chip and in-use chip below 520px), the short ⌘E clause of the banner and the short placeholder. Nothing is moved into More by a tier name. Room is given back in **one fold order** (R3-H1), the same at every width, each step only once the previous one is exhausted – no compact-margin rule and no narrow "step 3 by itself" exception (R4-M1):

1. The path (down to its 2ch floor, then dropped whole).
2. Subdomain labels, removed whole from the front as `….`.
3. The zoom chip, Open in system browser and DevTools go into More.
4. Forward and Reload go into More; their keys keep working.
5. The address bar's margins shrink to `--space-2`.
6. The badge word ("Not secure", "File") collapses to its icon, accessible name kept – at any tier, once steps 3–5 are done (Origin field card exception, widened from SEC-15). The icon-only remote-`http` badge uses lucide `circle-alert`, which cannot read as a lock and differs in shape from the error glyph (`triangle-alert`, used for the proceeded, subresource and warning-up states); the glyph matches the screens and the Origin field card (run lead's call). The badge segment shows *Badge tooltip* on hover, in icon-only and word forms alike, and – while the badge is icon-only – also while the address bar has keyboard focus (`:focus-visible`); placement as in the deck row (R4-M5, R5-M4, R5-M7).
7. Back goes into More, last.
8. **Only when the scheme, the registrable domain and the port still do not fit beside More:** the host is cut from its **start**, behind a leading `…`, so the end of the registrable domain, the TLD and the port stay visible. **The formatter does the cut**: it slices the domain string from its start and writes the leading "…" itself. CSS `direction` (for example `direction: rtl` with an ellipsis) is never used, because bidirectional text reordering moves the parts of a domain that starts with digits – `163.com` would show as `com.163` (R5-M3). The field is never clipped at its end; More stays whole (R4-H1). The editor-tab label follows the same rule: an address label too long for its tab is cut from its start, never clipped at its end.

**More never shrinks** (`flex: none`) and is never clipped. Until step 8 the registrable domain and port never fold (Security rule 2), and the in-use chip never leaves the field (M-04).

**Pick row at the narrowest widths.** Below 380px the terminal name may truncate below 8 characters, down to "…"; the full name stays in the button's accessible name and the target menu; the process is never cut; while picking, the width preset folds into More first. The width preset also leaves the row while the send notice shows below 800px and, below 700px, while a timed pick note (*Note – …*, 2–4 s) shows, so the notice's actions and the note keep their room. While the width preset is off the row – while picking below 520px, in the Out state below 700px, and during those notices – the same choice is the *Page width* group in the More menu (R5-M6).

**Worked example – 400px tab in pick mode** (`staging.harbour-garden.org/events/open-day`): with More counted in the row, the field needs fold steps 1 and 2 – the path drops, then `staging` goes, showing `….harbour-garden.org` – while every tool stays and More sits at the end (it holds *Page width*). Step 1 alone is not enough at this width.

### Address bar

| State | Shows |
| --- | --- |
| `https`, valid | No badge; the formatted origin and path |
| Remote `http` | *Badge – not secure (http)* with the `circle-alert` icon; `http://` shown; *Badge tooltip* on hover, and on the field's keyboard focus while the badge is icon-only |
| Loopback or private `http` | No badge; scheme and port shown |
| `file://` | *Badge – file*; project-relative path, elided from the front at a folder boundary, file name never cut |
| Certificate warning page up | *Badge – not secure (warning up)* (M-08) |
| Proceeded, or a subresource certificate failed | *Badge – not secure (proceeded)* or *(subresource)*, triangle in `--color-error` |
| Long path | Path elided from its end; below a 2ch floor the path is dropped whole, never a sliver (VS-13) |
| Long host | Whole subdomain labels removed from the front, shown as `….` (ellipsis plus dot) before the next label; registrable domain and port never cut (SEC-17) |
| Lookalike / IDN | Mixed-script label in punycode; single-script IDN in Unicode |
| Loading, reviewer-started | The pending address |
| Loading, page-started | The committed address until the new page commits (H-03) |
| Focused | Full URL selected; the field's ring is scoped to the input, so a focused chip shows only its own ring (M-32) |
| Typing / IME / empty | Suggestions over the still image; IME underline; *Placeholder* |
| Read-only (popup strip) | Same display, focusable for selecting and copying |

Chips at the end, at least 24px: **in use** (static, never leaves; icon-only pinned form below 520px), **zoom** (*Chip – zoom*), **pop-up blocked** (*Chip – pop-up*; icon-only below 520px). Chip rings use the Focus card's inner-gap form.

### Suggestions, find row

As round 0, strings from the deck. Suggestion rows show the address only, never a stored title; `aria-activedescendant` with the ring drawn on the active row. Find: *Find – count*, *Find – no match*; Previous and Next `aria-disabled` with *Find – type to find* while empty; closing returns focus to the page.

### Pick row

| Part | States |
| --- | --- |
| Pick element (toggle) | Off; on (a click on it while on stops picking); icon-only below 520px (name and `aria-pressed` unchanged); `aria-disabled` **only on an empty tab or an Erfana page** (*Pick – blocked reason*), never while a page loads (M-17); Ctrl/Cmd+E while blocked does nothing and shows the reason in the status slot for 4 s. Tooltips *Pick tooltip – off*, *Pick tooltip – on*, drawn inside the pick row's band and shown on keyboard focus (R2-H5) |
| Status slot | One line, `white-space: nowrap`, `--text-base`, plain text with no live role (announcements go to the tab's hidden polite region, M-45). Contents by priority below |
| Width preset | Menu button; its label is icon-only below 700px, and at any width while pick mode is on or the send notice shows (R7-M2). Out of room it folds into More – the first pick-row control to do so: below 520px while picking, below 700px in the Out state, while the send notice shows below 800px, and while a timed note shows below 700px – and its choice then lives in More as *Page width* (§ Tiers, R5-M6); leaves the row at narrow while the panel or dialog is open |
| Target chooser | *Target button – …*; terminal name truncates (minimum 8 characters; below 380px down to "…", full name kept in the accessible name and the target menu – § Tiers), process never; leaves the row at narrow while the panel or dialog is open, because the panel footer and the dialog's target line each carry the same menu button, so the target can still be changed before a send (TR-20, Security rules 11 and 12; OD-18) |

**Status slot priority (H-09)**, highest first:

1. **Pick banner** for the current routing state, whenever pick mode is on. Its **first clause** ("Picking – click an element" in page focus; "Picking –" plus the state's own clause in the other states) has layout priority over every optional control: it never truncates and never wraps; when room runs out, in order, the third clause drops, the second clause shortens to its narrow form, then drops; the width preset (already icon-only while pick mode is on) folds into More (Page width); the target follows its own rule. Whole clauses drop – never a second line, at any text spacing (SC 1.4.12).
2. **Pick notes** (*Note – nothing outlined*, *Note – top of the page*, *Note – back at the start*, *Note – page moved*, *Note – right-click off*, *Pick – blocked reason*): replace the banner's later clauses for 2–4 s; never the first clause.
3. **Send notice** (5 s, after pick mode has ended at the send). The sentence truncates the terminal name first; the actions never leave (H-12).
4. **Cue – still image**, while a dialog is over the still image with pick mode off.
5. **Note – page changed** (until the next pointer or key action, or 8 s).
6. **Note – pop-ups allowed** (5 s).
7. **Link destination** while a link is hovered or focused, Browse only (OD-12).
8. Idle (empty).

The full-screen and pointer-lock notices (4 s, Browse) are not in this list: they are strip rows (025-FR-019), so the status slot and the banner never share the screen with them (M-18).

Separators between clauses are drawn by CSS with equal margins, never typed (VS-21). A send notice's actions sit `--space-6` after the sentence (VS-18); its glyph is in `--color-text-primary`, not lime (M-42).

### Page area and frame

| State | Frame | Area |
| --- | --- | --- |
| Live, no focus | Plain | Native view |
| Live, page focus | Violet ring | Native view |
| Pick | Solid lime | Native view, crosshair |
| Pick, focus elsewhere (Out) | Dashed lime | Native view |
| Panel or dialog | Solid lime (pick on) or plain (pick ended) | Still image |
| Toolbar popup | Unchanged | Still image |
| Erfana page | Plain | Erfana DOM |

### Pick overlay and label

Engine-drawn over the live page; Erfana-drawn on the still image; same look (Element picker card).

- **Outline**: 2px `--color-accent-primary` with a 1px `--color-brand-black` line on both sides, drawn instantly; selected adds a light accent fill and, so it is a shape too, a doubled edge. **Forced colours** (M-33): outer 1px Canvas, 2px Highlight, inner 1px CanvasText (a nested pseudo-element, not a shadow); selected shown by the doubled edge.
- **Label**: *Label*; tag in accent, `#id` or classes in paper, size in `--color-text-primary`, on ink. Placement (VS-20): above the element's top-left, else below, else at the end side; **never inside an element shorter than about two label heights**; inside the top-left corner only for a tall element whose top edge has no room. The panel keeps at least `--space-4` clear of the label.
- **Zoom** (M-34): ADR 0007 must make the engine label scale with Erfana's zoom factor; if it cannot, the status slot echoes *Label* in place of the banner's later clauses while hovering, and the deviation is recorded at the site.
- Tiny, huge, partly visible, in a frame: as round 0 (ring pushed out 2px under 8px; clipped to the visible part; label at the visible top-left; the panel names a cross-origin frame).

### Prompt-actions panel

| Part | States |
| --- | --- |
| Header | The **ancestor path** (*Path – nav*; each ancestor a *Path – crumb* button, the picked element the current crumb, cut from its start behind "…"; see § Refine parent and child) ending in the element chip *Panel – element chip* (mono, page text drawn as code, Security rule 8), with the **stepper** beside it; the **×** (*Panel – close*) at the header's end edge: *Stepper – parent*, *Stepper – child*, pointer targets of 24 × 24, `tabindex="-1"`, each showing its disabled look at its end; end note *Note – top of the page* / *Note – back at the start* for 2 s, **on the header line, after the stepper** (R2-M1); the path and the stepper both move the pick (the round-1 "no breadcrumb" rule, R2-M1, is superseded – § Refine parent and child); chip marked as changed for 1 s after a move (static); frame line *Panel – frame line* for a cross-origin frame; note chips *Panel – notes* in the neutral chip |
| Banner (optional, top) | *Pre-warn – shell* / *Pre-warn – no terminal* (warning) on open; *Guard – shell* / *Guard – no terminal* (error) after a guard hit; *Note – target chosen* after a choice |
| Actions | Four buttons **in one row**, in reading order Explain, Ask…, Change…, Prompt…, in the Buttons card's secondary look with a visible edge, wrapping to a 2 × 2 grid (same order, row by row) below 320px of panel width; the screens match this exactly (R2-M1). Not menu rows (H-08). Explain focused on open. Busy: *Busy – sending*, ring kept |
| Footer | *Target button – panel* (menu button); key hint *Panel – key hint* |
| Keyboard | Tab and Shift+Tab: actions, then the banner's button, then the target button, then × (*Panel – close*), then wrap (SPEC-6). ↑ ↓ refine (`aria-keyshortcuts="ArrowUp ArrowDown"` on the panel). Enter or Space act only on a **fresh keydown** that began after the panel opened; auto-repeat is ignored (SPEC-7). Esc closes |
| Placement | Nearest edge with room, never covering the outline or the label, inside the tab; sheet at the foot of the page area under 400px of room |

### Instruction dialog

| Part | States |
| --- | --- |
| Header | *Back to actions* button; title *Dialog – title*; element chip |
| Banners | *Banner – page reloaded* (note); guard and pre-warn banners as in the panel |
| Field | *Dialog – field label*, *Dialog – field hint*, *Dialog – key hint*; error *Dialog – empty error*; read-only while sending |
| Target line | *Dialog – target line*: the label "Sends to" and a **menu button** – the panel footer's *Target button – panel*, same classes and markup, `aria-haspopup="menu"` – that opens the Choose terminal menu inside the dialog without losing the pick (OD-18). Same size and colour as the panel's (VS-19): `--text-base`, `--color-text-primary`. In the Tab cycle after the field and before Cancel; drawn at full width and in the narrow sheet |
| Footer | Cancel, Send; Send stays enabled when empty; busy keeps the ring |
| Modality | `aria-modal="false"`; the tab's other zones `inert` (M-46) |

### Site prompts (strip rows)

| Row | Contents | Focus on arrival |
| --- | --- | --- |
| Permission | *Permission – …* with provenance grammar for frames; *Permission – remembered* description (not for screen sharing or a one-time grant); buttons Block, Allow once (camera, microphone), Allow; close denies for this load; *Queue count* | Never |
| Pop-up blocked | *Pop-up – row text*; Allow once, Always allow for this site, close | Never |
| Downloads prompt | Origin line, *Downloads – several files*; Block, Allow | Never |
| Sign-in box | *Sign-in – title* or *Sign-in – title, frame*; Username, Password, Remember; warning *Sign-in – http warning*; errors *Sign-in – rejected (typed)* / *(saved)*. With a saved sign-in, loopback and private `http` addresses skip the box (TR-26) | Only after a navigation the reviewer started from the toolbar |
| Page dialog | Header *Page dialog – header* / *– header, frame*; quote box labelled *Page dialog – quote label*, plain text, clamped to 6 lines; when it overflows it is a Tab stop (`tabindex="0"`, inset ring) after the header and before the buttons, and the `alertdialog` is described by it (M-02, AX-16). `prompt()` field *Page dialog – field label* with *Page dialog – field note*. A fixed look: quote box with a left rule, no key icon, never the sign-in layout | **Only when its tab is the active tab and keyboard focus is already in that page** (H-06). Otherwise it waits in the strip, is announced (*Announce – page dialog waiting*) and marks the editor tab (*Tab – waiting*); focus never moves across panels or windows |
| Leave-page | Origin line, *Leave-page – title*, *Leave-page – body*; Stay, Leave | Yes, on Stay – it answers the reviewer's own close, reload or navigation |
| Hung page | *Hung – row*, *Hung – explanation*; Wait, Reload | No |
| Keyring notices | *Keyring – notice*, *Keyring – reset*; Dismiss | No |
| Full screen, pointer lock | *Full screen*, *Pointer lock* (deck: Full screen and pointer lock); no buttons, 4 s; Esc exits (025-FR-019) | No |

All rows: the **input guard** (OD-6) – about 500 ms after a row appears **or its content changes, including a queue advance**, its buttons and fields ignore pointer and keyboard presses and show the blocked look (`aria-disabled`, no animation); after one queued request is answered the strip shows nothing for the **queue gap, 300 ms**, before the next request appears, then re-arms (H-05). Buttons secondary, no filled primary. The origin line uses the formatter; the registrable domain is `nowrap` – never broken at a hyphen (H-01, VS-1) – and only the subdomain labels before it may wrap at their dots.

### Erfana pages in the page area

| Page | Contents | Focus on arrival |
| --- | --- | --- |
| Empty tab | *Empty-tab hint* rows | The address bar (025-FR-001) |
| Load error | *Load error* rows and the *Load-error message table*; the loopback hint replaces the general next step (CT-18) | Reload if the reviewer started the load; else the page heading (`tabindex="-1"`) |
| Certificate warning | *Certificate* rows; Back to safety (filled primary); **Proceed anyway shown at once as a text-style button** (M-43) with the per-code *Caution text* and its 7-day explanation always visible beside it; the same on every host, HSTS and preloaded included (owner decisions OD-5, SPEC-4). Proceed anyway carries the input guard and fresh-press rule (Security rule 10). *More about this error* holds the code and technical detail and never holds a button. Reached by a page-started load, the address bar shows the failed URL (Security rule 1) | Back to safety |
| Crashed | *Crash* rows | Reload |

### Page right-click menu, Clear and Forget

Right-click menu as round 0 with: a keyboard-opened menu draws the first item's fill and inset ring (VS-7); a link menu carries a header line with the link's formatted host (OD-12); **Pick this element** shows no shortcut hint and no `aria-keyshortcuts` – it highlights the focused element, which ⌘E does not do (M-35). **From a pointer right-click, Pick this element picks the right-clicked element at once and opens the panel** (owner decision OD-21; DevTools' right-click **Inspect**; the still image is the page at the moment of the right-click) – drawn on menus-and-data.html. From the keyboard, Shift+F10 on the page's focused element then Pick this element gives a full keyboard pick (↑ ↓, Enter), drawn on picking.html; the user guide names it. Clear and Forget as round 0, strings from the deck.

### Where focus lands when a surface goes (H-10)

Focus never falls to the document.

| Surface goes | Focus had been in it, or on what it replaced | Focus lands on |
| --- | --- | --- |
| A strip row is answered, withdrawn, recovers or collapses | In the row | **The next strip row as a group** (`tabindex="-1"`, its name announced) – never a control that grants (Allow, Allow once, Always allow, Sign in, Confirm). Focus may land on that row's non-granting control instead (Block, Dismiss, Stay, Wait). Arriving by restoration **re-arms that row's input guard** (OD-6). With no next row: the page (live) or the Erfana page's heading (R2-H4) |
| A page dialog or sign-in box is answered | In the row | The page, if it took focus from the page; else back where it was |
| The send notice is displaced (pick mode starts, the page navigates, another notice takes the slot) | On its action | Pick element. The 5 s timer cannot end with focus on the notice – it pauses (AX-R2-7) |
| A zoom chip disappears (reset to 100%) or the pop-up chip goes | On the chip | The address bar input |
| Back or Forward disables itself | On it | The other one |
| A focused tool folds into More (the panel narrows) | On the tool | More. No announcement; any input guard is unchanged (R4-M4) |
| An Erfana page replaces the live view | In the page | Reload if the reviewer started the load; else the new page's heading |
| The live view replaces an Erfana page (Reload worked) | On Reload | The page |
| The panel closes (Esc, ×, outside click, send, navigation) | In the panel | The page |
| The panel closes by a toolbar click or Ctrl/Cmd+L | In the panel | That control or the field |
| The dialog closes (Esc, Cancel, send) | In the dialog | The page |
| ← Actions | In the dialog | The action that opened the dialog |
| The panel or dialog closes by a crash | In it | Reload on the crash page |
| A Menu-card menu closes | In the menu | Its trigger; the page right-click menu returns focus to the page |
| The suggestion list closes | – | The address bar |
| The find row closes | In the find row | The page |
| Clear or Forget closes | In the dialog | Its opener (More), else the previous focus |
| The certificate page navigates (Back to safety, Proceed) | On its button | The page |

### Cross-cutting cases every screen must cover

| Case | Rule |
| --- | --- |
| Narrow panel (about 400px) | Tiers above; the banner keeps its first clause and the short ⌘E form; target keeps its process; send-notice actions as icon buttons; panel and dialog become the sheet under 400px of room; strip actions wrap under the text |
| 360px and 200% zoom | The banner's first clause whole; the address bar keeps the badge (word until fold step 6), registrable domain and port; the fold order in § States › Tiers applies |
| Text-spacing overrides | Status slot stays one line; whole clauses drop; nothing clipped (H-09) |
| Long URL, long and lookalike hosts | The formatter, everywhere Erfana writes an origin (H-01) |
| Long page title; title that imitates an origin | The title only in the editor tab and line 2 of its tooltip, labelled "Title:"; the tooltip never covers the address bar (H-02) |
| Light, dark and accent-coloured pages under the outline | Two-tone outline, ink label |
| Element in a frame | Panel frame line in the provenance grammar |
| Partly visible element | Outline clipped; panel against the visible part |
| Several site prompts | One row per kind, fixed order, guard re-armed per change |
| Windows forced colours | Ring solid Highlight; pick frame dashed; Out dotted; outline three lines; pressed toggle full Highlight fill with HighlightText; chips and badges keep borders |
| Reduced motion | Nothing animates; flash, changed-chip mark, guard look are static |
| macOS vs Windows and Linux | Every caption and string through `formatShortcut`; screens draw one platform per frame and both somewhere |
| Panel resized with the panel or dialog open | The still image keeps its pixels; the panel re-places |

## Security UI rules

1. **One source for the origin.** The address bar and every origin line are filled from the engine's **committed** URL, never from page content. The bar shows a **pending** URL only for a navigation the reviewer started (typed address, Reload, Back or Forward, a history or empty-tab row, a terminal link, Open in browser tab); for one the page started (script, link click, form, redirect, meta refresh) it keeps the committed URL until the new document commits, and drops a pending URL the moment the page modifies the document (H-03). **The editor-tab label and its description follow the same rule** (R2-M12): for a page-started load they keep the committed page's title, or its host, until commit. **An Erfana certificate or load-error page commits the failed URL** (R2-M10): the bar then shows that URL through the formatter with its badge (*Badge – not secure (warning up)* on the certificate page), so the bar names the host that Proceed anyway or Reload would load.
2. **One formatter for every origin Erfana writes** (H-01): the address bar, the editor-tab label when it is an address, the tab tooltip, suggestion and history rows, strip rows, notices, toasts, the certificate and load-error pages, the popup strip and the popup's OS title. It drops `https://`; keeps the scheme when it is not `https` and the port when it is not default, **at every tier**; dims subdomain labels to `--color-text-tertiary` and draws the registrable domain in `--color-text-emphasis`; removes whole subdomain labels from the front as `….`; never wraps inside the registrable domain (`nowrap`) and never cuts it, except by the last-resort start cut of fold step 8 (§ States › Tiers, R4-H1), which keeps the domain's end, the TLD and the port and never clips the end of the field – the formatter slices the string and writes the leading "…" itself, never CSS `direction`, because bidi reordering scrambles digit-led domains (R5-M3); gives the path a 2ch floor below which it is dropped whole. **It strips userinfo** (`user:password@`) on every display surface – the bar at rest, the link destination, the link header, history rows, notices; only the focused, editable bar shows it, never emphasised (R2-M9). **A non-web target** (any scheme other than `http`, `https`, `file`) is shown as the scheme word plus a plain description (*Link – non-web*), never as a host in bright text. No surface does its own truncation. Where Erfana finds the registrable domain is OD-1.
3. **Lookalikes are shown for what they are.** Mixed-script labels in punycode. Whole-script confusables remain for the code-level spoofing review (05-notes).
4. **Titles never sit where origins are.** (a) The page title appears only as the editor-tab label and as line 2 of the tab's tooltip, labelled "Title:"; the tab tooltip is drawn inside the tab strip band and never covers the address bar or the focused row (H-02); a popup's OS title shows "{host} – Erfana". (b) **One provenance grammar, asker first** (H-04): "{frame host}, inside {top host}, {asks / wants to / says} …" on every prompt, and "{frame host}, inside {top host}" as the panel's frame line. A credential prompt always leads with the origin that will receive the password.
5. **Erfana never draws inside the page (025-FR-054).** Only the rows above, the still image and Erfana pages.
6. **The site asks in the strip; your pick is answered over the still image.** Every site request is a strip row on the strip's own surface step, naming the requesting origin; nothing over the still image asks for a credential, a permission or a site decision.
7. **The chrome-side cue is the anchor** (M-03). While any Erfana panel or dialog is over the still image, the pick row always shows a cue the page cannot draw – the panel or dialog variant of the pick banner with *Chip – still image* (or *Page paused* when frozen), or *Cue – still image* when pick mode has ended – and the frame is solid lime whenever pick mode is on. A panel or dialog without that cue is not Erfana's.
8. **Page words are marked as page words.** A page dialog's message sits in a quote box labelled *Page dialog – quote label*, plain, clamped, never bold or linked; its `prompt()` field is labelled as an answer to the page and warns against passwords; server realm text is never shown; the panel's element chip carries page-chosen ids and classes, drawn mono as code and never next to Erfana's verbs (SEC-18).
9. **Prompts never take focus behind the reviewer's back.** Permission, pop-up and downloads rows never take focus; the sign-in box only after a navigation the reviewer started; page dialogs only when their tab is active and focus is already in that page (H-06). Focus never moves across panels or windows for a page.
10. **Guards against timed input** (H-05, OD-6): the strip's input guard re-arms on every row appearance and content change, with a visible blocked look and a gap between queued requests; page clicks are ignored for about 500 ms after any row shifts the page; the panel's Enter needs a fresh keydown (SPEC-7); **Proceed anyway** on the certificate page takes the same about-500 ms guard and blocked look from the moment the page appears, and ignores any press that began before it appeared (R2-M11).
11. **Erfana pages only offer navigation** – never a field for a secret or a permission.
12. **The capture's target is visible and changeable before an irreversible send**: the panel's target button and the dialog's target line are both menu buttons (OD-18), so the target can be changed at every width, including when the toolbar's own target has left the row.
13. **Full screen cannot hide the chrome** (OD-4): page full screen fills the page area only.
14. **Popups cannot sit on the opener's chrome** and cannot be narrower than their origin (M-05).
15. **Capture is always visible** (M-04): the in-use chip never leaves the address bar, and the capture chip at the end of the editor tab strip shows while any browser tab in the window uses a camera, microphone or screen.

## Copy deck

The **single source** for every visible string, accessible name, description and announcement the browser adds (M-15). Other sections name deck rows in *italics* and never retype a string. Code builds shortcut labels with `formatShortcut` and limits from their constants. **spec-fixed (ID)** strings are used exactly unless an open SPEC item, drawn as recommended, changes them; breaks are listed in [Copy findings](#copy-findings).

How to read: `{braces}` are variables; "Name" is the accessible name when it differs from the visible string; "Desc." is the accessible description; "–" none. Platform pairs macOS first. The deck types straight quotes for search; screens and code render them curly. Clause separators ( · ) in one-line chrome are listed for reading; the screens draw them with CSS.

### Voice rules for this feature

1. Sentence case everywhere. Proper nouns only: Erfana, DevTools, DuckDuckGo, Chromium, Windows, macOS, Linux, GNOME Keyring.
2. En dash with spaces for a break; never an em dash. A middle dot separates independent clauses in one-line chrome.
3. Buttons are verbs. Cancel is "Cancel". Never "OK", "Yes", "No" – including on a page's own dialogs.
4. Ellipsis on a command that asks for more (Ask…, Clear browsing data…) and on a running status (Sending…). One character.
5. Errors in three parts: what happened, why if known, what to do next. Contractions ("Couldn't", "can't", "isn't"). A Chromium code goes on its own line after the sentence, mono.
6. The origin is Erfana's word: `{host}` is always the formatter's output from the committed URL; a title or any page text never fills it and never sits in a sentence Erfana speaks, except inside a page dialog's quote box and as the tab label.
7. Erfana hosts the agent: "the agent", "your agent". Never "Erfana's AI", "the assistant", "Claude", "AI".
8. One word per idea (glossary). A word in the "Not" column is a bug.
9. Numerals for counts and sizes; units with a space except % and px.
10. Full stop on sentences in bodies, banners, toasts and announcements – **spec-fixed sentences included: they take the full stop on screen, and tests match the text without it** (owner decision OD-9). No full stop on titles, buttons, menu items, labels, chips, tooltips or one-line status clauses (the pick banner, the send notice, "Pop-up blocked"). One spec-fixed sentence is a status-slot clause and still takes its full stop: *Note – page changed* (OD-9).

### Glossary

| Word | Means | Not | Example |
| --- | --- | --- | --- |
| browser tab | The editor tab that holds a web page | browser window, web view | "New browser tab" |
| page | The document loaded now | web page, screen | "This page crashed" |
| site | The party behind an origin when it asks or is remembered | domain, website | "Always allow for this site" |
| address | What is typed in or shown in the address bar | URL, link (except "link address") | "type an address" |
| address bar | **The reader's word** for the field. "Address field" is design prose only (CT-16) | URL bar, omnibox, address field (in UI) | "in the address bar" |
| element | One part of the page's HTML | node, component, target | "Pick element" |
| pick (verb) | Choose an element with the picker; "Picking" names the mode | select, inspect, point at, choose, "your pick" | "Pick another element" |
| parent / child element | One level up or down from the picked element | ancestor, descendant (in UI) | "Parent element" |
| send | Erfana types the prompt into a terminal; a page dialog's answer is "Confirm" | submit, run | "Sent Explain to Terminal 1" |
| action | Explain, Ask, Change or Prompt, in prose | template, command | – |
| capture | The screenshot and context file for one send | snapshot | "Open capture" |
| terminal | One of Erfana's terminals | shell, console | "Show terminal" |
| agent | The CLI agent in a terminal | AI, assistant, Claude, model | "start your agent there" |
| paused | The page's scripts stop (second ⌘E) | frozen (code only), suspended | "Page paused" |
| still image | The picture of the page shown while Erfana's panel or dialog is open | screenshot (for this), snapshot | "Over a still image of the page" |
| system browser | The OS default browser | default browser | "Open in system browser" |
| sign in / sign-in | Basic and Digest authentication, and logins generally | log in, login, credentials (new strings) | "Sign in to {host}" |
| pop-up | A window or tab a page tries to open | popup (spec prose only) | "Pop-up blocked" |
| full screen | A page filling the page area | fullscreen | "{host} is now full screen." |
| clear / forget | Clear removes kinds of data; Forget deletes `.erfana/browser/` and the project's Chromium profile under Erfana's data folder | reset, wipe | "Clear browsing data…" |
| prompt above the page | How announcements name a strip row (CT-16) | the bar above the page | "Press F6 to answer in the prompt above the page." |

### Variables

| Variable | Filled from | Rule |
| --- | --- | --- |
| `{host}` | The formatter's output for the committed URL (Security rule 2) | Mono. Never page text. Domain `nowrap` |
| `{frame host}`, `{top host}` | The formatter, for a frame and the top page | As `{host}`; always in the provenance grammar, asker first |
| `{address}` | Formatted origin plus path | Mono. Path elided from its end with the 2ch floor; origin per the formatter |
| `{file name}` | Basename of a `file://` path or download | Mono; elide the folder part first |
| `{title}` | The page's `<title>` | Editor tab label and tooltip line 2 only; end-truncated |
| `{terminal name}` | The terminal's own tab name ("Terminal 1", CF-16) | Truncates first, minimum 8 characters; below 380px down to "…" (§ Tiers) |
| `{process}` | Foreground process basename, lower case, `.exe` removed | Mono; never truncated; "…" while unknown |
| `{action}` | Explain, Ask, Change or Prompt, no ellipsis | – |
| `{tag}`, `{size}` | 025-FR-026 label: `button.cta`, `120 × 32` | Mono; tag text cut at 40 characters; size never cut; speech says "by" |
| `{n}`, `{total}` | Counts | Numerals |
| `{reason}` | Reason tables below | Never a raw code |
| `{shortcut}` | `formatShortcut(…)` | ⌘E ⌘L ⌘F ⌘[ ⌘] ⌘R ⌘0 ⌘Enter on macOS; Ctrl+E Ctrl+L Ctrl+F Alt+← Alt+→ Ctrl+R Ctrl+0 Ctrl+Enter on Windows and Linux; F5, F6, Shift+F6, F12, Esc, Enter, Shift+Enter, ↑, ↓ on both |

### Commands

| Row | String | Where | Name / Desc. | Notes |
| --- | --- | --- | --- | --- |
| New browser tab | New browser tab | Palette, app menu, editor-area button | Desc. "Opens an empty browser tab" | spec-fixed (025-FR-001). Button tooltip "New browser tab ({shortcut T})" where ⌘T / Ctrl+T acts from that focus, else "New browser tab" |
| Open in browser tab | Open in browser tab | HTML preview toolbar, palette | Tooltip "Open {file name} in a browser tab" | spec-fixed (025-FR-010) |
| Open in system browser | Open in system browser | Palette, navigation row, More | Tooltip "Open {host} in your system browser" | spec-fixed (025-FR-057). CF-9 |
| Clear browsing data | Clear browsing data… | Palette, More | – | spec-fixed name plus ellipsis (CF-10) |
| Forget | Forget this project's browser data… | Palette, More | – | As above |
| Open last capture | Open last capture | Palette, More, target menu | Disabled reason "Nothing sent from this browser tab yet" | Addition A-2 |

### Browser tab (editor tab)

| Row | String | Name / Desc. | Notes |
| --- | --- | --- | --- |
| Label – empty | New browser tab | – | – |
| Label – loading, no title | {host} (the formatter, no path) | Desc. "Loading" | spec behaviour (025-FR-004); never an end-truncated URL (H-01); for a page-started load, the committed page's title or host until commit (Security rule 1, R2-M12) |
| Label – loaded | {title} | Desc. "{address}" | End-truncated |
| Label – no title | {host} | – | As loading |
| Tooltip | Line 1 {address} through the formatter · line 2 "Title: {title}" | – | Drawn beside the tab in the strip band (H-02); line 2 omitted with no title |
| In-use suffix | – (icon) | Name appends ", using your camera" / ", using your microphone" / ", using your camera and microphone" / ", sharing your screen" | – |
| Tab – waiting | – (dot icon) | Name appends ", the page is asking something" | While a page dialog waits (H-06) |
| Close | – (icon) | Name "Close {title or host}" | Tooltip "Close ({shortcut W})" |
| Capture chip | Camera in use · {host} (or Microphone in use, Screen shared) | Name "{string} – show the browser tab" | End of the editor tab strip; activates that tab (addition A-15) |

### Navigation row

| Row | String | Name / Desc. | Notes |
| --- | --- | --- | --- |
| Nav group | – | Name "Navigation"; *Nav group description* | `role="group"` |
| Nav group description | "No earlier page" / "No later page" / "No earlier or later page" | – | Present only while Back and/or Forward are disabled (M-47) |
| Back | – (icon) | Name "Back" | Tooltip "Back ({shortcut [ / Alt+←})"; disabled tooltip "Back – no earlier page" |
| Forward | – (icon) | Name "Forward" | Tooltip "Forward ({shortcut ] / Alt+→})"; disabled "Forward – no later page" |
| Reload | – (icon) | Name "Reload" | Tooltip "Reload (⌘R)" / "Reload (Ctrl+R or F5)" |
| Stop | – (icon) | Name "Stop loading" | Tooltip "Stop loading". **No key**: no hint, no `aria-keyshortcuts` – Esc is never Stop loading's key (R5-M5) |
| Busy – opening | Opening… | Open in system browser's name and tooltip while waiting | – |
| DevTools | – (icon) | Name "DevTools" / "Show DevTools" | Tooltip "DevTools (F12)" / "Show DevTools (F12)" |
| More | – (icon) | Name "More" | Tooltip "More actions" |
| More menu items | Back · Forward · Reload / Stop loading (folded tools, in toolbar order; disabled with descriptions "No earlier page", "No later page") · **Page width** group with three radio items, Full width · Phone width (390px) · Tablet width (768px) – `role="group"` labelled by its "Page width" heading, items `menuitemradio`; Phone and Tablet carry the reason line "Width only – touch and mobile mode are in DevTools"; shown only while the width preset is off the row (R5-M6, R6-M3) · Open in system browser · DevTools · Zoom: {n}% – reset · Open last capture · Clear browsing data… · Forget this project's browser data… | – | Zoom item only once the zoom chip has folded and only when not 100%, hint ⌘0 / Ctrl+0. Folded tools appear only while folded. Every item with a key carries `aria-keyshortcuts` and its hint (R4-M4); Stop loading has no key and shows none (R5-M5) |

### Address bar

| Row | String | Name / Desc. | Notes |
| --- | --- | --- | --- |
| Field | – | Name "Address and search"; Desc. the badge description, then the refused error | `combobox` |
| Placeholder | Search DuckDuckGo or type an address | – | Minimal tier: "Search or type an address" |
| Badge – not secure (http) | Not secure | Desc. "Not secure – this page isn't encrypted, so others on the network can see or change it." | `circle-alert` icon, never a lock (R4-M5) |
| Badge tooltip | The badge's full description, as in its *Badge – …* row (for example "Not secure – this page isn't encrypted, so others on the network can see or change it.") | – | Hover tooltip on the badge segment, word and icon-only forms; also shown while the address bar has keyboard focus (`:focus-visible`) and the badge is icon-only, hiding on blur or when typing starts (R5-M7). **Position, the one rule** (R6-M1, run lead's call): it stays **inside the pick-row band** and never covers the tab strip, the live page, the field, More, the banner's first clause "Picking – …" or the target button; in pick mode it starts after the first clause and ends before the target. At most two lines; when the full text does not fit, it shows *Badge tooltip – short*, and the full text stays in the badge's accessible description. **No room at all**: in pick mode, when the band has no room for even the short form (at 360px about 18px remains between "Picking – Esc to stop" and the target, while the shortest short form needs about 84px with its padding), the tooltip does not show; the full text stays in the accessible description and the badge icon (shape plus colour) remains. Owner decision OD-16. **Esc**: the first Esc hides it and is consumed (focus and field unchanged); the next Esc does the field's Esc; it stays hidden until the field loses and regains focus. **Shown by hover only, focus elsewhere**: Esc does the state's routing action and hides the tooltip in the same press; it stays hidden until the pointer leaves and re-enters the badge (R7-M5). **In a pop-up window** (no pick row): it opens inside the pop-up origin strip's band, beside the badge after the address, short form only; when it does not fit it does not show, and the badge word and the accessible description carry the state, as in OD-16 (R7-M1) |
| Badge tooltip – short | Not secure – not encrypted (remote `http`) · Not secure – certificate not trusted (warning page up) · Not secure – you chose to proceed (proceeded) · Not secure – part of the page not trusted (subresource) · Local file (File) | – | Used only when the full text does not fit in two lines inside the band (R6-M1); when even the short form does not fit, nothing shows (see *Badge tooltip*, OD-16). In a pop-up window the short form is always used, on one line. The component measures with the user's text spacing applied. A short form that would need a third line counts as not fitting, so the tooltip does not show (e.g. 'Not secure – certificate not trusted' at 360px with raised spacing). |
| Badge – not secure (warning up) | Not secure | Desc. "Not secure – this site's certificate isn't trusted." | While the certificate page is shown (M-08) |
| Badge – not secure (proceeded) | Not secure | Desc. "Not secure – this site's certificate isn't trusted. You chose Proceed anyway." | Triangle |
| Badge – not secure (subresource) | Not secure | Desc. "Not secure – part of this page came from a server whose certificate isn't trusted." | spec behaviour (025-FR-021) |
| Badge – file | File | Desc. "Local file" | – |
| Chip – in use | Camera · Microphone · Screen | Name "{host} is using your camera" / "…your microphone" / "…your screen" | Static; icon-only below 520px, same name |
| Chip – zoom | {n}% | Name "{n}% zoom, reset to 100%" | Tooltip "Reset zoom to 100% (⌘0 / Ctrl+0)" (AX-13) |
| Chip – pop-up | Pop-up blocked | Name "Pop-up blocked, show options" | spec-fixed (025-FR-011); icon-only below 520px |
| Popup strip | {host} with badges and chips | Name "Pop-up window address" | Read-only |
| Popup OS title | {host} – Erfana | – | Never the page title |

### Suggestions

| Row | String | Name | Notes |
| --- | --- | --- | --- |
| List | – | "Suggestions" | `listbox` |
| History row | {address} | – | Never a stored title |
| Link destination | Visually hidden "Link to", then {address} | – | Status slot, Browse only, while a link is hovered or focused (OD-12, R2-M2); userinfo stripped |
| Link – non-web | {scheme}: link – opens another app | – | Status slot and link header; `mailto:` reads "mailto: link – opens your email app" (R2-M9) |
| Search row | Search DuckDuckGo for "{text}" | – | `{text}` cut at 60 characters inside the quotes |

### Refused addresses

Shown in the first strip row as a field error, linked to the field; typed text stays; cleared on the next edit.

| Row | String |
| --- | --- |
| Refused – scheme | Browser tabs can't open {scheme} addresses. Type an address that starts with http://, https:// or file://. |
| Refused – Windows path | That's a Windows file path. Type it as file:///C:/site/index.html to open it. (built from the input) |
| Refused – network path | Browser tabs can't open files on a network share. Copy the file into the project and open it from there. |
| Refused – Erfana files | Browser tabs can't open Erfana's own files. |

### Find bar

| Row | String | Name | Notes |
| --- | --- | --- | --- |
| Find – field | – | "Find in page" | Placeholder "Find in page" |
| Find – count | {n} of {total} | – | spec-fixed format (025-FR-008) |
| Find – no match | 0 of 0 | Visually hidden "No matches" after it | spec-fixed |
| Find – previous / next / close | – (icons) | "Previous match", "Next match", "Close find" | Tooltips with Shift+Enter, Enter, Esc |
| Find – type to find | Type to find | – | Tooltip of Previous and Next while empty |

### Pop-up blocked

| Row | String | Notes |
| --- | --- | --- |
| Pop-up – row text | Pop-up blocked – {host} tried to open a new tab or window. | spec-fixed prefix (025-FR-011) |
| Buttons | Allow once · Always allow for this site | spec-fixed |
| Close | – (icon), name "Dismiss" | Tooltip "Dismiss – the chip in the address bar brings this back" |
| Queue count | +{n} waiting; name "{n} more pop-ups blocked" | Same pattern for every row kind ("{n} more requests waiting") |
| Note – pop-ups allowed | {host} can now open pop-ups in this project. | Status slot, 5 s (addition A-21) |

### Width presets

| Row | String | Notes |
| --- | --- | --- |
| Menu button | Full width · Phone width (390px) · Tablet width (768px); Desc. "Page width" | 025-FR-012 with owner decision OD-7 (applied in spec v0.10.0: "390 px" became "390px"). Icon only below 700px: name "Page width: {preset}" |
| Device mode | Device mode; Desc. "DevTools device mode is setting the page size" | spec behaviour (025-FR-013) |
| Tooltip | Page width | – |
| Reason line (Phone, Tablet) | Width only – touch and mobile mode are in DevTools | Addition A-21 |

### Target chooser

| Row | String | Name | Notes |
| --- | --- | --- | --- |
| Target button – agent | → {terminal name} · {process} | "{terminal name} · {process}, target terminal" | spec-fixed visible form (025-FR-061); arrow `aria-hidden`; name starts with the visible words (AX-13) |
| Target button – shell | → {terminal name} · {process} (warning icon) | "{terminal name} · {process}, target terminal, no agent running" | – |
| Target button – none | No terminal open (warning icon) | "No terminal open, target terminal" | One phrase for the state (CT-17) |
| Target button – unknown | → {terminal name} · … | "{terminal name}, target terminal, process not known yet" | – |
| Target button – panel | → {terminal name} · {process} ▾ | As above | The panel footer's menu button (M-27) |
| Tooltip | Picked elements are sent to this terminal | – | None open: "Open a terminal and start your agent there" |
| Menu items | {terminal name} · {process} | – | `menuitemradio`; reason line "No agent running" on a shell |
| Menu – show terminal | Show terminal | – | Disabled reason "No terminal open" |
| Menu – open last capture | Open last capture | – | Disabled reason "Nothing sent from this browser tab yet" |
| Menu – none | No terminal open (disabled) | – | Reason "Open a terminal and start your agent there" |

### Empty-tab hint

| Row | String | Notes |
| --- | --- | --- |
| Hint | Load your app, then click **Pick element** (⌘E / Ctrl+E) to pick an element | spec-fixed (025-FR-063) as revised by the mouse-first plan (2026-11-01): leads with the click, names the button in bold, and uses "pick" – this closes CF-6. The shortcut goes through `formatShortcut` (⌘E on macOS, Ctrl+E elsewhere) |
| First run | Type an address such as localhost:5173 in the address bar. | – |
| Heading – recent | Recent; list name "Recent addresses" | Not drawn when empty |
| Heading – local | Local servers seen in your terminals; list name "Local servers" | CT-22 |
| Local row | {address} · from {terminal name} | – |

### Pick banner, label and notes

| Row | String | Notes |
| --- | --- | --- |
| Group | – ; name "Pick and send" | `role="group"` |
| Pick element | Pick element | spec-fixed; name never changes; `aria-pressed` |
| Pick tooltip – off | Pick element (⌘E) – press ⌘E again to pick what is under the mouse; line 2 "Menus stay open while picking – click to pick" | Names both uses (025-AC-081). Line 2 replaces "↑ ↓ parent and child" (IX-5): the path and the stepper now teach refinement in the panel, and the line tells a pointer-only reviewer that a hover menu survives the click on Pick element (OD-20) |
| Pick tooltip – on | Line 1 "Stop picking"; line 2 "⌘E starts picking, then picks what is under the mouse" (Windows and Linux: "Ctrl+E …") | Names both uses of the key, as when off (025-AC-081). Esc is not named: from the button, Esc only returns to the page (CT-3) |
| Pick – blocked reason | Load a page to pick an element | Tooltip, description and status note |
| Pick banner – page focus | Picking – click an element · Esc to stop · ⌘E picks under the mouse · ↑ ↓ parent and child | spec-fixed (025-FR-065) as revised by the mouse-first plan: leads with the click. First clause "Picking – click an element" is protected; of the spec's clauses the shortcut clause drops first, then "Esc to stop". The design's optional clauses (hover echo, "↑ ↓ parent and child") keep their earlier drop order and leave before either. Narrow form of the shortcut clause: "⌘E again: pick under the mouse" |
| Pick banner – toolbar focus | Picking – Esc returns to the page | spec-fixed (025-FR-065; SPEC-2, F-9); unchanged |
| Pick banner – panel | Picking – Esc or click outside closes the panel | spec-fixed (025-FR-065) as revised; no ⌘E clause, ⌘E does nothing here (AX-12) |
| Pick banner – dialog | Picking – Esc or Cancel closes the dialog | spec-fixed (025-FR-065) as revised |
| Pick banner – Out | Picking – click the page to continue | spec-fixed (025-FR-065); no key (H-07); the click only focuses (OD-11) |
| Pick banner – Out, panel | Picking – the panel closed when you left; pick again | spec-fixed (025-FR-065); on return after focus left with the panel open (R2-M13) |
| Pick banner – Out, dialog | Picking – click to return to the dialog | spec-fixed (025-FR-065); while away with the dialog kept (CT-R2-8) |
| Chip – still image | Still image | Static chip after the panel or dialog banner while the page area shows a still image and the page is not paused; *Page paused* takes its place when frozen. Desc. "Erfana is showing a picture of the page" (R2-M2) |
| Page paused | Page paused | spec-fixed chip |
| Cue – still image | Over a still image of the page – Esc or Cancel closes the dialog | Pick off, dialog open (M-03); follows *Pick banner – dialog* |
| Label | {tag} {size} | spec-fixed content (025-FR-026) |
| Note – nothing outlined | Move the mouse over the page to pick an element | 4 s (M-24) |
| Note – top of the page | Top of the page | 2 s, in the panel header or status slot (IX-6) |
| Note – back at the start | Back at the element you started from | 2 s |
| Note – frame removed | That frame is gone. Pick another element. | Announcement; the outline simply goes |
| Note – page moved | The page moved – click again | 2 s, status slot; shown when the click guard dropped a page click in pick mode (025-FR-047, 025-FR-048; mouse scope, Y10). No full stop: a one-line status clause (voice rule 10) |
| Note – element gone | That element is gone – pick again | 2 s, in the panel header after the stepper (like *Note – top of the page*); after a click pick, when the page has removed the picked element and the reviewer refines; the arrows show their end look (025-FR-027; Y6) |
| Note – right-click off | Right-click is off while picking – click Pick element to stop | 2 s, status slot, replaces the later clauses; a right-click on the page in pick mode (025-FR-048; Z4) |

### Prompt-actions panel

| Row | String | Name / Desc. | Notes |
| --- | --- | --- | --- |
| Panel | – | Name "Actions for {tag}, {size spoken}"; Desc. the target and the key hint | `dialog`, `aria-modal="false"` |
| Panel – element chip | {tag} · {size} | – | Mono, page text |
| Stepper – parent | – (▲ icon) | Name "Parent element"; tooltip "Parent element (↑)" | Disabled look at the top |
| Stepper – child | – (▼ icon) | Name "Child element"; tooltip "Child element (↓)" | Disabled look at the start |
| Path – nav | – | Name "Element path" | `nav` around an ordered list (ancestors from the outermost to the picked element); the whole path is pointer-only (`tabindex="-1"`) |
| Path – crumb | {tag}{#id or .classes} of an ancestor | The visible text is the name; Desc. "Moves the pick here" | Ghost button, mono, `--text-sm`, 24px high; a click moves the pick there. Separators "›" and the leading "…" are drawn, not typed into the name (`aria-hidden`) |
| Path – current | The element chip ({tag} · {size}) | `aria-current="true"` | The picked element; marked as changed for 1 s after a move |
| Panel – close | × (icon) | Name "Close – nothing is sent" | 24 × 24, last in the Tab order after the target button; closes the panel without sending, like Esc (owner scope: mouse only) |
| Panel – frame line | {frame host}, inside {top host} | – | Cross-origin frame only (H-04) |
| Panel – notes | Partly off-screen · Off-screen · Zero size | – | Neutral chips |
| Explain | Explain | Desc. "Sends now – asks the agent to explain this element" | spec-fixed; no ellipsis |
| Ask | Ask… | Name "Ask"; Desc. "Ask the agent a question about this element" | spec-fixed (025-FR-030; SPEC-6) |
| Change | Change… | Name "Change"; Desc. "Ask the agent to change the code behind this element" | spec-fixed (025-FR-030; SPEC-6) |
| Prompt | Prompt… | Name "Prompt"; Desc. "Write your own prompt about this element" | spec-fixed (025-FR-030; SPEC-6) |
| Busy – sending | Sending… | – | The pressed control |
| Panel – key hint | ↑ ↓ parent and child · Tab next action · Esc closes the panel | – | Narrow: "↑ ↓ parent and child · Esc closes the panel". The click routes (path, arrows, ×, outside) are visible controls and need no hint line |
| Announce – refined | Picked {tag}, {size spoken}. | – | Polite, on each refinement |

### Instruction dialog

| Row | Ask | Change | Prompt |
| --- | --- | --- | --- |
| Dialog – title | Ask about this element | Change this element | Prompt about this element |
| Dialog – field label | Your question | What to change | Your prompt |
| Dialog – field hint | The agent answers in the terminal. | A fix, a style change or new text. | Sent as you write it, with the screenshot and page details. |
| Dialog – empty error | Type your question before sending. | Say what to change before sending. | Type your prompt before sending. |

| Row | String | Notes |
| --- | --- | --- |
| Back to actions | Actions (← icon); name "Back to actions" | M-25 |
| Dialog – key hint | ⌘Enter to send · Enter adds a line | Windows: Ctrl+Enter |
| Dialog – target line | "Sends to", then the menu button *Target button – panel* ({terminal name} · {process}) | Menu button, `aria-haspopup="menu"`; same name as the panel footer's button (OD-18) |
| Buttons | Cancel · Send | spec-fixed |
| Banner – page reloaded | The page reloaded – the capture shows the page as you picked it. | spec-fixed (025-FR-053); full stop on screen (OD-9); hidden "Note:" |

### Send notice

| Row | String | Name | Notes |
| --- | --- | --- | --- |
| Send notice | Sent {action} to {terminal name} | – | spec-fixed (025-FR-060) |
| Show terminal | Show terminal (icon below 800px) | "Show terminal" | spec-fixed |
| Open capture | Open capture (icon below 800px) | "Open capture"; Desc. "Opens the context file in an editor tab" | spec-fixed |
| Announce – sent | Sent {action} to {terminal name}. Show terminal and Open capture are also in the target menu. | – | Polite (H-12) |
| Note – page changed | The page changed – pick the element again. | – | spec-fixed (025-FR-053); takes its full stop even in the status slot (OD-9), over voice rule 10's one-line-clause exception |

### Guard, pre-warn and failure messages

| Row | String | Action | Notes |
| --- | --- | --- | --- |
| Pre-warn – shell | {terminal name} is running {process}, not an agent. Choose another terminal, or start your agent there and pick again – leaving this panel closes the pick. Ask…, Change… and Prompt… keep your pick while you're away. | Choose terminal | Warning, on open (M-28, R2-M13); never the error's "send again" (R2-M4) |
| Pre-warn – no terminal | No terminal open. Open one, start your agent there and pick again – leaving this panel closes the pick. Ask…, Change… and Prompt… keep your pick while you're away. | Open terminal | Warning (R2-M13) |
| Guard – shell | No agent is running in {terminal name} – start your agent there, then send again. | Choose terminal | spec-fixed (025-FR-061); error, assertive |
| Guard – no terminal | No agent is running in a terminal – no terminal is open. Open one, start your agent there, then send again. | Open terminal | Keeps the AC prefix (CT-10, CF-1); button is addition A-5 |
| Note – target chosen | Sends to → {terminal name} · {process} – send again when ready. | – | Replaces the error (M-29) |
| Choose terminal menu | Items "{terminal name} · {process}", reason line "No agent running" on shells | – | – |
| Toast – capture failed | Couldn't capture this element · {reason}. Nothing was sent – pick it again. | – | Title · message |
| Toast – write failed, dialog | Couldn't send to your agent · {reason}. Nothing was sent, and your text is still in the dialog – press Send to try again. | – | CT-14 |
| Toast – write failed, Explain | Couldn't send to your agent · {reason}. Nothing was sent – choose Explain to try again. | – | – |

`{reason}`: "The screenshot came back empty" · "The page didn't return this element's details" · "The disk is full" · "The captures folder is read-only" · "Erfana couldn't save the capture files" · "{terminal name} closed before the prompt arrived" · "Erfana couldn't type into {terminal name}".

### Permission prompts and in-use

| Row | String | Notes |
| --- | --- | --- |
| Permission – camera / microphone / both | {host} wants to use your camera · …your microphone · …your camera and microphone | – |
| Permission – screen | {host} wants to see your screen | Always asks |
| Permission – location / notifications | {host} wants to know your location · {host} wants to show notifications | – |
| Permission – clipboard | {host} wants to see what you copy; Desc. "Text and images on your clipboard" | – |
| Permission – frame | {frame host}, inside {top host}, wants to … | H-04 |
| Permission – remembered | Erfana remembers your answer for this site in this project. | Row description, not for screen sharing (M-11) |
| Permission – remembered, camera or microphone | Allow once is for this page load only. Allow and Block are remembered for this site in this project. | Row description where Allow once is offered (R2-M2) |
| Buttons | Block · Allow once · Allow | spec-fixed (025-FR-019): "Allow once" (SPEC-5, applied), camera and microphone only |
| Close | – (icon), name "Dismiss"; Desc. "Blocks this request until the page reloads" | – |
| Screen picker | Title "Share your screen with {host}" · tabs "Entire screen", "Window" · Cancel, Share; Share blocked with "Choose a screen or window" | CT-23 |

### Full screen and pointer lock

| Row | String |
| --- | --- |
| Full screen | {host} is now full screen. Press Esc to exit. |
| Pointer lock | {host} has hidden your pointer. Press Esc to exit. |

"Press Esc to exit" is spec-fixed (025-FR-019).

### Downloads

| Row | String | Notes |
| --- | --- | --- |
| Finished | Downloaded {file name} · Show in folder | spec-fixed action (025-FR-020) |
| Failed | Couldn't download {file name} · {reason}. The partial file was deleted. | Reasons: "The download was interrupted", "The server stopped sending the file", "Erfana can't write to that folder", "The disk is full" |
| Downloads – several files | {host} (origin line) · This site wants to download several files. · Block, Allow | spec-fixed sentence (025-FR-020), full stop on screen (OD-9); origin line added (CF-7) |

### Sign-in box

| Row | String | Notes |
| --- | --- | --- |
| Sign-in – title | Sign in to {host} | Realm never shown |
| Sign-in – title, frame | {frame host}, inside {top host}, asks you to sign in | spec-fixed (025-FR-022); SPEC-3 replaced "inside a frame from" (H-04) |
| Fields, checkbox | Username · Password · Remember for this project (Desc. "Saved encrypted in this project's browser data") | spec-fixed |
| Remember – no keyring | Disabled, reason "No keyring – cannot store passwords safely" | spec-fixed (CF-17: wording breaks voice rule 5, still open) |
| Buttons, busy | Cancel · Sign in · Signing in… | – |
| Sign-in – http warning | This connection isn't encrypted – others on the network could read your password. | M-10 |
| Sign-in – rejected (typed) | {host} didn't accept that username and password. Check them and sign in again. | – |
| Sign-in – rejected (saved) | {host} didn't accept the saved username and password. Enter them again. | CT-19 |

### Page dialogs and leave-page

| Row | String | Notes |
| --- | --- | --- |
| Page dialog – header | {host} says | `alertdialog` name |
| Page dialog – header, frame | {frame host}, inside {top host}, says | H-04 |
| Page dialog – quote label | Message from the page | Above the quote box (M-02) |
| Buttons | `alert`: Close · `confirm`, `prompt`: Decline · Confirm | Never "OK". Never "Cancel", which collides with page text such as "Cancel your booking for plot 7?" (the test fixture); 025-FR-058 does not fix these labels (R2-M8). "Cancel" stays for Erfana's own dialogs |
| Page dialog – field label | Answer to the page | – |
| Page dialog – field note | Never type a password here – this answer goes to the page. | – |
| Checkbox | Don't let this page show more dialogs | spec-fixed, from the third dialog |
| Announce – page dialog waiting | {host} says something. Press F6 to answer in the prompt above the page. | H-06; same F6 sentence as *Announce – prompt arrives* (AX-R2-8) |
| Leave-page – title / body | Leave this page? · Changes may not be saved. | spec-fixed (025-FR-058), body with its full stop on screen (OD-9); origin line "{host}" above (CT-9) |
| Leave-page buttons | Stay · Leave | spec-fixed |

### Load error

| Row | String | Notes |
| --- | --- | --- |
| Title, sentence, next step, hint | From the table below | – |
| Address line, code line | {address} · {code} | Mono |
| Reload | Reload · busy "Reloading…" | spec-fixed |

| Code | Title | Sentence | Next step | Loopback hint (replaces the next step) |
| --- | --- | --- | --- | --- |
| `ERR_CONNECTION_REFUSED` | {host} refused to connect | Nothing is accepting connections at this address. | Check that the server is running, then press Reload. | Is your dev server running? Start it in a terminal, then press Reload. |
| `ERR_NAME_NOT_RESOLVED` | Can't find {host} | No server with this name could be found. | Check the address for typos, then press Reload. | Names ending in .localhost need no setup; other local names need an entry in your hosts file or local DNS. |
| `ERR_NAME_RESOLUTION_FAILED` | Can't find {host} | The name lookup failed. | Check your network connection, then press Reload. | – |
| `ERR_CONNECTION_TIMED_OUT` | {host} took too long to respond | The server didn't answer in time. | Check your network connection, or press Reload in a moment. | If your dev server is running, it may be stuck – restart it. |
| `ERR_TIMED_OUT` | {host} took too long to respond | The page took too long to load. | Press Reload to try again. | As above |
| `ERR_INTERNET_DISCONNECTED` | You're offline | This computer isn't connected to a network. | Check your network connection, then press Reload. | – |
| `ERR_NETWORK_CHANGED` | Your network changed | The connection was interrupted because your network changed. | Press Reload to try again. | – |
| `ERR_CONNECTION_RESET` | The connection to {host} was reset | The connection closed before the page finished loading. | Press Reload to try again. | If your dev server is restarting, wait for it, then press Reload. |
| `ERR_CONNECTION_CLOSED` | {host} closed the connection | The server closed the connection without sending a page. | Press Reload to try again. | As above |
| `ERR_EMPTY_RESPONSE` | {host} didn't send anything | The server answered with an empty response. | Press Reload to try again. | Check your dev server's terminal for an error. |
| `ERR_ADDRESS_UNREACHABLE` | Can't reach {host} | This address can't be reached from your network. | Check the address, and that you're on the right network or VPN. | – |
| `ERR_UNSAFE_PORT` | Browser tabs can't open port {port} | Chromium blocks this port because other services use it. | Run your server on another port, such as 3000 or 5173. | Same |
| `ERR_SSL_PROTOCOL_ERROR` | Can't make a secure connection to {host} | The server's response couldn't be used for a secure connection. | If the server only uses http, change https to http in the address. | Dev servers often run without https – try http://{host}. |
| `ERR_TOO_MANY_REDIRECTS` | {host} redirected too many times | The page keeps sending the browser to another address. | Clearing cookies with Clear browsing data… may fix it. | Check your app's redirect rules – it may redirect to itself. |
| `ERR_FILE_NOT_FOUND` | Can't find {file name} | There's no file at this path. | Check that the file exists and hasn't been moved or renamed. | – |
| `ERR_ACCESS_DENIED` | Can't open {file name} | Erfana isn't allowed to read this file. | Check the file's permissions, then press Reload. | – |
| `ERR_BLOCKED_BY_CLIENT` | Erfana blocked this address | Browser tabs don't open this kind of address, to keep your computer safe. | Go back, or type a different address. | – |
| `ERR_ABORTED` | – (not shown) | – | – | The tab keeps what it showed |
| `ERR_CERT_*` | – (certificate page) | – | – | – |
| Any other | Can't open this page | The page at {host} didn't load. | Press Reload to try again. If it keeps happening, the code below helps with a bug report. | – |

### Certificate warning

| Row | String | Notes |
| --- | --- | --- |
| Title | {host} has a certificate Erfana can't trust | – |
| Risk line | Someone could be pretending to be {host} to read or change what you send. | – |
| Back to safety | Back to safety | spec-fixed; filled primary |
| Proceed anyway | Proceed anyway; name "Proceed anyway to {host}"; Desc. the code's *Caution text* | spec-fixed; shown at once on every host, HSTS and preloaded hosts included (owner decision OD-5, SPEC-4); text-style button, quieter than Back to safety (M-43) |
| Caution text | Per code, below | Always visible, directly beside Proceed anyway; carries the 7-day explanation; uses the button's verb, "proceed" (CT-R2-9) |
| More about this error | More about this error | `<details>` summary; holds the address and code lines and technical detail, never a button (R2-M2) |

| Code | Sentence | Caution text |
| --- | --- | --- |
| `ERR_CERT_AUTHORITY_INVALID` | Its certificate wasn't issued by an authority Erfana trusts – it may be self-signed. | If this is your own server, such as a staging site with a self-signed certificate, you can proceed. Erfana remembers this choice for {host} for 7 days, or until you clear browsing data. |
| `ERR_CERT_DATE_INVALID` | Its certificate has expired, or isn't valid yet. Check that your computer's date is right. | Proceed only if you know this server's certificate has lapsed – for example, a test server you look after. Erfana remembers this choice for 7 days, or until you clear browsing data. |
| `ERR_CERT_COMMON_NAME_INVALID` | Its certificate is for a different site, not {host}. | Proceed only if you know why this certificate doesn't match – for example, a test server you set up. Erfana remembers this choice for 7 days, or until you clear browsing data. |
| `ERR_CERT_REVOKED` | Its certificate was withdrawn by the authority that issued it. | The authority that issued this certificate withdrew it, which often means it was misused. Proceed only if you're sure this is your own test server. Erfana remembers this choice for 7 days, or until you clear browsing data. (R2-M6) |
| Any other `ERR_CERT_*` | Its certificate isn't valid. | Proceed only if you know why this certificate isn't valid – for example, a test server you set up. Erfana remembers this choice for 7 days, or until you clear browsing data. (R2-M6) |

### Crashed and hung

| Row | String | Notes |
| --- | --- | --- |
| Crash – title, body | This page crashed · Its process stopped unexpectedly. Press Reload to open it again. | Title spec-fixed |
| Crash – nothing sent | Nothing was sent to your agent. | With the panel or dialog open (addition A-21) |
| Hung – row | This page is not responding | spec-fixed (CF-17) |
| Hung – explanation | Wait for it, or press Reload – reloading loses anything not saved on the page. | – |
| Buttons | Wait · Reload | spec-fixed |

### Page right-click menu

| Row | String | Notes |
| --- | --- | --- |
| Items | Back · Forward · Reload · Copy · Paste · Select all · Open link in new tab · Open link in system browser · Copy link address · Copy image · Open image in new tab · Pick this element · Inspect | spec-fixed. Hints ⌘[ ⌘] ⌘R ⌘C ⌘V ⌘A / Alt+← Alt+→ Ctrl+R Ctrl+C Ctrl+V Ctrl+A; Inspect F12; **Pick this element has no hint** (M-35) |
| Link header | {host} of the link, through the formatter; a non-web link shows *Link – non-web* | Owner decision OD-12; first line of every link menu, not focusable (R2-M2) |
| Reason lines | No earlier page · No later page | – |
| Menu name | Page actions | – |

### Clear browsing data and Forget

| Row | String | Notes |
| --- | --- | --- |
| Title, intro | Clear browsing data · For this project only. Its open browser tabs reload afterwards. | – |
| Checkboxes and descriptions | Cookies and other site data ("Signs you out of most sites. Also clears the address history.") · Cached files ("Saved copies of files that make pages load faster.") · Site permissions, certificate exceptions and pop-up exceptions ("Your Allow and Block answers, Proceed anyway choices and allowed pop-ups.") · Saved sign-in credentials ("Usernames and passwords saved with Remember for this project.") · Captures ("Screenshots and context files sent to your agent. They're deleted after 7 days anyway.") | spec-fixed labels; defaults per 025-FR-023 |
| Blocked reason | Tick at least one kind of data. | – |
| Buttons, busy, done | Cancel · Clear · Clearing… · toast "Browsing data cleared for this project." | – |
| Step failed | Some data wasn't cleared · Couldn't clear {kind} – {reason}. Data you didn't tick wasn't touched. | – |
| Forget | Title "Forget this project's browser data?" · body "This closes the project's browser tabs and deletes its browser data – cookies, saved sign-ins, permissions, history and captures – from the .erfana/browser folder and from Erfana's own data folder. You'll be signed out of every site in this project." · Cancel · Forget browser data · Forgetting… | – |
| Forget done | This project's browser data is deleted. | – |
| Forget done, Windows | This project's browser data is deleted. A few files still in use go the next time Erfana starts. | CT-21 |
| Forget failed | Browser data not fully deleted · Couldn't delete {path} – {reason}. | – |

### Keyring

| Row | String | Notes |
| --- | --- | --- |
| Keyring – notice | No keyring – cookies and other site data on this computer are stored with weak protection, and Remember for this project isn't available. Set up a keyring such as GNOME Keyring to protect them. · Dismiss | Names the checkbox exactly as the sign-in box shows it (025-FR-018). Shown on the first browser tab of a project after each Erfana start **until dismissed**; once dismissed, never again for that project (H-13) |
| Keyring – reset | Logins were reset because the keyring changed. · Sign in to your sites again. · Dismiss | First sentence spec-fixed (025-FR-018), full stop on screen (OD-9); once |

### Other toasts

| Row | String |
| --- | --- |
| Toast – system browser failed | Couldn't open in your system browser · {reason}. Copy the address from the address bar instead. |
| Toast – path is a link | Couldn't open a browser tab · {path} is a link to somewhere outside the project, so Erfana won't keep browser data there. Remove the link, then try again. |
| Toast – gitignore failed | Couldn't open a browser tab · Erfana couldn't create .erfana/browser/.gitignore – {reason}. It keeps browser data out of git, so the tab stays closed. |

### Announcements

Fed into one always-mounted, visually hidden polite region per browser tab (M-45); the visible status slot has no live role. Assertive only where marked.

| Moment | Said |
| --- | --- |
| Pick mode on | Picking. Esc to stop. |
| Pick mode off | Picking stopped. |
| Panel opens | The panel's name, then its first action (native focus) |
| Refinement | *Announce – refined*; at an end, *Note – top of the page* / *Note – back at the start* with a full stop |
| Page paused | Page paused. (once) |
| Sent | *Announce – sent* |
| Guard hit | The guard text – assertive |
| Capture or write failed | The toast title and message – assertive |
| Page changed | The page changed – pick the element again. |
| Site prompt arrives | *Announce – prompt arrives* |
| Sign-in arrives without focus | *Announce – prompt arrives*, with "{host} asks you to sign in" as the request |
| Page dialog waits | *Announce – page dialog waiting* |
| Find count | {n} of {total}. / No matches. – on change |
| Full screen, pointer lock | The deck strings |
| Load error | {title}. |
| Download finished, data cleared | The toast text |
| Announce – prompt arrives | {request}. Press F6 to answer in the prompt above the page. – the one F6 sentence, used for every strip-row arrival (AX-R2-8) |

### Decided variants

Every open decision was answered on 2026-11-01 (§ Decisions), so the deck carries one variant per row. The certificate page follows OD-5 and SPEC-4 as the owner answered them: Proceed anyway is shown at once on every host, with its caution text beside it.

### Copy findings

| # | Finding | Recommendation |
| --- | --- | --- |
| CF-1 | "No agent is running in {terminal name}" has no name to fill when no terminal is open | *Guard – no terminal*; the spec should name both forms (part of SPEC-6's clarification set) |
| CF-2 | Spec-fixed body sentences carry no full stop ("The page changed – pick the element again", the guard, "Logins were reset…", the hint, "Leave this page? Changes may not be saved") | Closed by owner decision OD-9: drawn with the full stop, tests match the text without it. OD-9 also covers "The page changed – pick the element again." in the status slot |
| CF-3 | Ellipsis read aloud in names | Names "Ask", "Change", "Prompt" |
| CF-4 | Superseded by SPEC-2 (one banner per state) | – |
| CF-5 | "Logins" and no next step in the keyring reset | Keep exact, add "Sign in to your sites again." |
| CF-6 | "point at an element" (025-FR-063) is a second verb for picking | Spec: "…to pick an element". **State: deferred** – not in spec v0.11.0 (the spec still has "point at an element"); the deck keeps the spec-fixed string. Owner call for the next spec revision |
| CF-7 | Downloads and leave-page sentences name no origin | Origin line added above both |
| CF-8 | Superseded by the provenance grammar (H-04, SPEC-3) | – |
| CF-9 | "Open in default browser" ships in the HTML preview (`PreviewToolbarTools.tsx:123`) **and** the project tree menu (`ProjectTree/context-menu/strategies.tsx`) | Rename both to "Open in system browser" in a follow-up (CT-13) |
| CF-10 | Command names that open a dialog need "…" | Added in menus and palette |
| CF-11 | "Sent {action} to…" uses a verb as a noun | Translators get one string per action |
| CF-12 | No concatenated sentences; the first banner clause must survive 40% longer | – |
| CF-13 | "390 px" | Closed by owner decision OD-7: "390px" |
| CF-14 | The preview's Back tooltip types "Cmd+[" | Writing card defect |
| CF-15 | "The page reloaded…" also shows after a navigation to another page | Minor; if revised: "The page changed – the capture shows the page as you picked it". **State: deferred** – not in spec v0.11.0; the deck keeps "The page reloaded – …". Owner call for the next spec revision |
| CF-16 | Terminal names assumed "Terminal 1" | Confirm before baking |
| CF-17 | Spec-fixed "cannot store passwords safely", "is not responding", "Saved sign-in credentials" break rule 5 and the glossary | Next spec revision: "can't", "isn't responding", "Saved sign-ins" (CT-20). **State: deferred** – not in spec v0.11.0; the deck keeps the spec-fixed strings and the screens draw them as written. Owner call for the next spec revision |
| CF-18 | Spec-fixed labels with the design's ellipsis | SPEC-6 |
| CF-19 | "Allow once" and "Allow this time" | SPEC-5 |
| CF-20 | "inside a frame from" reads either way | SPEC-3 |
| CF-21 | Comment mode says "Comment mode · Esc to leave"; the browser says "Picking – Esc to stop" | Owner decision OD-14: one banner pattern shared with comments; the wording change is a spec follow-up. **State: deferred** – the browser's banners are spec-fixed in 025-FR-065; the comment-mode wording change is not in spec v0.11.0. Owner call |

## Accessibility

Screen-reader support is out of Erfana's scope (#440); roles, names and announcements are what the cards require, not gates. Keyboard-only use is in scope; picking without a mouse is out of scope, but the Shift+F10 → Pick this element route exists and is drawn (M-35). **Mouse-only use is in scope for picking an element and sending a prompt** (owner scope, 2026-11-01): every step – start and stop pick mode, pick, hover-only pick, refine, choose an action, write and send, change the target, close without sending, answer a guard banner, use the send notice's actions – has a pointer path; only typing the instruction needs keys. Key-only paths outside that workflow (pointer lock, full-screen exit, find, zoom, Enter in the address bar) stay as they are (OD-19).

### Focus order

| Surface | Order |
| --- | --- |
| Browser tab | Navigation row (Back, Forward, Reload/Stop, address bar, field chips, Open in system browser, DevTools, More – always shown, OD-22) → pick row (Pick element, status-slot actions when present, width preset, target) → find row → strip rows in their order → an Erfana page's content → out of the browser tab (025-FR-047). The page is not a Tab stop: Tab from the last control leaves the browser tab. The live page is reached by loading, Esc in the field, Esc on any other button in the navigation row or the pick row, a click, or F6; left with Ctrl/Cmd+L |
| Prompt-actions panel | Explain → Ask… → Change… → Prompt… → banner button (when present) → target button → × → wrap. Explain focused on open. The ancestor path and the stepper are pointer-only; ↑ ↓ are their keys (SPEC-6) |
| F6 and Shift+F6 | Forward and back through navigation row → pick row → strip rows → find row (only while open) → the page → around (025-FR-047). **From the page**: F6 lands on the address bar; Shift+F6 lands on the last control in the strip when a prompt shows there, else on the last control of the pick row. With the panel open they close it first (025-FR-049; § Flows › Cancel at each point) |
| Instruction dialog | ← Actions → banner button (if any) → field → target button ("Sends to") → Cancel → Send → wrap. Initial focus: the field |
| Strip row | Its controls in reading order; a page dialog's overflowing quote box after the header |
| Erfana pages | Their actions; Back to safety before Proceed anyway |

Where focus lands when a surface goes: § States, "Where focus lands when a surface goes".

### Roles

Names and descriptions are deck rows; this table gives structure only.

| Control | Role and properties | Deck row |
| --- | --- | --- |
| Navigation row | `group`, described while Back or Forward is disabled | *Nav group*, *Nav group description* |
| Back, Forward, Reload / Stop | `button`; `aria-keyshortcuts` on Back, Forward and Reload, none on Stop (R5-M5) | *Back*, *Forward*, *Reload*, *Stop* |
| Address bar | `combobox` with `listbox` | *Field*, *Suggestions* |
| Chips | `button` (zoom, pop-up); static text (in use) | *Chip – …* |
| Pick row | `group` | *Group* |
| Pick element | `button`, `aria-pressed`, `aria-keyshortcuts` Meta+E / Control+E | *Pick element* |
| Status slot | plain text, no live role | *Pick banner – …* |
| Width preset, target | `button`, `aria-haspopup="menu"`, `aria-expanded` | *Menu button*, *Target button – …* |
| Find field | `searchbox`; count in the hidden region | *Find – …* |
| Prompt-actions panel | `dialog`, `aria-modal="false"`, `aria-keyshortcuts="ArrowUp ArrowDown"`; **other zones stay live and are not `inert`** – a toolbar click or Ctrl/Cmd+L closes the panel (025-FR-049, R2-H1) | *Panel* |
| Stepper | `button`, `tabindex="-1"`, `aria-disabled` at an end | *Stepper – …* |
| Element path | `nav` named "Element path" around an `ol`; crumbs are `button`, `tabindex="-1"`; the picked crumb has `aria-current="true"` | *Path – …* |
| Panel close | `button`, last Tab stop in the panel | *Panel – close* |
| Actions | `button` | *Explain*, *Ask*, *Change*, *Prompt* |
| Instruction dialog | `dialog`, `aria-modal="false"`; other zones `inert`, icons dimmed, origin text and focus rings never dimmed | *Dialog – title* |
| Strip prompt row | `group`; `alertdialog` for page dialogs and leave-page, described by the quote | The row's deck strings |
| Page frame | decorative | – |
| Editor tab | `tab`, described by the address | *Label – …*, *Tooltip* |

### Targets and non-colour cues

Every pointer target is at least 24 × 24. Pressed is a shape (lime foot; full Highlight fill in forced colours); pick mode is a frame plus words plus the crosshair; Out is a dashed frame; frozen is a word chip; insecure is a word badge (icon-only only at fold step 6, by card exception); errors carry an icon and a word; selected adds a fill and a doubled edge; the guard has a blocked look.

## Additions beyond the spec

One row per UI element or behaviour the spec does not require (M-23, OD-15). **Routine call**: the owner can approve the table as a whole. **Spec change**: needs a spec line, listed in § Spec follow-ups. The owner approved the table as a group on 2026-11-01 (OD-15).

| # | Addition | Why | Kind |
| --- | --- | --- | --- |
| A-1 | Zoom chip in the address bar and popup strip; "Zoom: n% – reset" in More | 025-FR-008 has keys only; a zoomed page otherwise looks broken | Routine call |
| A-2 | Show terminal and Open last capture in the target menu; Open last capture in More and the palette | Keeps the send notice's actions reachable after 5 s (F-4) | Routine call |
| A-3 | The panel's and the dialog's target as a menu button, in each one's Tab cycle | Changing the target must not discard the pick, and must stay possible when the toolbar's target has left the row (OD-18) | Spec change (SPEC-6; 025-FR-061) |
| A-4 | Pre-warn banner when the panel opens on a shell or no terminal; guard banner swapped in place; banner rewritten after a choice | Prevent the error instead of recovering from it | Routine call |
| A-5 | "Open terminal" on the no-terminal banners | Choose terminal led to an empty menu | Spec change (SPEC-6 row; R2-M17) |
| A-6 | ← Actions in the dialog | Re-branch without redoing a frozen pick | Spec change (025-FR-050, 025-FR-031; now in the spec, v0.11.0) |
| A-7 | Refinement stepper in the panel header | Visible, mouse-reachable refinement (H-08) | Routine call |
| A-8 | Banner variants per routing state and the third "↑ ↓" clause | One true instruction per state | Spec change (SPEC-2) |
| A-9 | Pick notes: nothing outlined, ends of refinement, blocked pick | Visible answers to no-op keys | Spec change (025-FR-025, 025-FR-028, 025-AC-025, 025-AC-027; now in the spec, v0.11.0) |
| A-10 | Frame line and note chips in the panel header | Provenance and capture notes before sending | Routine call |
| A-11 | Strip input guard re-armed on every change, with a visible look and a gap | Clickjacking and double-click grants | Spec change (OD-6) |
| A-12 | Page-click guard after a layout shift; hit-test re-run in pick mode | Wrong-element picks and mis-clicks | Spec change (A-12 row; R2-M17) |
| A-13 | Page dialogs take focus only in the active tab with page focus; tab "waiting" mark | Keystroke capture from background tabs | Routine call |
| A-14 | Popup minimum width and ignored positions over the opener's chrome; popup OS title shows the origin | Spoofing via popup geometry and titles | Spec change (A-14 row; R2-M17) |
| A-15 | Capture chip at the end of the editor tab strip; in-use chip never leaves | Capture always visible | Routine call |
| A-16 | Link destination in the status slot and the link menu's header | See where a link goes | Owner decision (OD-12) |
| A-17 | F6 / Shift+F6 pane cycling | Keyboard route to the page and to prompts | Spec change (OD-13) |
| A-18 | Alt+↑ / Alt+↓ as refinement aliases | One chord across both pickers | Spec change (OD-14) |
| A-19 | Fresh-keydown rule for the panel | Accidental Explain | Spec change (SPEC-7) |
| A-20 | First click after Out only returns focus | Accidental capture | Spec change (OD-11) |
| A-21 | Small copy additions: pop-ups-allowed status line, "+N waiting", "Browsing data cleared" toast, crash page "Nothing was sent" line, loopback hints, width-preset reason line, screen source picker as a strip row (placement assumption), keyring next step, origin lines on downloads and leave-page, "remembered" description on permission rows, page-dialog quote label and field note, tab tooltip "Title:" line | Clarity; no behaviour change | Routine call |
| A-22 | Still-image cue in the pick row when pick mode has ended | Anchor for spotting a faked dialog (M-03) | Routine call |
| A-23 | Back/Forward reason in the navigation group's description | Keyboard users learn why | Routine call |
| A-24 | Withdrawn – the owner kept Proceed anyway on every host (SPEC-4 declined) | – | – |
| A-25 | Full screen confined to the page area (OD-4); Proceed anyway shown at once with its caution text (OD-5) | Security defaults the spec leaves open | Owner decision |
| A-26 | Still-image chip in the pick row while the panel or dialog shows a still image | Chrome-side cue (Security rule 7) | Routine call |
| A-27 | Proceed anyway input guard and fresh-press rule | Timed clicks now that Proceed anyway shows at once (OD-5) | Spec change (025-FR-021; now in the spec, v0.11.0) |
| A-28 | Esc on any other button in the navigation row or the pick row, unless one of its menus is open, returns focus to the page | One way back to the page from the toolbar buttons | Spec change (025-FR-051; TR-R2-7) |
| A-29 | Last-resort start cut of the host (fold step 8), done by the formatter slicing the string and writing "…" (never CSS `direction`, R5-M3), also for the tab label; `circle-alert` badge glyph and badge tooltip | The end of a domain and the port are what a spoof hides; a lock glyph reads as safe | Routine call (run lead, R4-H1, R4-M5) |
| A-30 | Target name: minimum 8 characters, below 380px down to "…" (full name in the accessible name and target menu; process never cut) | Keeps the process and More whole at 360px | Spec change (025-FR-061; R5-M8) |
| A-31 | Ancestor path in the panel and sheet header (DevTools' breadcrumb): each ancestor a button that moves the pick, the picked element the current crumb, cut from its start behind "…" | The stepper moves one step at a time; a pointer user otherwise cannot jump to a distant ancestor | Spec change (025-FR-027, 025-FR-030; mouse-first plan, run lead's call) |
| A-32 | **×** close button on the panel and sheet ("Close – nothing is sent"), and a click outside the panel as an explicit pointer exit; the panel's pointer press counts only if it began after the panel opened | Esc was the only visible-by-name way out; the hint named only keys | Spec change (025-FR-030, 025-FR-049; mouse-first plan) |
| A-33 | A pointer right-click **Pick this element** picks at once and opens the panel; Shift+F10 keeps outline-then-Enter | Chosen from a menu with a pointer, a second confirmation had no pointer route (OD-21) | Spec change (025-FR-057, 025-AC-074) |
| A-34 | More always shown | Clear browsing data… and Forget… had no pointer route at full width (OD-22) | Spec change (025-FR-023) |
| A-35 | Focus emulation while pick mode is on, so a hover menu survives the click on Pick element (OD-20) | A menu that closes on blur could not be picked by pointer alone | Spec change (025-FR-025, 025-FR-028) |
| A-36 | Pick notes *Note – page moved* (a click the guard dropped), *Note – right-click off* and *Note – element gone*; the send notice's actions are never covered by a pick-row tooltip, and its timer pauses while one is open | Silent no-ops read as broken clicks; a tooltip could block the notice's buttons | Spec change (025-FR-027, 025-FR-047, 025-FR-048, 025-FR-060) |
| A-37 | The dialog's typed text is kept for a tab and restored on return when the reviewer clicks another editor tab | A stray tab click lost the text | Spec change (025-FR-052) |

## Decisions

The owner answered every open decision on 2026-11-01 (11:38, and OD-16 later the same day). Screens cite them as "Owner decision OD-n" or "Owner decision SPEC-n" in captions. None reopens D1–D15 or the spec's dated decisions. OD-9 is an item in the run lead's queue, recorded here for completeness; OD-10 (picker alignment) is closed by OD-14.

| # | Decision, in plain words | Owner answer | Date |
| --- | --- | --- | --- |
| OD-1 | How Erfana knows which part of a long host (the site's real name) must never be cut | Ship a public-suffix list (the list browsers use to know "example.co.uk" is one site) in the main process; remove whole labels from the front, never into the site's name | 2026-11-01 |
| OD-2 | Extend the decided Focus card's two-colour outline exception to the pick outline | Yes. **Owner-approved; the Focus card's Exceptions record it (2026-11-01)** | 2026-11-01 |
| OD-3 | Where the Picking banner goes so the page never jumps | A permanent second row (the pick row), which also holds the send notice and target | 2026-11-01 |
| OD-4 | Page full screen: whole window or page area | The page area; the address bar stays | 2026-11-01 |
| OD-5 | Is Proceed anyway behind "Details" on the certificate warning | **Not the recommendation: Proceed anyway is shown at once**, no Details gate. It stays visually quieter than Back to safety (text-style button, M-43), with the 7-day explanation visible beside it | 2026-11-01 |
| OD-6 | Site prompt input guard | Yes – about 500 ms, re-armed after every appearance and content change, including a queue advance, with a visible blocked look and a gap between queued requests | 2026-11-01 |
| OD-7 | "Phone width (390 px)" or "390px" | "390px" – the spec label changes | 2026-11-01 |
| OD-8 | Where a page's alert, confirm and prompt appear | In the strip, with the fixed quote-box look (M-02) | 2026-11-01 |
| OD-9 | Spec-fixed sentences in banners, notices and toasts carry no full stop (CF-2). Add one on screen? | **Yes: the full stop is added on screen to spec-fixed banner and toast sentences, and tests match the text without it.** Voice rule 10 updated. Affected, found by searching the spec: 025-FR-053, 025-AC-067, 025-UC-001 A5 ("The page reloaded – …", "The page changed – …"); 025-FR-061, 025-AC-077, 025-AC-054, 025-UC-001 E2 ("No agent is running in …"); 025-FR-018, 025-AC-018 ("Logins were reset because the keyring changed"); 025-FR-058, 025-AC-075 ("Changes may not be saved"); 025-FR-020 ("This site wants to download several files"); 025-FR-056 ("This page is not responding"). Not affected: one-line status clauses – the pick banner, "Sent {action} to {terminal name}", "Pop-up blocked" | 2026-11-01 |
| CF-9 | "Open in default browser" in the HTML preview and project tree | Rename both to "Open in system browser" in a follow-up | 2026-11-01 |
| OD-11 | First click on the page after focus was elsewhere, with pick mode on | Only returns focus; picks nothing | 2026-11-01 |
| OD-12 | Show where a link goes before the click | Yes – link address in the pick row while hovered or focused; link host as the right-click menu's header | 2026-11-01 |
| OD-13 | F6 / Shift+F6 between the navigation row, pick row, prompts and page | Yes; the page stays out of the Tab order, so Tab from the last toolbar control still leaves the tab | 2026-11-01 |
| OD-14 | Align the browser picker with the shipped comment picker (closes OD-10) | The lime outer frame is kept; Alt+↑ / Alt+↓ are accepted as refinement aliases in browser pick mode; **one banner pattern shared with comments** (the Element picker card draws it) | 2026-11-01 |
| OD-15 | The "Additions beyond the spec" table | Approved as a group; spec-change rows go through the follow-ups below | 2026-11-01 |
| SPEC-1 | `--color-accent` in 025-FR-034 | `--color-accent-primary` | 2026-11-01 |
| SPEC-2 | One banner variant per routing state and the optional "↑ ↓ parent and child" clause | Yes, per the deck's *Pick banner* rows | 2026-11-01 |
| SPEC-3 | Sign-in frame wording | Asker first: "{frame host}, inside {top host}, asks you to sign in" | 2026-11-01 |
| SPEC-4 | Back to safety only on HSTS and preloaded hosts | **Not the recommendation: Proceed anyway stays on every host**, HSTS and preloaded included. No HSTS-only frame or rule | 2026-11-01 |
| SPEC-5 | One word for a one-time grant | "Allow once" in both places | 2026-11-01 |
| SPEC-6 | 025-FR-030 Tab cycle, ellipsis on labels, no-terminal guard form | Banner button and target button after the four actions, then wrap; "Ask…", "Change…", "Prompt…"; *Guard – no terminal* as in the deck | 2026-11-01 |
| SPEC-7 | Panel acts on Enter or Space only on a fresh keydown | Yes | 2026-11-01 |
| OD-16 | At 360px in pick mode the pick row has about 18px between "Picking – Esc to stop" and the target, and the shortest short form of the badge tooltip needs about 84px with its padding. What happens? | **Owner decision OD-16 (2026-11-01): hide the tooltip when there is no room.** The full text stays in the accessible description and the badge icon (shape plus colour) remains. Not chosen: (a) shrink the terminal name to "…" while the tooltip shows; (b) allow the tooltip beside the field below 380px | 2026-11-01 |
| OD-17 | F6 with the instruction dialog open (alignment review, D-A) | **Drop the 2 s note.** F6 does nothing; the status slot keeps "Esc closes the dialog" (since the mouse-first revision: "Esc or Cancel closes the dialog"). No re-announcement either: screen-reader support for pick mode is out of scope (spec 025 § Out of scope, #440), as the spec checker found on 2026-11-01 | 2026-11-01 |
| OD-18 | The dialog's target line at narrow widths, where the toolbar's target has left the row (alignment review, D-B) | **The target line becomes a menu button, as in the panel footer**, so the target can be changed before a send at every width | 2026-11-01 |
| Scope (mouse only) | What "mouse only" means for this design | **"Mouse only" does not mean there is no keyboard.** Selecting elements and triggering prompts must be fully doable with the mouse, so a user who prefers clicking never needs a key; typing the instruction text is fine. Key-only paths outside that workflow (pointer lock, full-screen exit, find, zoom, Enter in the address bar) stay as they are | 2026-11-01 |
| OD-19 | P1 – pointer lock needs only Esc to release (mouse-only review, finding X3) | **Out of scope** – the keyboard is there; Esc stays the exit | 2026-11-01 |
| OD-20 | P2 – menus that close when the page loses focus cannot be picked by pointer (finding X6) | **Keep the page focused while picking** (DevTools "Emulate a focused page"; CDP `Emulation.setFocusEmulationEnabled`), so a hover menu stays open through the click on Pick element | 2026-11-01 |
| OD-21 | P3 – right-click **Pick this element** has no pointer confirmation (finding Y7) | **It picks the right-clicked element at once and opens the panel** (DevTools right-click **Inspect**); Shift+F10 keeps outline-then-Enter | 2026-11-01 |
| OD-22 | P4 – More is hidden at full width and takes Clear browsing data… and Forget… with it (finding Y4) | **More is always shown** | 2026-11-01 |

## Spec follow-ups

These answers changed spec 025's text. **Every row below is applied in spec v0.10.0 (2026-11-01)**, except the three rows marked *applied in v0.11.0* (A-6, A-9, A-27), which the alignment review of 2026-11-01 moved from "routine call" to "spec change". The table stays as the trace from each answer to the spec clause that carries it.

| Item | Spec change |
| --- | --- |
| SPEC-1 | 025-FR-034: `--color-accent` becomes `--color-accent-primary` |
| SPEC-2 | 025-FR-065: one banner string per routing state (page focus, toolbar focus, panel, dialog, focus elsewhere) and the optional third clause, per the deck |
| SPEC-3 | 025-FR-022: the frame sign-in title uses the asker-first grammar |
| SPEC-5 | 025-FR-019: "Allow this time" becomes "Allow once" |
| SPEC-6 | 025-FR-030 and 025-AC-030: Tab-cycle position of the banner and target buttons; ellipsis on Ask, Change, Prompt. 025-FR-061 names the no-terminal guard form and its **Open terminal** button (A-5), which also changes 025-AC-054 E2 ("offers **Choose terminal**"), 025-UC-001 E2 and 025-AC-077 (R2-M17) |
| A-30 | 025-FR-061 (the toolbar shows "→ {terminal name} · {foreground process}") and 025-AC-077 (the toolbar shows the chosen terminal): the terminal name truncates to a minimum of 8 characters, and below 380px down to "…", with the full name in the accessible name and the target menu; the process is never cut |
| A-12 | 025-FR-047 and 025-FR-048: page clicks ignored for about 500 ms after a row inserts or leaves under the pointer; in pick mode the hit-test re-runs before a click confirms (025-FR-053) |
| A-14 | 025-FR-011 ("at the requested size … limited to the screen's work area"): add "and at least 320px wide", and ignore requested positions over the opener's chrome; 025-AC-011 ("matches the request within 1 px") gains the same limit |
| SPEC-7 | 025-FR-030: the fresh-keydown rule |
| OD-6 | 025-FR-019 (and the other strip rows): the input guard, re-armed on every change, with its visible look and queue gap |
| OD-7 | 025-FR-012 and the names table row (025-FR-033): "390 px" and "768 px" become "390px" and "768px"; also 025-AC-012, 025-AC-058 ("records 390 px") and 025-UC-005 steps 1, 2 and 4 (R2-M17) |
| OD-9 | 025-FR-018, 020, 053, 056, 058 and 061, with the ACs and use cases listed in § Decisions: a note that these sentences show with a full stop and tests match the text without it |
| OD-11 | 025-FR-048 (pick-mode routing) and 025-FR-053 (a click confirms a pick): the first click after focus returns to the tab only focuses |
| OD-13 | 025-FR-047: F6 and Shift+F6 join the reserved keys; 025-FR-049 (F6 closes the panel like a toolbar click) and 025-FR-050 (F6 does nothing in the dialog) |
| OD-14 | 025-FR-048: Alt+↑ / Alt+↓ as aliases; 025-FR-065: the banner follows the pattern shared with comments |
| A-28 | 025-FR-051 (and 025-AC-065): Esc on any other button in the navigation row or the pick row, unless one of its menus is open, returns focus to the page, in Browse and in pick mode (the address bar and the find bar keep their own Esc) |
| A-6 | 025-FR-050 and 025-FR-031: ← Actions leaves the dialog back to the menu on the held capture, freeze kept – *applied in v0.11.0* |
| A-9 | 025-FR-025 and 025-FR-028: Pick element and Ctrl/Cmd+E blocked on an empty tab and on Erfana pages, with the 4 s reason note; the pick notes of 025-AC-025 and 025-AC-027 – *applied in v0.11.0* |
| A-27 | 025-FR-021: the Proceed anyway input guard (about 500 ms, blocked look, fresh press only) – *applied in v0.11.0* |

### Mouse-first revision – spec follow-ups (2026-11-01)

The design above was revised for pointer-complete pick and prompt. These rows are **applied in spec v0.12.0** (025-NFR-011, 025-AC-083 and the FR and AC changes listed in the plan `.local/panel/spec-025-mouse-improved.md`); design-only copy (the × button's name, the Pick tooltip's second line, the right-click note) stays in this note.

| Item | Spec change |
| --- | --- |
| Scope | New NFR "pointer-complete pick and prompt" with its walk-through acceptance; "Pick and prompt by mouse alone" in the overview's In scope |
| A-31 | 025-FR-027, 025-FR-030, 025-AC-027, 025-AC-030: name **Parent element** / **Child element** and the clickable ancestor path |
| A-32 | 025-FR-030, 025-FR-049: the × close (name "Close – nothing is sent"); a pointer press counts only if it began after the panel opened |
| A-33, OD-21 | 025-FR-057, 025-AC-074: pointer right-click **Pick this element** picks at once |
| A-34, OD-22 | 025-FR-023: More always shown; Clear browsing data… and Forget… live there |
| A-35, OD-20 | 025-FR-025, 025-FR-028, 025-AC-028: focus emulation while pick mode is on; UC-004 A2 |
| A-36 | 025-FR-027 (*Note – element gone*), 025-FR-047 / 025-FR-048 (*Note – page moved*, *Note – right-click off*), 025-FR-060 (tooltips and the notice's timer) |
| A-37 | 025-FR-052: the dialog's text kept per tab |
| Copy | 025-FR-065 and 025-AC-078, 025-AC-081 (banners), 025-FR-063 (empty-tab hint): the strings in the deck; 025-FR-031, 025-FR-050, 025-AC-031 name **Send** |

## Developer handoff

Build nothing from a surface until the owner approves its screen (025-FR-043). Departures from a card need a `deviates:` marker and a row in the card's Exceptions.

| Surface | Component CSS | Tokens (beyond the card's own) |
| --- | --- | --- |
| Editor tab, capture chip | `tabs.css`, `badge.css` | `--tab-height`, `--icon-size-sm` |
| Navigation, pick and find rows | `toolbar.css`, `button.css`, `badge.css`, `tooltip.css` | `--toolbar-tool-height` (proposed; `--input-height-sm` until it lands), gap `--space-2`, `--color-bg-primary`, `--color-border-default`, `--color-bg-selected` and `--color-brand-lime` for pressed Pick element |
| Address bar, popup strip | `form.css`, Origin field card CSS | `--font-mono`, `--color-text-emphasis` (registrable domain), `--color-text-tertiary` (subdomains, scheme, port, path), `--color-warning`, `--color-error` |
| Status slot | `toolbar.css` | `--text-base`, `--color-text-primary` (send glyph), `--color-text-tertiary`, `--space-6` before actions |
| Menus | `menu.css` | `--color-bg-elevated`, `--color-border-subtle`, `--shadow-md`, `--z-context-menu` |
| Page frame | browser component CSS | `--space-1`, `--border-width-thick`, `--color-border-focus`, `--color-accent-secondary` (solid, dashed in Out); forced colours Highlight solid, dashed, dotted |
| Pick overlay on the still image, label | Element picker card CSS | `--color-accent-primary`, `--color-brand-black`, `--color-brand-white`, `--color-text-primary`, `--font-mono`, `--text-sm`, `--border-width`, `--border-width-thick`; forced colours Canvas, Highlight, CanvasText |
| Panel, dialog, sheet | `dialog.css` (anchored, sheet, clear layer), `button.css` (action buttons, stepper), `form.css`, `feedback.css`, `badge.css` (neutral chip) | `--comments-window-width`, `--comments-window-max-width`, `--z-dialog`, `--opacity-disabled` for the inert rows |
| Strip rows | `feedback.css`, `form.css`, `button.css`, Site prompts card CSS | `--color-bg-secondary` (strip surface), `--border-width-thick` neutral leading rule, severity tokens |
| Erfana pages | `states.css`, `button.css` (`--text` for Proceed anyway) | `--color-error` on the certificate page only |
| Toasts | `feedback.css` | Existing slide-clear placement |
| Clear, Forget | `dialog.css`, `form.css`, `button.css` | `--color-overlay-dialog` |

**ADRs and follow-ups**

- **ADR 0011**: still image for every popup over the page; the reserved pick row; the frame gutter; strip rows pushing the view in one step; the page-click guard after a shift; the first click after Out only focusing (OD-11); page-dialog focus rules (H-06); popup minimum size and position (M-05); full screen confined to the page area and whether it can start in pick mode (M-18); `inert` zones while the dialog is open.
- **ADR 0007**: the engine label scales with Erfana's zoom, or the status echo with a recorded deviation (M-34); label placement rules; the crosshair.
- **ADR 0008**: "Page paused" appears when the freeze takes effect.
- **New ADR if OD-1 is the list**: the public-suffix list's source, home and update duty.
- **Navigation state**: pending vs committed URL per Security rule 1 (H-03) is a main-process rule, tested with a page-started navigation that never commits.
- **Spoofing review** (05-notes): this note covers the UI side; whole-script confusables and URL formatting remain for the code-level review.
- **Indexes** (outside this note's scope): `docs/designs/README.md` folder table and the design-system README layout and proposed-CSS lists need the browser folder and the three cards (VS-23).
- **Spec registry**: done – `specs/registry.json` `documents.designs` links the files in `docs/designs/browser/` and, from spec v0.11.0, the three cards (origin-field, picker, site-prompts) (025-AC-043, TR-R8-2).

## Design review

Round 1 – 2026-11-01, six reviewers, 135 findings (18 high, 64 medium, 53 low); merged 13 / 49 / 30; see the revision notes below.

Round 2 – 2026-11-01, same six reviewers: 16 of 18 round-1 highs fixed, 2 partly; 4 new highs, 24 new mediums, 10 new lows; 5 open highs after merging.

Round 3 – 2026-11-01, confirm round: round-2 highs R2-H1, H3, H4, H5 fixed; R2-H2 remainder open (fold order) and 5 mediums – fixed in this revision.

Owner approval – 2026-11-01: the owner approved the six screens as a group (025-FR-043). Cards and screens keep their `proposed` status; nothing is marked decided by this approval.

### Revision notes (round 9 – mouse-first)

Round 9 – 2026-11-01: pick and prompt made fully doable by pointer (owner scope and decisions OD-19 to OD-22). Source: `.local/panel/mouse-025/merged.md` (uncommitted). Reference: Chrome DevTools' element picker.

| Change | Findings |
| --- | --- |
| More always shown (`browser.css`, focus order, tiers, captions); fold steps still move tools into More | P4 / OD-22, Y4 |
| Panel and sheet: × close, ancestor path beside the stepper; frames *click outside*, *toolbar click*, 360px sheet; the round-1 "no breadcrumb" rule superseded | Y8, DevTools |
| Banners lead with the click: page focus, panel ("Esc or click outside"), dialog ("Esc or Cancel"), empty-tab hint | Y9 |
| *Pick tooltip – off* line 2 teaches that menus stay open; frame *Hover menu opened while picking, item clicked* | Y5, P2 / OD-20 |
| Frame *Pick this element from a right-click – picked at once, panel open* | Y7, P3 / OD-21 |
| Notes *Page moved*, *Element gone*, *Right-click off* (the first and third drawn, the second described) | Y10, Y6, Z4 |
| Pick-row tooltips never cover the send notice's actions; timer paused while one is open | Y11 |
| Guard blocked look wins over hover, `cursor: not-allowed` – already `button.css`'s `aria-disabled` rule; recorded, no new CSS | Z6 |
| Dialog text kept when another editor tab is clicked | Z7 |
| Not applied (outside the pick-and-prompt workflow, owner scope): pointer lock, full-screen exit, find, zoom, Go row, mouse side buttons, sideways scroll | X3 / OD-19, Y1, Y2, Y3, X2, Z3, Z5 |

### Revision notes (round 8)

Round 8 – 2026-11-01: small fixes from the TR and SEC reports.

| Change | Findings |
| --- | --- |
| Status slot priority item 1: the width preset (already icon-only while picking) folds into More (Page width) | TR-R8-1 |
| Developer handoff: link the browser design files in `specs/registry.json` documents.designs (025-AC-043) – spec owner, outside the design run | TR-R8-2 |
| Screens table pop-up row: badge hovered, tooltip in the strip band; pop-up short form always used, on one line; "after the address" in the round-7 log | Round-8 lows (TR, SEC) |

### Revision notes (round 7)

Round 7 – 2026-11-01, confirm round: 0 open highs; small mediums – note items fixed in this revision.

| Change | Findings |
| --- | --- |
| Badge tooltip in a pop-up window: inside the origin strip's band, beside the badge after the address, short form only; not shown when it does not fit (deck row, Layout rules) | R7-M1 (SEC-R7-1) |
| Width preset label icon-only below 700px and at any width while picking or while the send notice shows; out of room it folds into More (§ Tiers, width preset row) | R7-M2 (TR-R7-1) |
| Send notice below 800px: width preset folds into More, target keeps 8 characters (below 380px down to "…") | R7-M3 (TR-R7-2) |
| Esc on a hover-only Badge tooltip with focus elsewhere routes and hides it in one press (Cancel table, deck row) | R7-M5 (AX-R7-1) |
| Timed notes move the width preset only below 700px; one width figure, about 84px with padding, in the deck row, OD-16 and the round-6 log | R7 lows |
| Short form measured with the user's text spacing; one needing a third line counts as not fitting and does not show | R7-M4 follow-on (SC 1.4.12) |
| OD-16 answered by the owner (2026-11-01): hide the tooltip when there is no room – the drawn rule stands; Decisions intro restored; six screens approved as a group, recorded under Design review | Owner, 2026-11-01 |
| Screen- and card-only, for the screen designers | R7-M4, the pop-up hover frame, `browser.css` and Tooltip card wording |

### Revision notes (round 6)

Round 6 – 2026-11-01, confirm round: 0 open highs; four mediums – note items fixed in this revision.

| Change | Findings |
| --- | --- |
| Badge tooltip stays inside the pick-row band, never over "Picking – …", the target, the field, More, the tab strip or the live page; two lines at most with *Badge tooltip – short*; two-step Esc, hidden until the field regains focus | R6-M1 (SEC-R6-1, AX-R6-1) |
| More shown when a tool has folded or while Page width is in it; More counts in the fold order | R6-M2 (VS-R6-1, AX-R6-3) |
| Page width is a `role="group"` labelled by its heading; Phone and Tablet carry the DevTools reason line | R6-M3 (AX-R6-2) |
| Non-folding icon-only list completed (width preset below 700px; Pick element, pop-up chip, in-use chip below 520px); pop-up chip dropped from step 3; chip and deck rows agree | R6-M4 (TR-R6-1) |
| 400px pick-mode example needs fold steps 1 and 2 with More counted; send notice below 800px and timed notes also move the width preset into More | Wave 1 and wave 2a alignment |
| Badge tooltip with no room in pick mode at 360px (about 18px free, about 84px needed): not shown, full text in the accessible description, icon remains; OD-16 raised; short form "Not secure – you chose to proceed" kept | Wave 1 measurement |
| Screen- and card-only, for the screen designers | Frame redraws for R6-M1 and R6-M2, `browser.css` header and comments, Tooltip card row, screen Exceptions row (R6 lows) |

### Revision notes (round 5)

Round 5 – 2026-11-01, confirm round, five reviewers: R4-H1 fixed, 0 open highs; mediums only – note items fixed in this revision.

| Change | Findings |
| --- | --- |
| Row padding below 700px stated as a non-folding tier change; tier names carry only padding, icon-only labels, the short ⌘E clause and the placeholder | R5-M1 (TR-R5-1, VS-R5-1) |
| Step-8 cut done by the formatter slicing the string and writing "…"; never CSS `direction` (bidi scrambles digit-led domains); Security rule 2 and A-29 | R5-M3 (SEC-R5-1) |
| One Badge tooltip position everywhere (first form) | R5-M4 |
| Badge tooltip position aligned with wave 1's 360px redraw: opens below the field – over the pick row, or over the still image when one is shown; beside the field inside the navigation row only when there is room and it covers neither the field nor More; never over the tab strip or the live page | R5-M4, run lead's call |
| Stop loading has no key; no hint, no `aria-keyshortcuts` | R5-M5 (AX-R5-1) |
| *Page width* radio group in More while the width preset is off the row (picking below 520px, Out below 700px) | R5-M6 (AX-R5-2) |
| Badge tooltip on the field's keyboard focus while icon-only; Esc keeps its field meaning (Cancel table) | R5-M7 (AX-R5-3) |
| A-30 and a 025-FR-061 / 025-AC-077 spec follow-up for the below-380px terminal name | R5-M8 (TR-R5-2) |
| Screen- and card-only, for the screen designers | R5-M2, frame redraws for R5-M1, M3, M4, M6, M7, the picker card and prompt-actions citations (R5-M8), R5 lows |

### Revision notes (round 4)

Round 4 – 2026-11-01, confirm round, five reviewers (IX had nothing open): R3-H1 fixed (More whole everywhere); one new high and five mediums – note items fixed in this revision.

| Change | Findings |
| --- | --- |
| Fold step 8: last-resort start cut behind a leading `…`, keeping the domain's end, TLD and port; field never clipped at its end; tab label likewise; Security rule 2 and A-29 | R4-H1 (SEC-R4-1) |
| One fold order at every width; tier names carry no rules | R4-M1 (TR-R4-1, AX-R4-4, VS-R4-1) |
| Two-step Esc only for a keyboard-focus tooltip; hover tooltips route and hide in one press | R4-M3 (AX-R4-2) |
| Focus moves to More when the focused tool folds; More menu lists folded Back, Forward, Reload / Stop loading with reasons and `aria-keyshortcuts` | R4-M4 (AX-R4-3) |
| `circle-alert` for the remote-`http` badge, distinct from `triangle-alert`; *Badge tooltip* deck row | R4-M5 (SEC-R4-2) |
| Toolbar card row for the `--space-2` (4px) tool gap: note claim unchanged, wave 1 adds the card row | R4-M6 (VS-R4-2) |
| Tab-order list: More hidden when everything fits | R4-L (VS) |
| Below 380px the terminal name may truncate to "…" (full name in the accessible name and target menu, process never cut); the width preset folds into More first while picking | Wave 1's 360px fix |
| Screen- and card-only, for the screen designers | R4-M2, the other R4 lows, the 360px long-domain frame, origin-field.css and browser.css comments |

### Revision notes (round 3)

| Change | Findings |
| --- | --- |
| One fold order for the navigation row in § States › Tiers; More never shrinks; the badge-word exception widened to any tier after steps 3–5; "Back, Forward and Reload never leave the row" replaced | R3-H1 (VS-R3-1, TR-R3-1) |
| Pick-row tooltips open after the banner's first clause; first Esc hides a visible tooltip, the next routes (Anatomy, Cancel table) | R3-M1 (AX-R3-1) |
| Shell and no-terminal pre-warn rewritten: leaving closes the pick; Ask…, Change… and Prompt… keep it | R3-M2 (CT-R3-1) |
| "Esc on any toolbar control returns focus to the page" added to Additions (A-28) and Spec follow-ups (025-FR-051) | TR-R2-7 |
| Screen- and card-only, for the screen designers | R3-M3, R3-M4, R3-M5, the R3 lows on picking.html, the send-notice frame and the `browser.css` comment |

### Revision notes (round 2)

| Change | Findings |
| --- | --- |
| Panel state: rows live at full strength, not `inert`; dialog state only: `inert`, icons dimmed, origin text and rings never dimmed (Layout rules, Roles, key-routing table) | R2-H1 (IX-R2-1, AX-R2-4, VS-R2-2) |
| Focus after a strip row goes: the next row as a group or its non-granting control, never a grant; guard re-armed on restoration | R2-H4 (AX-R2-2, CT-R2-6) |
| Panel frame line confirmed as "{frame host}, inside {top host}"; pick-row tooltips placed inside the pick row's band and shown on keyboard focus | R2-H5 (CT-1, AX-3, AX-R2-3) |
| Breadcrumb removed, stepper only; action row order and end-note place stated for the frames | R2-M1 |
| Deck rows added: *Chip – still image*, *More about this error*, *Link destination* with hidden "Link to", *Link – non-web*, link header, camera "remembered" variant | R2-M2 |
| OD-9 written out with the owner's answer and the affected FR, AC and UC IDs; voice rule 10 matches | R2-M3 |
| Pre-warn text without "send again" | R2-M4 |
| Certificate caution text per code, "proceed" not "continue" | R2-M6, CT-R2-9 |
| Page dialog answers "Decline · Confirm" (025-FR-058 does not fix them) | R2-M8 |
| Formatter strips userinfo; non-web schemes as scheme word plus description | R2-M9 |
| Interstitials commit the failed URL; tab label follows rule 1 | R2-M10, R2-M12 |
| Proceed anyway takes the input guard and fresh-press rule (A-27) | R2-M11 |
| Honest pre-warn: the pick closes when you leave, Prompt… keeps it; return banner | R2-M13 |
| Focus to the banner's button after a guard hit | R2-M14 |
| F6 in the panel (closes it) and in the dialog (status note) | R2-M15 |
| A-5, A-12, A-14 reclassified as spec changes; follow-ups list every FR, AC and UC line found by searching the spec | R2-M17 |
| Lime's remaining meanings recorded | R2-M19 |
| Lows: "if approved" wording removed; one F6 announcement sentence; send notice "displaced"; Out banner over a dialog; tab tooltip line 1 through the formatter; Screens table lists what must be drawn, new frames marked ‡ | IX-R2-5, AX-R2-8, AX-R2-7, CT-R2-8, SEC-R2-5, TR-R2-6, TR-R2-7 |
| Screen- and card-only, for the screen designers | R2-H2, R2-H3, R2-M5 (deck already right), R2-M7 (draw the link header), R2-M16, R2-M18 |

### Revision notes (round 1)

| Change | Findings |
| --- | --- |
| Status line: screens exist; this note is the single source | VS-23 |
| One origin formatter for every Erfana-written origin, tab label included; domain `nowrap`; path floor; scheme and port at every tier; `….`; subdomains dimmed; badge word to the minimal tier | H-01 (SEC-3, VS-1, VS-13, SEC-17, SEC-15, VS-14, SEC-16) |
| Tooltip placement: never over the address bar or the focused row; editor-tab tooltip beside the tab with a "Title:" line | H-02 (SEC-1, SEC-7, VS-15, AX-3) |
| Pending URL only for reviewer-started loads | H-03 |
| One provenance grammar, asker first; SPEC-3 | H-04 (SEC-4, CT-1, TR-10) |
| Input guard re-armed on every change with a visible look and a queue gap; page-click guard after layout shift; OD-6 updated | H-05 (SEC-5, IX-14, AX-19) |
| Page dialogs take focus only in the active tab with page focus; waiting mark | H-06 |
| Out state: dashed lime frame, banner without keys, first click only focuses (OD-11) | H-07 (IX-1, AX-4, IX-3) |
| Panel: four buttons, not menu rows; stepper chosen over a breadcrumb (breadcrumb removed from the screens in round 2, R2-M1) (reasons in § Flows); ↑ ↓ taught in banner, tooltip and footer; visible end notes | H-08 (IX-2, AX-6, IX-4, IX-5, IX-6) |
| Status slot: one line, priority list, first clause protected, text-spacing safe | H-09 (AX-1, VS-2) |
| Focus-restoration table for every surface that goes | H-10 |
| Popup anatomy: find row and zoom chip | H-11 |
| Send-notice actions at every width; fallback named in the announcement; Open last capture in More and palette | H-12, IX-23 |
| Keyring notice: shown until dismissed, never again after | H-13 |
| Banner one true clause per state; "Stop picking" tooltip; SPEC-2 | M-01 (IX-13, CT-2, TR-5, CT-3, AX-12) |
| Page dialog quote-box look, labels, field note, focusable quote | M-02, AX-16 |
| Chrome-side cue while an Erfana surface is over the still image | M-03 |
| In-use chip never leaves; capture chip | M-04 |
| Popup minimum size and position | M-05 |
| Badge wording per certificate state; Details per code; http sign-in warning; remembered answers; leave-page origin | M-08, M-09, M-10, M-11, M-13 |
| No-terminal wording and Open terminal | M-14, CT-17 |
| Copy deck as the single source; States, Roles and Announcements reference it | M-15 (CT-11, TR-21, AX-13, IX-21, CT-15) |
| Pick element blocked only where nothing can be picked | M-17 |
| Full-screen-while-picking frame dropped unless reachable | M-18 |
| Caption and keyboard rules: Tab does not leave the page in pick mode; Esc on any toolbar control returns to the page | M-19, IX-20 |
| First action keeps focus with a banner; SPEC-6 | M-20, M-21 |
| Entry-point frames | M-22 |
| Additions register; OD-15 | M-23, TR-12, TR-23, TR-24 |
| Nothing-outlined note | M-24 |
| ← Actions | M-25 |
| Fresh-keydown rule; SPEC-7 | M-26 |
| Target as a menu button in the panel; pre-warn; in-place swap; banner rewrite | M-27, M-28, M-29 |
| F6 pane cycling; OD-13 | M-30 |
| Busy keeps the ring; chip ring scoped; forced-colours outline and pressed toggle; label zoom requirement; Shift+F10 pick route | M-31, M-32, M-33, M-34, M-35 |
| Sheet inside the page area; tool gap; keyboard-opened menu ring; strip surface step; scoped modality; Back/Forward reason; narrow-tier calls recorded with a short ⌘E form | M-36, M-37, M-40, M-44, M-46, M-47, M-48, IX-19 |
| Lime only for pick mode and selected; Proceed anyway text-style | M-42, M-43 |
| Picker alignment with comments; OD-10 folded in | M-16, OD-14 |
| Lows in note text | IX-18, IX-20, IX-21, IX-22, CT-13, CT-14, CT-16, CT-17, CT-18, CT-19, CT-20, CT-21, CT-22, CT-23, TR-13, TR-14, TR-15, TR-19, TR-20, TR-25, TR-26, SEC-18, VS-16, VS-18, VS-19, VS-20, VS-21, VS-25, VS-26 |
| Owner decisions recorded: § Open decisions became § Decisions (owner answer, date) and § Spec follow-ups; OD-5 and SPEC-4 answered against the recommendation, so Proceed anyway shows at once on every host and the HSTS frame is gone; OD-7 width labels to "390px"; OD-14 shares one banner pattern with comments; A-24 withdrawn | Owner, 2026-11-01 |
| Declined – no send-time notice about the AI provider (owner decision D5) | M-49 (SEC-10) |
| Screen- and card-only items, not note text | M-38, M-39 (central stand-ins noted), M-41, TR-16, TR-17, TR-18, TR-22, VS-17, VS-22, VS-24 |

## Differences in the build

Where the shipped build differs from this note. Each row is a difference to settle – by changing the build or this note – not a decision.

| Build step | Surface | This note says | The build does | Why |
|---|---|---|---|---|
| Commit 19 | Page right-click menu, More, target menu, address suggestions | The surface draws over a still image of the page | Built as the note says: the page's picture is taken first and the surface opens over it. When no picture can be taken (no live page, capture refused), the surface opens over Erfana's background, as the native-view guard hides the page for any app overlay | – |
| Commit 18 | Pop-up blocked chip | The chip brings the row back while the row is kept | The chip shows only while the row is in the strip; once dismissed, main forgets the blocked open, so there is nothing for the chip to bring back | Main keeps no dismissed row to return to |
| Commit 18 | Keyring notices | – | The weak-protection and keyring-reset notices are `keyring` strip rows with **Dismiss** only; "remembered for this session" wording on a permission row is the build's own | The note has no row copy for them |
| Commit 18 | Page dialogs | `pageDialog` rows | Rendered generically (Confirm / Close / Decline); main emits none yet | Main-side emitter pending |
| Commit 18 | Sign-in rejection line | – | No live region: both fields carry `aria-invalid` and point at the line, and the strip's polite announcer says it when the row arrives (Form card, decided) | `role="alert"` on a line that appears with its text is unreliable (Feedback card) |
| Commit 19 | Send notice, target menu | **Open capture** opens the context file in preview | Opens the context file in an editor tab in its default mode | The editor panel is at its line-count baseline; a preview-mode option was not added |
| Commit 19 | Target chooser (025-FR-061) | A list of the project's terminals, the current one marked (`menuitemradio`) | One entry – Erfana's one terminal panel, named "Terminal" – as a plain menu item | Erfana has one terminal panel; the shared menu has no radio items |
| Commit 19 | Agent deny-rule offer (S-21) | Offered once per project | Offered once per project per app session (kept in memory) | No persisted flag yet |
| Commit 19 | Pick outline on the still image | Two-tone outline, 3:1 against the page | Two-tone outline drawn by Erfana over the still image; the live-page outline is the engine's one-colour outline, which falls to about 2.2:1 on a white page | The engine draws one colour (owner decision Q2: outline only) |
| Commit 20 | Prompt-actions panel (025-FR-027) | The card shows the element's source file:line | The source line shows only when a source hint resolves to a real file in the project – a source-location attribute on the element, or React's JSX source where React still gives one; React 19 dev builds give a bundle stack, not a file:line, so no source line shows for them | Resolving React 19's stack needs source maps, which needs a new dependency – an owner decision |
| Commit 20 | Prompt-actions panel (025-FR-027) | The card shows the element's selector | The card shows the element's name, text and ancestor path; the selector stays in the context file | The panel's width is spent on the text |
| Commit 20 | Pick row width preset | Page width moves to More only while it is off the row | More keeps **Page width** at every width, as well as the row button | One menu definition for both places; the row button hides first when the row runs out of room |
| Commit 20 | HTML preview, Open in browser tab | The tool's name gives the file's project-relative path | The tool's name gives the file name ("Open index.html in a browser tab") | The band has only the file path, not the project root |
| Commit 20 | Terminal drop confirmation (S-17) | Ask before dropping text a web page wrote | Every text drop from outside Erfana with a line break or control character asks, whatever app it came from | A drop carries no sign of the page that started it |
| Commit 20 | Strip rows | Rows fold by tier when the strip runs out of room | Still not built – every row shows in the fixed kind order | Neither this note nor the deck defines the tiers' order and break widths |
