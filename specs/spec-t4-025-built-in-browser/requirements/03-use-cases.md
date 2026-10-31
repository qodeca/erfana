# Use cases

## Use case registry

| ID | Title | Actor | Priority |
|----|-------|-------|----------|
| 025-UC-001 | Fix an element found in review | Reviewer | High |
| 025-UC-002 | Open a dev server from a terminal link | Reviewer | High |
| 025-UC-003 | Sign in to a staging site behind basic auth | Reviewer | High |
| 025-UC-004 | Pick a hover-only menu item | Reviewer | Medium |
| 025-UC-005 | Review the mobile layout | Reviewer | Medium |
| 025-UC-006 | Clear the project's browsing data | Reviewer | Low |

"Reviewer" is the primary user of the overview: a person reviewing a CLI agent's web work in Erfana.

---

## 025-UC-001: Fix an element found in review

**Actor:** Reviewer

**Priority:** High

**Description:** The reviewer sees a wrong element on a page and has the agent fix it.

**Preconditions:**
- A project is open and a CLI agent (Claude Code) runs in Erfana's terminal.
- The reviewer opened a browser tab (025-FR-001) and loaded the page from the address bar (025-FR-002).

**Main flow:**
1. The reviewer presses Ctrl/Cmd+E; pick mode starts (025-FR-025).
2. The reviewer moves the mouse; the element under it is outlined with a label (025-FR-026).
3. The reviewer presses Up once to select the parent button instead of its text (025-FR-027) and presses Enter.
4. The prompt-actions menu opens (025-FR-030); the reviewer selects **Fix**.
5. The instruction dialog opens (025-FR-031); the reviewer types "the label is cut off on the right" and presses Ctrl/Cmd+Enter.
6. Erfana writes the screenshot and the context file (025-FR-033, 025-FR-034, 025-FR-036, 025-FR-037, 025-FR-038).
7. Erfana sends the rendered prompt to the terminal and submits it (025-FR-032).
8. The agent reads the context file and screenshot and edits the source.

**Postconditions:**
- The capture files exist in `.erfana/browser/captures/`.
- The menu and dialog are closed, the page runs and pick mode is off (025-FR-032).
- The prompt was submitted to the agent once.

**Alternative flows:**
- A1: At step 4 the reviewer selects **Explain**; no dialog opens and step 6 follows at once.
- A2: The element sits in an iframe; steps 2–7 work the same and the context file records the frame chain (025-FR-029).
- A3: The element is partly off-screen; the screenshot is clipped and the context file says so (025-FR-035).
- A4: The page is a production build; the context file says "source not found" and the send proceeds (025-FR-037).

**Error flows:**
- E1: The reviewer submits an empty instruction; the dialog stays open with an inline error (025-FR-031).
- E2: No terminal is open; the prompt-template path opens one, as for Markdown templates (025-FR-032).
- E3: Writing the capture fails (disk full, permission); no prompt is sent and an error toast names the reason (025-FR-046).

**Traces to:** 025-FR-001, 025-FR-002, 025-FR-025, 025-FR-026, 025-FR-027, 025-FR-029, 025-FR-030, 025-FR-031, 025-FR-032, 025-FR-033, 025-FR-034, 025-FR-035, 025-FR-036, 025-FR-037, 025-FR-038, 025-FR-046

---

## 025-UC-002: Open a dev server from a terminal link

**Actor:** Reviewer

**Priority:** High

**Description:** The agent starts a dev server, which prints its address in the terminal; the reviewer opens it inside Erfana.

**Preconditions:**
- The terminal shows a line such as `Local: http://localhost:5173/`.

**Main flow:**
1. The reviewer clicks the link (025-FR-009).
2. A new browser tab opens in the editor area and loads the address (025-FR-004, 025-FR-005).
3. The tab shows the page title and site icon.
4. The reviewer changes code through the agent and clicks Reload (025-FR-003).

**Postconditions:**
- One new browser tab shows the dev server page.

**Alternative flows:**
- A1: The reviewer Ctrl/Cmd-clicks the link; the address opens in the OS default browser and no tab opens.
- A2: The link is a GitHub URL; a plain click still opens a browser tab.

**Error flows:**
- E1: The dev server is not running yet; the tab shows Chromium's connection error page and Reload works once the server is up.

**Traces to:** 025-FR-003, 025-FR-004, 025-FR-005, 025-FR-009

---

## 025-UC-003: Sign in to a staging site behind basic auth

**Actor:** Reviewer

**Priority:** High

**Description:** The reviewer opens a staging site guarded by HTTP basic auth and a self-signed certificate, signs in once and stays signed in for the project.

**Preconditions:**
- The staging host uses HTTPS with a self-signed certificate and basic auth.

