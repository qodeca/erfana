# Architecture review – spec 025

Reviewer: `erfana:architecture-reviewer` (independent agent, not an author), 2026-11-04, against `873a9e4a`.


Score: 7/10
Counts: critical 0, high 0, medium 5, low 3

Scope and method: I read the composition root, the tab service and tab, the four IPC handler modules, the preload bridges, the shared schemas and helpers, the renderer `BrowserPanel` imports, ADRs 0007–0012, solution design § 3 and § 15, and the owner queue. I had no shell, so I could not run `npm run lint`. File sizes come from Grep line counts, and the max-lines status comes from `scripts/max-lines-baseline.json`.

## Findings

### [medium] Two of the three teardown steps in ADR 0009 decision 14 are never registered
- `src/main/services/browser/browserProjectTeardown.ts:25` – `export const TEARDOWN_STAGES = ['endPick', 'abortCaptureWrites', 'closeViews'] as const`
- `src/main/services/browser/browserAppSetup.ts:335-337` – only `teardown.onStage('closeViews', …)` is ever called (three times). A search of `src/` for `onStage(` finds no `endPick` or `abortCaptureWrites` step outside the unit test.
- `browserProjectTeardown.ts:14` is stale: "The tab, capture and view owners do not exist yet (commits 7, 14, 15)". Those owners now exist.
- The design asks for this order on both window close and project switch: "end pick, abort a capture write and delete partial files, close views" (`specs/spec-t4-025-built-in-browser/architecture/001-solution-design.md:63`). `closeBrowserWindow` (`browserAppSetup.ts:447-453`) only calls `tabs.closeWindow`.

Why it matters:
- Today, pick mode ends only as a side effect. Closing a view destroys the page, and that runs `BrowserPicks.forgetTab` (`pick/BrowserPicks.ts:116`).
- Partial capture files are removed only after the in-flight write finishes (`BrowserPicks.ts:198-201`). The teardown does not wait for that, so the new project can open first.
- The staged-teardown abstraction suggests an order that the code does not actually enforce.
- Confidence: high on the wiring. Low on whether users can see the difference.

