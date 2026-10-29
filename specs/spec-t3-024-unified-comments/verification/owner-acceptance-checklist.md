# Owner acceptance checklist – one comment experience

Requirement: 024-FR-006 (acceptance 024-AC-007), with the definition-of-done item "the owner's hands-on acceptance test on their own HTML and Markdown files with an agent". Built from [differences-table.md](../design/differences-table.md), [menu-matrix.md](../design/menu-matrix.md), [state-table.md](../design/state-table.md) and [markdown-format.md](../design/markdown-format.md).

**How to use it.** Do each step in the HTML Preview and then in the Markdown Preview (preview-only view), side by side if you like. Tick "Same" when both behave the same, or the difference is one listed as forced in the differences table. Anything else is an **extra difference**: note it in § 7; before merge it is either fixed or added to the differences table as *forced* with its reason. When done, add one row to [recorded-checks.md](recorded-checks.md) with the date, outcome, commit SHA, system and build.

**You need:** one HTML file and one Markdown file of your own, each with a paragraph, a heading, a list of three items with one nested item, a table, a block quote with two paragraphs, a code block and a picture; the Markdown file with frontmatter. A CLI agent in Erfana's terminal for § 6.

## 1. Words and look (differences table, tables 1 and 2)

| # | Check | HTML | Markdown |
|---|---|---|---|
| 1.1 | The Markdown Preview never says "element", "page", "block" (except "code block" and "block quote"), "pin" or a tag name; the HTML Preview says "element" | ☐ | ☐ |
| 1.2 | Window titles: "New comment on {kind}", "Comment on {kind}", "Comments on {kind}" ("element" in HTML) (A-02) | ☐ | ☐ |
| 1.3 | Comment-mode tab: "Comment mode · {target}, line {n} · Esc to leave" once something is outlined (A-03) | ☐ | ☐ |
| 1.4 | First comment ever shows one privacy notice covering both file types; the other preview does not show it again (A-09) | ☐ | ☐ |
| 1.5 | Toolbar: Comment mode toggle and the "7 comments" count, pressed look while on or open; no "Show comment icons" tool; the drawer has "Show comment icons and underlines" | ☐ | ☐ |
| 1.6 | Empty drawer reads "No comments in this file yet. Select text and right-click, or turn on comment mode and click …" (A-08) | ☐ | ☐ |
| 1.7 | The comment mark (fill and bar) looks the same, differs from your selection and from links | ☐ | ☐ |
| 1.8 | Only the forced differences D-01 to D-33 differ – in particular: modal window in HTML, non-modal with edge tab in Markdown (D-01, D-02); selector labels in HTML (D-03); floating label only in HTML (D-05); ghost icon only in Markdown (D-12) | ☐ | ☐ |

## 2. Menus (menu matrix)

Right-click, then repeat with ⇧F10 / Shift+F10 for every row you can reach by keyboard.

| # | Check | HTML | Markdown |
|---|---|---|---|
| 2.1 | Mode off, nothing selected: one step to the window – "Comment on element" / "Comment on {kind}" (M-01, M-11) | ☐ | ☐ |
| 2.2 | Mode off, words selected: "Comment on selection", "Comment on the whole {kind}" (M-02, M-12) | ☐ | ☐ |
| 2.3 | Mode on, nothing selected: "Add comment" (M-03, M-13) | ☐ | ☐ |
| 2.4 | Mode on, words selected: "Comment on selection", "Comment on the whole {kind}", no prompt items (M-04, M-14) | ☐ | ☐ |
| 2.5 | Read-only file (for example a file with a git conflict): the items keep their names, are disabled and show a visible reason; comment mode is unavailable with the reason (M-05 to M-07, M-15 to M-17) | ☐ | ☐ |
| 2.6 | Markdown frontmatter, with and without a selection: disabled items with "Comments can't be added to the frontmatter." (M-18 to M-21) | – | ☐ |
| 2.7 | Markdown with unsaved editor edits: the paused band, disabled items with the band's sentence (M-15, M-16) | – | ☐ |
| 2.8 | HTML outside comment mode by keyboard: ⇧F10 / Shift+F10 in the page opens Erfana's menu (§ 4 of the matrix) | ☐ | – |
| 2.9 | Markdown editor and split views: no comment items, tools, icons, underlines or count (M-22) | – | ☐ |

## 3. Comment states (state table)

Create each state, then check its drawer tag, icon, window banner, main button and the toolbar count.

