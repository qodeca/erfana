# Architecture review – spec 025

Reviewer: `erfana:architecture-reviewer` (independent agent, not an author), 2026-11-04, against `8fd4ed87` (round 2).

Score: 8/10
Counts: critical 0, high 0, medium 0, low 6

Scope and method: I read the round-1 report and the code as it is at HEAD 8fd4ed87. That covered the composition root (`browserAppSetup.ts`, `pick/pickAppSetup.ts`), the tab service and its new feature modules (`tabFeatureRegistry.ts`, `tabFeatureAttach.ts`), the teardown, `BrowserPicks`, the four IPC handler modules and the new `tabRequestGate.ts`, `mediaInUse.ts`, `ProjectSession.onChange`, ADR 0009 decision 14, the max-lines baseline module and the ESLint layer blocks. I had no shell, so I did not run `npm run lint` and took its max-lines pass from the brief. Line counts come from Grep `^` counts.

## Findings

### [low] The pick pipeline sits outside the new per-tab feature list, which the header says covers every feature
- `src/main/services/browser/tabFeatureAttach.ts:11-13` – "adds itself to the tab's feature list (`tabFeatureRegistry.ts`), which answers strip rows and detaches every feature when the tab goes."
- The pick pipeline is not on that list:
  - It is wrapped inside `attachPage` through `pickSetup.withPicks(pages)` (`browserAppSetup.ts:310`, `pick/pickAppSetup.ts:103-113`).
  - Its detach is a separate `'destroyed'` listener: `tab.contents.once('destroyed', () => this.forgetTab(tab.id))` (`pick/BrowserPicks.ts:123`).
  - The wrapper's `detachTab: (page) => features.detachTab(page)` (`pickAppSetup.ts:112`) never detaches the pick.
- Related leftovers:
  - `BrowserTabService.inputFor` is documented as "The input routing of `tab`, for the test hooks" (`BrowserTabService.ts:290`), but production pick wiring calls it (`pickAppSetup.ts:94`, `:108`).
  - `BrowserPicks.detachTab` is called only from `BrowserPicks.test.ts:154`.
- Why it matters:
  - The round-1 fix (option A) removed most of the shotgun surgery, but the single largest per-tab feature still uses the old pattern: hidden attach order, an event-driven detach, and a lazy `tabs: () => tabs` cycle (`pickAppSetup.ts:91-95`).
  - The next feature author has two patterns to copy.
  - Behaviour is correct today: `closeTab` destroys the contents, so `'destroyed'` fires.
- Fix:
  - Make pick an `attachPick` step in `ATTACH_ORDER` after `attachPage`, with `features.add({ name: 'pick', detach: () => picks.forgetTab(tab.id) })`.
  - Drop `withPicks`, fix the `inputFor` doc comment, and delete or privatise `BrowserPicks.attachTab`/`detachTab`.
  - About 4 files, internal API only, one revert to undo. The `BrowserPicks.test.ts` and `pickAppSetup.test.ts` suites are the safety net.

### [low] Browser security code still reaches into the preview feature's internals, and one path-segment check is duplicated with different rules (carried over from round 1, not fixed)
- `local/localRequestPath.ts:20` – `import { isSafeSegment } from '../../preview/previewPathResolve'`
- `browserProfileGuards.ts:35` and `local/localConfinedFile.ts:35` – `realPathWithin` from `previewPathResolve`
- `local/LocalFolderServer.ts:31` – `mimeForExtension` from `previewResponseHeaders`
- `BrowserTab.ts:45`, `page/TabViewFrame.ts:24`, `page/widthPresetLayout.ts:25` – from `previewBoundsClamp`
- Renderer: `BrowserPanel/useBrowserBounds.ts:28` (`../HtmlPreviewPanel/previewClip`) and `BrowserPanel/BrowserPanel.tsx:63` (`../TerminalPanel/hooks/useStartIfGone`)
- New in this round: `browserProfileGuards.ts:302` defines its own private `function isSafeSegment(segment: string): boolean`. It does not take a platform, unlike the preview one used at `localRequestPath.ts:48` (`isSafeSegment(segment, platform)`).
- Why it matters:
  - A refactor that is only meant to touch the preview can change browser confinement without anyone seeing it in the diff.
  - Two checks with the same name and different rules invite the wrong one being used.
  - Whether the two rule sets should match is a question for security-auditor.
