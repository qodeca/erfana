# Spike – HTML comments outside comment mode

> Status: finished, 2026-11-01. Plan step 8, findings I-5, P-F08, I-15. All trial code was removed; this report is the only thing kept.
> Basis: commit `c0fb19b0`, the real app and real preload, driven by trusted input.

## Answers

| Question | Answer | Condition |
|---|---|---|
| D-10: can the HTML Comment button show after a mouse selection outside comment mode? | **Yes** | One small rule change in main, and the button must keep off page controls |
| D-09: can a plain-text click on an underline open its thread outside comment mode? | **Yes, with a limit** | No main change. A page that reacts to the click, or cancels it, keeps the click, so nothing opens there |

## What the trial did

- **Button.** After a real drag or double-click outside the mode, the page's own press, release and click were read, never stopped. The selection was read after the page had its turn, and the button was drawn in the existing overlay.
- **Button placement.** The button tried above the selection, then below it, and hid if both spots had a page control under them.
- **Underline.** After a real click, the thread opened only if all of these held: the click was not cancelled, the target was no link or control and had no pointer cursor, the page changed nothing while handling the click, no words were selected, and no second press came within 320 ms.
- **Main.** An `open` pick outside the mode was accepted only by pointer, with selected words, a real press and the real cursor at the reported point. Underline clicks use the existing `icon` pick, which main already accepts outside the mode.

## Results

Seven test pages, nine tests: the two existing selection tests and one test per page. All nine passed on macOS and on the Linux test machine, with the same results. The unchanged product ran first as the baseline.

| Page | Page events changed? | Button | Thread from a click on plain text |
|---|---|---|---|
| Plain document | No | Shown, opens, Save writes `sel` | Opens |
| Own click handlers | No | Shown, opens | Handler that changes the page: nothing opens. Handler with no change, or a late one: page acts **and** thread opens |
| Own selection toolbar | No | Moved below, toolbar uncovered, opens | Opens |
| Cancels clicks, blocks selection | No | No selection, so no button | Nothing opens |
| App-like, root click handler | No | Shown, opens; none in editable text | Nothing opens, because each click changes the page |
| Live clock, updates every 30 ms | No | Shown, opens | Opens |
| Hostile | No | Shown after a real drag only | Opens for a real click only |

Other measurements, on every page unless noted:

| Check | Result |
|---|---|
| Link, `role="button"`, pointer-cursor text | Nothing opens; the page keeps the click |
| Press on the button | Never reaches the page; the selection stays |
| Double-click on an underline | Opened the thread on the first click until the 320 ms wait was added; then nothing opens and the word is selected |
| Drag starting on an underline | Selects; no thread |
| Button without the placement rule | Covered two page buttons, and the page's own toolbar |
| Button with the placement rule | Covered nothing |
| Forged click, script selection, script `mouseup` (hostile page) | Nothing opens or shows |
| Click on bait that selects by script (hostile page) | Words selected; no button |
| File on disk | Unchanged until a real Save |

Unit checks with the trial in place:

| Check | Result |
|---|---|
| Preload tests, with `previewPage.surface.pin.test.ts` and the ADR 0006 contract scans | 929 passed, 5 skipped; run before the 320 ms wait was added |
| Main preview tests, with five added gate cases | 2,557 passed, 9 skipped; run before the 320 ms wait was added |
| Gate cases, `open` outside the mode | Accepted with press and cursor; dropped with no press, cursor elsewhere, no words, or by keyboard |

## Security gate and sealed preload

- **Main.** It refuses this pick today with `mode-off`, so D-10 needs a change in `commentPickHandler.ts`. The real-press rule needed no change: the press on the button passes it. The cursor check must stay, because a press proves only that the reader pressed, not what on.
- **What a compromised page gains.** After one real press, with the cursor at the point it reports, it can open a new-comment window on an element it names, without the menu step. Nothing is written without Save.
- **ADR 0006, PIN-S.** The trial added no channel, message field, IPC listener or `preventDefault`, and used only listeners that already existed. No file in `overlayCore` changed.
- **Page visibility.** The first button on a page with no comments adds the overlay's host element, so a page can see it. Pages with comments already have it.

## Risks

| Risk | Size | Handling |
|---|---|---|
| Page handler that changes nothing at once: both the page and the thread act | Medium | Cannot be seen from the overlay; keep it as a stated limit |
| Same underline works on one page and not on another | Medium | D-09 keeps a true reason, and right-click and comment mode still work |
| The button stays after a script clears the selection, until the next input or page change. Seen on five of seven pages | Low | Re-check on a short timer while the button shows; this needs no new listener |
| The 320 ms wait makes the click feel slower, and a reader with a slower double-click can still open the thread | Low | Accept, or tune in step 9 |
| A rare missed open when a live page changes inside the click's own turn | Low | Did not happen in the clock test |
| A drawn page control the check cannot see, such as a plain `div` with no pointer cursor | Low | The button can still cover it |
| A word wrapped alone in its own element gives no `sel` | Low | No button; the right-click route remains |

## Not tested

- Windows, public websites, frames, page zoom, scrolling with the button up, and touch.
- The real cursor check: e2e input does not move the system cursor, so the test hook stood in for it.
- Hover states of the button, and how it looks against the design-system card.

## Recommended change

| Row | New "Markdown" and "HTML" behaviour | New status and reason |
|---|---|---|
| D-10 | Shown in and out of comment mode, in both | Remove the row's difference. A small one stays: outside the mode, HTML moves the button or hides it if a page control is in the way, because the page owns its controls |
| D-09 | Markdown: opens in any mode. HTML: opens in any mode on plain text, unless the page cancelled the click, changed in response, or the target is a link or control | Forced in part: the HTML page owns its clicks, so a page that reacts keeps them. Comment mode and right-click remain the sure routes |

Before building, in step 9:

- Run a security review of the `open` rule in main, and update `commentPickHandler.ts`, `commentContextGate.ts`, `docs/security.md` and the ADR 0006 notes.
- Put the shared rule in the overlay core and add it to `overlay.suite.ts`.
- Read the design-system card for the button first.
- Owner call: accept that a quiet page handler and the thread can both act. If that is not acceptable, drop the D-09 change and keep the button; the two are independent.