| # | State | How to create it | HTML | Markdown |
|---|---|---|---|---|
| 3.1 | Open (S-01) | Add a comment | ☐ | ☐ |
| 3.2 | Not visible now (S-02) | HTML: a hidden slide or tab; Markdown: a collapsed section | ☐ | ☐ |
| 3.3 | Changed (S-03) – notched icon, Was/Now, Resolve focused | Edit the commented text in the source | ☐ | ☐ |
| 3.4 | Words changed (S-04) | Comment on selected words, then rewrite those words | ☐ | ☐ |
| 3.5 | Not found (S-05) – info banner, Resolve focused; Markdown ghost icon | Delete the commented paragraph in the source | ☐ | ☐ |
| 3.6 | Resolved (S-06) – Reopen | Resolve a comment | ☐ | ☐ |
| 3.7 | Damaged (S-07) – ▲ badge, Rebuild from data offered | Edit the comment's readable lines by hand | ☐ | ☐ |
| 3.8 | Damaged by a merge (S-08) | Put conflict markers inside a comment | ☐ | ☐ |
| 3.9 | Precedence – a resolved comment on a deleted target is Resolved with a "Not found" tag; a changed hidden target shows Changed | Combine 3.2 with 3.3, and 3.5 with 3.6 | ☐ | ☐ |
| 3.10 | Removed outside (OD-06) – drawer note, Show, Dismiss | Delete a comment block in the source with the drawer open | ☐ | ☐ |
| 3.11 | Paused (F-02, F-03) – band, Save {file}, Go to editor | Type in the Markdown editor without saving; then change the file on disk too | – | ☐ |
| 3.12 | Toolbar number and name: "{n} comments ▲{d}", name "…, {c} changed, {d} damaged" | After 3.1 to 3.8 | ☐ | ☐ |

## 4. Steps and keys

| # | Check | HTML | Markdown |
|---|---|---|---|
| 4.1 | Keyboard only: pick a target with Tab and Alt+Up/Down, Enter, write, ⌘Enter / Ctrl+Enter to save | ☐ | ☐ |
| 4.2 | "Narrow to words" field selects words by keyboard and saves them | ☐ | ☐ |
| 4.3 | Clicking a commented target in comment mode opens its threads, not a blank comment (C-22) | ☐ | ☐ |
| 4.4 | Stepper ‹ n of m ›, ⌥F9 / Alt+F9, "Resolve and next", "Reply and resolve" | ☐ | ☐ |
| 4.5 | Esc order: menu, then window, then comment mode | ☐ | ☐ |
| 4.6 | A draft survives closing the window ("Draft restored"); Markdown also across a view switch | ☐ | ☐ |
| 4.7 | Moved target: HTML offers Pick again; Markdown saves to the moved block or offers Pick again (D-23) | ☐ | ☐ |

## 5. The file (Markdown placement)

Open the Markdown file in a text editor after each comment and compare with [markdown-format.md](../design/markdown-format.md) § 4.2. The preview must look the same before and after each comment.

| # | Check | Result |
|---|---|---|
| 5.1 | Paragraph and heading: the comment sits right above, no blank line added | ☐ |
| 5.2 | List item 1: above the whole list; item 2: indented under item 1, right above item 2's line; nested item: indented one level deeper | ☐ |
| 5.3 | Table row and a paragraph inside a block quote: above the whole table or quote, never inside it | ☐ |
| 5.4 | Deleting each comment gives back the file exactly (`git diff` shows nothing) | ☐ |
| 5.5 | The file still renders the same on GitHub (optional: push to a scratch branch) | ☐ |

## 6. With an agent

| # | Check | HTML | Markdown |
|---|---|---|---|
| 6.1 | Ask a CLI agent in Erfana's terminal to act on the open comments; it changes the commented parts and leaves every comment block as it was | ☐ | ☐ |
| 6.2 | Back in the preview, each acted-on comment shows Changed (or Words changed), never Damaged; resolved ones are untouched | ☐ | ☐ |
| 6.3 | Checking and resolving the agent's work with the stepper feels the same in both previews | ☐ | ☐ |

## 7. Results

| Field | Value |
|---|---|
| Date | |
| Commit SHA | |
| System | |
| Build | |
| Outcome | Approved / Approved with fixes listed below / Not approved |

**Extra differences found**

| # | Where | What differs | Decision (fix before merge, or forced with reason) | Fixed in commit |
|---|---|---|---|---|

**Other notes**

-