- Fix: move `realPathWithin`, `isSafeSegment`, `mimeForExtension` and `RectLike`/`clampAndZoomBounds` to `src/main/utils/`, and `visibleArea` to `src/renderer/src/utils/`. Then choose one segment check, or give the private one a different name. This is a mechanical move: about 10 import sites, no API impact.

### [low] Teardown order is enforced within the three stages, but not "before the new project opens" as ADR 0009 decision 14 says
- `docs/adrs/0009-browser-profile-in-the-project-folder.md:29` – "end pick mode, abort a capture write and delete its partial files, then close the old project's browser views – in that order – before the new project opens."
- `src/main/services/session/ProjectSession.ts:43` – `onChange` is "Called synchronously at commit".
- `src/main/services/browser/browserProjectTeardown.ts:92` – `if (prev !== null && leavesProject(prev, next)) void this.run(prev.realRoot)`
- So the teardown starts after the new project is committed, and `abortCaptureWrites` can keep the old tabs alive for up to `TEARDOWN_WRITE_WAIT_MS = 2_000` (`pick/BrowserPicks.ts:51`) while the new project is open.
- Old tabs carry their own `projectRoot`, so I found no cross-project write. Confidence is low that users can see this.
- Fix (choose one):
  - (a) Amend the ADR text to "after the switch commits, before the old project's views close". This could join owner item 36.
  - (b) Have `ProjectService` await a pre-commit hook. That touches the project service and is not worth doing now.

### [low] The browser's setup modules live in the services layer and import the IPC layer (carried over, unchanged)
- `src/main/services/browser/browserAppSetup.ts:39` – `import { registerBrowserTabHandlers } from '../../ipc/browser-tab-handlers'`, plus `:62-63`
- `src/main/services/browser/pick/pickAppSetup.ts:22` – `import { registerBrowserTabPickHandlers } from '../../../ipc/browserTab/pick-handlers'`
- The preview does the opposite: `src/main/services/CLAUDE.md` says its composition root is `src/main/ipc/preview-handlers.ts`. There is no runtime cycle.
- Fix: no action needed now. If the browser grows, move both setup files under `src/main/browser/` or `src/main/ipc/browserTab/`.

### [low] Tab state still has two owners per field: `zoomPercent` is a placeholder that a decorator overwrites
- `src/main/services/browser/BrowserTab.ts:328` – `zoomPercent: 100,`
- `src/main/services/browser/page/tabPageState.ts:64` – `{ ...state, zoomPercent: clampZoomPercent(facts.zoomPercent) }`
- `inUse` was fixed properly: `mediaInUse` is now a required dependency (`BrowserTabService.ts:130`), and the app passes a named `MEDIA_CAPTURE_UNOBSERVED` (`browserAppSetup.ts:328-329`, `site/mediaInUse.ts:25`).
- `zoomPercent` is the same pattern the round-1 report warned about: a tab without page features ships `100` silently.
- Fix: make `zoomPercent` a required producer the same way (`zoomPercent: () => number`), or let `BrowserTab.state()` omit it and have `stateOf` add it. One file plus tests.

### [low] The composition root and the panel are close to the line limit
| File | Lines | Limit |
|---|---|---|
| `src/main/services/browser/browserAppSetup.ts` | 483 | 500 |
| `src/renderer/src/components/Panels/BrowserPanel/BrowserPanel.tsx` | 468 | 500 |
| `src/main/services/browser/BrowserTab.ts` | 455 | 500 |
| `src/main/services/browser/pick/BrowserTabPick.ts` | 451 | 500 |
| `src/shared/ipc/browser-tab-schema.ts` | 447 | 500 |
| `src/main/index.ts` | 805 | 805 (baseline) |

- Round 1's five files at 490–499 lines now have 45–76 lines of room, so that finding is closed.
- `browserAppSetup.ts` is now the tightest. It keeps growing because every new site, page or popup concern is wired there: there are 63 import lines, about 20 of them from the feature folders.
- `BrowserPanel.tsx` has 32 lines of room, and its header describes it as "Glue only".
- Fix: when it next grows, split `browserAppSetup.ts` along its existing helpers (`createBrowserSite`, `createBrowserPopups`, `tabInputSetup`, `attachTabCdp` into `browserFeatureFactories.ts`). This is a mechanical move, low risk.