**Main flow:**
1. The reviewer types the staging address in the address bar.
2. The certificate warning page appears; the reviewer selects **Proceed anyway** (025-FR-021).
3. The sign-in box appears; the reviewer enters credentials, ticks **Remember for this project** and selects **Sign in** (025-FR-022).
4. The site's own login page opens a GitHub sign-in popup; the reviewer signs in and the popup reports back (025-FR-011).
5. The reviewer closes Erfana and opens the project again the next day.
6. The reviewer opens the staging address; the page loads signed in, with no warning and no sign-in box (025-FR-015, 025-FR-017).

**Postconditions:**
- The certificate exception, credentials and cookies are stored in the project profile, encrypted where 025-FR-017 and 025-FR-022 require.

**Alternative flows:**
- A1: The reviewer leaves **Remember for this project** unticked; the sign-in box appears again in the next session.

**Error flows:**
- E1: The saved credentials were changed on the server; the sign-in box appears again with an error line (025-FR-022).
- E2: The site uses Google sign-in and Google refuses the browser; the reviewer uses another sign-in method (025-FR-024, overview § Out of scope).
- E3: At step 2 the reviewer selects **Back to safety**; the tab leaves the warning page and nothing is saved (025-FR-021).
- E4: At step 3 the reviewer selects **Cancel**; the tab shows the site's "401 Unauthorized" response and nothing is saved (025-FR-022).

**Traces to:** 025-FR-011, 025-FR-015, 025-FR-017, 025-FR-021, 025-FR-022, 025-FR-024

---

## 025-UC-004: Pick a hover-only menu item

**Actor:** Reviewer

**Priority:** Medium

**Description:** The reviewer picks an item of a dropdown menu that exists only while the mouse hovers.

**Preconditions:**
- Pick mode is off; the page has a hover menu.

**Main flow:**
1. The reviewer hovers the menu so it opens, and hovers the wrong item.
2. The reviewer presses Ctrl/Cmd+E; pick mode starts and the menu stays open (025-FR-025).
3. The reviewer presses Ctrl/Cmd+E again; Erfana freezes the page, picks the item under the mouse and opens the prompt-actions menu (025-FR-028).
4. The reviewer selects **Change text**, types the new label and submits.

**Postconditions:**
- The screenshot shows the open menu with the item outlined; the page resumes after the dialog closes.

**Alternative flows:**
- A1: The reviewer presses Up before choosing an action to select the whole menu (025-FR-027).

**Error flows:**
- E1: The reviewer presses Esc at step 3; the actions menu closes, the page resumes, pick mode is still on (025-FR-030) and nothing is sent.
- E2: The capture cannot be written; no prompt is sent, the dialog stays open with the text and an error toast names the reason (025-FR-046).

**Traces to:** 025-FR-025, 025-FR-026, 025-FR-027, 025-FR-028, 025-FR-030, 025-FR-031, 025-FR-032, 025-FR-033, 025-FR-034, 025-FR-046

---

## 025-UC-005: Review the mobile layout

**Actor:** Reviewer

**Priority:** Medium

**Description:** The reviewer checks a page at phone width and reports a broken element.

**Preconditions:**
- A browser tab shows the page.

**Main flow:**
1. The reviewer selects the **Phone** size preset (025-FR-012).
2. The page renders 390 px wide.
3. The reviewer picks an overflowing element and sends **Change style**.
4. The context file records the 390 px viewport and the **Phone** preset (025-FR-033); the screenshot shows the phone-width page (025-FR-034).

**Postconditions:**
- The context file records the 390 px viewport and the **Phone** preset.

**Alternative flows:**
- A1: The reviewer uses DevTools device mode instead; the context file records preset `none` and the viewport size the page reports (025-FR-033).

**Error flows:**
- E1: The capture cannot be written at step 3; no prompt is sent and an error toast names the reason (025-FR-046).

**Traces to:** 025-FR-012, 025-FR-033, 025-FR-034, 025-FR-046

---

## 025-UC-006: Clear the project's browsing data

**Actor:** Reviewer

**Priority:** Low

**Description:** The reviewer wants to test a first visit with no cookies.

**Preconditions:**
- The project profile holds cookies for a site.

**Main flow:**
1. The reviewer runs **Clear browsing data** (025-FR-023).
2. The reviewer leaves only **Cookies and other site data** ticked and selects **Clear**.
3. Open browser tabs reload; the site shows its signed-out state.

**Postconditions:**
- Cookies for this project are gone; other projects' profiles and this project's other data are unchanged (025-FR-015).

**Alternative flows:**
- A1: The reviewer selects **Cancel**; nothing changes.

**Error flows:**
- E1: A profile file is locked and clearing fails; an error toast names the reason, and data whose checkbox was not ticked stays untouched (025-FR-023).

**Traces to:** 025-FR-015, 025-FR-023