Fix:
- Register `endPick` (end pick mode on the project's tabs) and `abortCaptureWrites` (await or cancel `capture.writing`, then remove partial files) from `installBrowserPicks`. Pass the teardown in through its deps.
- Make window close run the same staged sequence.
- Update the stale header comment.
- About 2 files touched, internal API only, easy to roll back.
- Add a unit test that orders the three stages against a real `BrowserPicks`.

### [medium] Every new per-tab feature needs edits in five places in `BrowserTabService`, which is at 498 of its 500-line limit
- `src/main/services/browser/BrowserTabService.ts:146-153` holds six side tables: `hostOf`, `siteOf`, `inputOf`, `pageOf`, `extrasOf`, `keyringOf` (WeakMaps) and `windowKeys` (Map).
- `:255-261` hard-codes the strip-answer chain: `this.pageOf.get(tab)?.answerStrip(…) ?? this.extrasOf.get(tab)?.answerStrip(…) ?? this.keyringOf.get(tab)?.answer(…) ?? null`, then `siteOf`.
- `:463-486` (`forget`) unwinds each feature by hand.
- `:383-391`: attach order is temporal coupling written as line order. Input must come before site, site before page, and the pick pipeline is wrapped inside `pages.attachTab` (`pick/pickAppSetup.ts:97-105`) because "the routers exist by then".
- The same strip sender lambda `(event) => sendTabEvent(host, BROWSER_TAB_EVENTS.strip, StripEventSchema, event)` is repeated at `:176`, `:385`, `:402` and `:426`.

Why it matters:
- A new per-tab feature (for example the in-use indicator below) means a new map, an attach method, a `forget` line, possibly a link in the strip chain, and a correct place in the attach order. These are open/closed and shotgun-surgery smells in the one file with 2 lines of headroom.
- Leaving a feature out of `forget` leaks listeners silently.

Fix:
- Option A (recommended): add a small `TabFeature { answerStrip?(…); detach(): void }` list per tab, plus one `TabOutlet` object that holds the `sendTabEvent` closures. `forget` and `answerStrip` then loop over the list, and the attach order becomes an explicit array in one place.
- Option B: keep the maps but extract `forget` and the strip chain into `tabFeatureRegistry.ts`. Cheaper, but the open/closed problem stays.
- One file plus its tests. Callers: the 3 IPC modules use only the public surface, so the API does not change.
- Rollback: one revert.
- Prerequisite: the existing `BrowserTabService*.test.ts` suites, which already cover close and teardown.

### [medium] The IPC identity gate is copy-pasted in four handler modules, and has already drifted
- The `Parser<T>` interface is defined three times: `src/main/ipc/browser-tab-handlers.ts:97-100`, `src/main/ipc/browserTab/page-handlers.ts:76-78` and `src/main/ipc/browserTab/pick-handlers.ts:74-76`.
- The `accept` function (trusted sender, strict parse, window taken from the sender) is written three times: `browser-tab-handlers.ts:138-155`, `page-handlers.ts:93-105` and `pick-handlers.ts:91-103`.
- `guarded` is written twice: `browser-tab-handlers.ts:171-178` and `pick-handlers.ts:119-126`.
- `resolveWindowId` is written three times: `page-handlers.ts:85-90`, `pick-handlers.ts:84-89` and `popup-handlers.ts:59-64`.
- `popup-handlers.ts:78-84` inlines its own version for `contextAction`. `popupOf` (`:67-75`) does not call `isTrusted` at all; it relies on `popupByHost` and the registry's window-kind allow-list.

Why it matters:
- Every change to the gate (log text, a new check, rate limiting) needs four edits, and the two shapes already differ (`{ host }` vs `{ windowId }`).
- The project has paid this debt once already: `docs/technical-debt.md` entry 44, "`isTrustedSender` duplicated across three copies".
- Route the `popupOf` difference to security-auditor. It may be intentional (ADR 0011 decision 9), so confidence is low that it is a defect.

Fix:
- Extract `src/main/ipc/browserTab/tabRequestGate.ts`, which exports `createTabGate({ isTrusted, resolveWindow, tabs })` and returns `accept`, `acceptTab` and `guarded`.
- Move the four modules onto it one at a time; each step can be reverted alone.
- 5 files, internal API only, low risk. The co-located handler tests already pin the refusal paths.

### [medium] Five files sit right at the max-lines limit with no room to grow
Line counts (Grep `^` count; limit 500 from `scripts/lib/max-lines-baseline.mjs:19`):

| File | Lines |
|---|---|
| `src/main/services/browser/BrowserTab.ts` | 499 |
| `src/shared/ipc/browser-tab-schema.ts` | 499 |
| `src/main/services/browser/BrowserTabService.ts` | 498 |
| `src/main/services/browser/cdp/BrowserCdpSession.ts` | 496 |
| `src/main/services/browser/pick/BrowserTabPick.ts` | 490 |

Other observations:
- `src/main/index.ts` is at exactly its 805-line allowance. The browser wiring there is packed into single long lines (`index.ts:37` and `:559`).
- `BrowserTabService.ts` has 8 lines over 130 characters (`.prettierrc.json` sets `printWidth: 100`, but Prettier is not enforced). Long lines are common across the project, so I am not scoring them on their own.
- `scripts/max-lines-baseline.json` has no browser entries, so the limit is respected.

Why it matters:
- These are the five busiest files of the feature: tab, tab service, wire schema, CDP session and pick controller.
- The next requirement in any of them forces a split under deadline pressure, not a planned one.
- The pattern suggests the files were trimmed to pass the limit rather than split by responsibility.

Fix:
- Split while nothing is urgent:
  - `BrowserTab` – move the navigation listeners (`:381-448`) into `tabNavigationGuard.ts`.
  - `browser-tab-schema.ts` – move the tab-state and event schemas into their own module, next to the existing `-site`, `-chrome`, `-page`, `-pick` and `-popup` schema modules.
  - `BrowserTabService` – the feature list from the previous finding.
- Each split is an internal move that `check-max-lines` verifies. Low risk.

### [medium] The `inUse` field of the tab state is always `false` and nothing produces it
- `src/main/services/browser/BrowserTab.ts:339` – `inUse: { camera: false, microphone: false, screen: false },`
- The schema carries it (`src/shared/ipc/browser-tab-schema.ts:334`), and the renderer draws it (`src/renderer/src/components/Panels/BrowserPanel/AddressChips.tsx:39` – `if (state.inUse.camera) chips.push(…)`).
- `decorateTabState` (`page/tabPageState.ts:59-79`) overrides `zoomPercent` but not `inUse`. A search of `src/` for `inUse` finds no other producer.
- 025-FR-019 requires the tab to "show an indicator that stays in the address bar for as long as the capture lasts" (`requirements/02-requirements.md:313`).
- `zoomPercent: 100` (`BrowserTab.ts:336`) is the same kind of placeholder, but `decorateTabState` does fill that one in.

Why it matters:
- The tab state is assembled in two places with no clear owner per field. A placeholder left in one of them type-checks, passes the schema, and ships a dead UI path.
- It is also a spec gap. Route it to code-reviewer and UX. In those lenses it may rate higher than medium.

Fix:
- Have the site/permissions layer report the media capture state per tab, through a feature on the list from finding 2.
- Remove the literal placeholders from `BrowserTab.state()`, so a missing producer fails to compile instead of sending `false`.
- Add a unit test with a camera grant.

### [low] The browser's setup code lives in the services layer and imports the IPC layer
- `src/main/services/browser/browserAppSetup.ts:38` – `import { registerBrowserTabHandlers } from '../../ipc/browser-tab-handlers'`, plus `:61-62`.
- `src/main/services/browser/pick/pickAppSetup.ts:20` – the same for the pick handlers.
- The HTML preview does it the other way round: per `src/main/services/CLAUDE.md`, "the composition root `src/main/ipc/preview-handlers.ts` … builds the preview graph". Here the IPC modules import service types and the services register IPC.
- The import is type-only on one side, so there is no runtime cycle. Other services also import from `ipc/`, for example `screenshot/ScreenshotOverlayWindow.ts:64`.

Fix: none needed now. If more channels are added, move `browserAppSetup` and `pickAppSetup` under `src/main/ipc/browserTab/` (or a `src/main/browser/` folder) to match the preview convention. Two files and one import in `index.ts`; easy to roll back.

### [low] Pick sessions are recorded in two places, and one is used only by tests
- `src/main/services/browser/pick/pickAppSetup.ts:31-36` keeps a module-level `WeakMap`, which production uses through `sessionOf`.
- `src/main/services/browser/pick/BrowserPicks.ts:66` and `:101-103` keep a second map, `registerSession`. Its only caller is `BrowserPicks.test.ts:85`.

Fix: delete `BrowserPicks.registerSession` and its map, and have the test pass `sessionOf`. One file plus its test, no API impact.

### [low] Browser code reaches into the preview feature's internals
- Main process:
  - `BrowserTab.ts:49` and `page/TabViewFrame.ts:24` – `RectLike` from `../preview/previewBoundsClamp`
  - `page/widthPresetLayout.ts:25` – `clampAndZoomBounds`
  - `browserProfileGuards.ts:35` and `local/localConfinedFile.ts:30` – `realPathWithin` from `previewPathResolve`
  - `local/localRequestPath.ts:20` – `isSafeSegment`
  - `local/LocalFolderServer.ts:31` – `mimeForExtension` from `previewResponseHeaders`
- Renderer:
  - `BrowserPanel/useBrowserBounds.ts:28` – `../HtmlPreviewPanel/previewClip`
  - `BrowserPanel/BrowserPanel.tsx:61` – `../TerminalPanel/hooks/useStartIfGone`

Why it matters: a preview-only refactor of path confinement or MIME handling now changes browser security behaviour without anyone seeing it in the diff.

Fix: move these helpers to `src/main/utils/` and `src/renderer/src/utils/`. This is a cheap mechanical move.

## What is strong

- **Layer boundaries are enforced by lint, not left to convention.**
  - `eslint.config.mjs:11-42` blocks shared → main/renderer/preload/electron and main → renderer/preload.
  - The renderer reaches the bridge only through `services/browserTabGateway.ts` (gateway list at `eslint.config.mjs:137-138`).
  - The preload is thin and typed from shared: `src/preload/browserTabBridge.ts` is 61 lines and imports only `../shared/ipc/browser-tab-channels`, `browser-tab-bridge-types` and `./ipcSubscribe`.
- **Features are split into cohesive folders** under `src/main/services/browser/`: `cdp/`, `input/`, `pick/`, `capture/`, `local/`, `site/`, `permissions/`, `page/`, `popups/`, `dialogs/`, `downloads/`, `contextMenu/`. That is 125 non-test files, most under 300 lines.
- **Seams are designed in from the start.**
  - Every service takes a deps interface with optional features, for example `BrowserTabServiceDeps` (`BrowserTabService.ts:100-128`), where each `?` field documents what happens without it.
  - The composition root exposes test seams (`browserAppSetup.ts:110-115`).
  - The clock is injected everywhere (`mainClock`).
  - Each folder has its own fakes: `cdp/__test-helpers__/fakeCdp.ts`, `input/__test-helpers__/fakeInputContents.ts`, `page/__test-helpers__/fakePageTab.ts`, `pick/__test-helpers__/pickHarness.ts`, `site/__test-helpers__/siteFakes.ts`.
- **`BrowserCdpSession` is already broken up** into `EventHub`, `BrowserLogBuffer`, `CdpLogCollector`, `BrowserHangProbe` and `CdpFloodBudget` (`cdp/BrowserCdpSession.ts:130-134`), and it checks commands against an allow-list (`cdp/cdpAllowList.ts`).
- **ADRs are followed where I checked:**
  - ADR 0012: the five modules it names all exist under `local/`.
  - ADR 0010: `scripts/fuses.js:710` – `[FuseV1Options.EnableCookieEncryption]: true`.
  - ADR 0008: `Debugger.pause` is covered by `e2e/browser-pick-freeze-pause.e2e.ts`.
  - ADR 0009 decision 5: the registered-id exemption (`browserAppSetup.ts:103` and `:216-227`).
  - ADR 0011 decision 2: `OverlayGuardService` now handles every native view kind through `NativeViewKind` (`renderer/src/services/preview/OverlayGuardService.ts:7-11`, `:231-248`).
  - ADR 0011 decision 11: one shared `shared/browser/routingState.ts` is used by the main-process key and mouse routers.
- **The browser wiring stays out of `index.ts`** (`browserAppSetup.ts:3-6`), so `index.ts` stays inside its 805-line allowance.

## Owner-pending items seen (not scored)

- Item 24 – 025-AC-035 "covered by" vs ADR 0007 decision 4 (accepted). A hit-test rule change needs an ADR amendment.
- Item 30 – the popup strip IPC answer gained `openedBy` (`src/main/ipc/browserTab/popup-handlers.ts:101`).
- Item 26 – 025-AC-077 multiple terminals. This would affect the `TargetTerminals` surface (`browserAppSetup.ts:191-200`).
- Items 2, 16, 17, 19 (screen approval, live outline contrast, banner style, strip folding) and items 18, 21, 23 (React source location, AC-024 client hints, AC-037 wording) are outside this lens.

## Score rationale

There is no critical or high finding. The anchor for 8 needs medium findings that are "few, local and have a clear fix". This review has five medium findings, and two of them span more than one area: the IPC gate duplication touches four modules, and the files at the line limit touch the tab, the schema, the CDP session and the pick controller. That matches the 7 anchor: "several medium findings that touch more than one area". The base structure is good: lint-enforced layers, injected seams, cohesive feature folders and ADRs mostly followed. A score of 8 needs:
1. The `endPick` and `abortCaptureWrites` steps wired.
2. The gate extracted.
3. The `inUse` producer, or a recorded owner decision on it.

Splitting the files at the line limit can follow.