## What is strong
- **Round-1 medium findings are fixed:**
  - **Teardown.** `BrowserPicks.registerTeardown` registers `endPick` and `abortCaptureWrites` (`pick/BrowserPicks.ts:149-155`). Window close goes through the same staged sequence (`browserAppSetup.ts:481-483` → `teardown.runForWindow`). The order is pinned by `browserProjectTeardown.test.ts:46`, `:64`, `BrowserPicks.test.ts:364` and `browserAppSetup.test.ts:121-126`. The stale header is updated (`browserProjectTeardown.ts:7-22`).
  - **Feature list.** `TabFeatureList` (`tabFeatureRegistry.ts:75-101`) gives one strip-answer chain and one detach loop. A detach that throws is logged and the rest still run. `TabOutlet` replaces the repeated sender lambdas (`:51-63`). The attach order is an explicit array (`tabFeatureAttach.ts:133`). `BrowserTabService.ts` went from 498 to 424 lines, and `forget` is now 10 lines (`:403-413`).
  - **IPC gate.** There is one gate, `createTabGate` (`src/main/ipc/browserTab/tabRequestGate.ts:67-92`). All four modules use it (`browser-tab-handlers.ts:132`, `page-handlers.ts:77`, `pick-handlers.ts:77`, `popup-handlers.ts:59`), and it has its own test (`tabRequestGate.test.ts`). The popup channels' skipped trust check is now explained at the gate (`tabRequestGate.ts:19-22`).
  - **Tab state schema.** It is split: `browser-tab-state-schema.ts` (73 lines), `browser-tab-base-schema.ts` (54 lines).
  - **Pick sessions.** The duplicate session map is gone: `BrowserPicks` takes `sessionOf` only (`BrowserPicks.ts:61`, `:119`).
- **Layer boundaries are enforced by lint.** The per-layer `no-restricted-imports` blocks cover main, preload, shared and renderer (`eslint.config.mjs:376`, `:450`, `:594`, `:623`, `:632`). The renderer reaches the bridge only through `browserTabGateway.ts` (`:138`). The preload bridge is 61 lines.
- **Seams.** Every handler module takes injectable `isTrustedSender` and `resolveWindowId` (for example `popup-handlers.ts:45-47`). The composition root exposes registration seams (`browserAppSetup.ts:112-117`). The clock is injected throughout. Each feature folder has its own fakes.
- **Cohesion.** 131 non-test files in feature folders, nearly all under 350 lines. The only main-process files above 400 lines are `BrowserTab`, `BrowserTabService`, `BrowserTabPick`, `BrowserCdpSession` and `browserAppSetup`.

## Owner-pending items seen (not scored)
- Item 34 – 025-FR-019 in-use chips: no producer exists, and that is now named at the one wiring site (`browserAppSetup.ts:328`, `site/mediaInUse.ts`).
- Item 36 – ADR 0012 and 0009 text corrections. My teardown-wording finding above could be folded into the same amendment.
- Item 24 – 025-AC-035 vs ADR 0007 decision 4.
- Item 26 – 025-AC-077 multiple terminals: this would affect the `TargetTerminals` surface (`browserAppSetup.ts:193-202`).
- Item 30 – the popup strip answer's `openedBy` field (`popup-handlers.ts:92`).
- Items 2, 3, 5, 15–23, 27–29, 31–33 and 35 are outside this lens.

## Score rationale
There is no critical, high or medium finding. Round 1's five medium findings are fixed in the code and backed by tests. The six low findings are local, and each has a clear, cheap fix. That fits the 8 anchor ("ready to ship") and comes close to 9. I stopped short of 9 because six lows is more than "a few", and two of them (the reach into preview internals, and services importing the IPC layer) were reported in round 1 and are still open. Closing those two, and moving pick onto the feature list, would justify a 9.

## Round 2 notes
- Round-1 medium 1 (teardown stages not registered): **fixed** (see Strengths).
- Round-1 medium 2 (five edits per tab feature): **mostly fixed**. The pick pipeline still uses the old pattern (first low finding).
- Round-1 medium 3 (gate copy-pasted): **fixed**.
- Round-1 medium 4 (files at the limit): **fixed** for the five files named. The pressure moved to `browserAppSetup.ts` (483 lines).
- Round-1 medium 5 (`inUse` placeholder): **fixed structurally**. The product question is owner item 34. The same pattern is still there for `zoomPercent` (low).
- Round-1 low 1 (services import the IPC layer): **open**.
- Round-1 low 2 (pick session recorded twice): **fixed**.
- Round-1 low 3 (reach into preview internals): **open**, plus a new duplicate `isSafeSegment` that security-auditor should look at.
- New in round 2: teardown timing vs the ADR 0009 decision 14 wording (low, low confidence).
