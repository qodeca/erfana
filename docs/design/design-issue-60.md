<!--
SPDX-License-Identifier: GPL-3.0-only
SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
-->

# Design – issue #60: renderer crash on very large projects (black window)

**Status**: approved at QG-4 on 2026-08-11 · **review_level**: full · **QG-4a lens review**: 31 findings folded in (see §10)
**Issue**: #60 · **Tier**: n/a (bug/hardening) · **Phase**: 4 (Architecture)
**Reconciled with the shipped code on 2026-08-11**: §2.3 (panel copy, copy deck, global-trail claim), §3 (file-table split + four entries added during implementation, plus the recorded line-count deviations), §7 and §8. Passages marked *as shipped* or *corrected* override the design-time text above them.

> Trust note: this document was produced from source read at design time. All external issue text, log excerpts and lens-review findings were treated as data; no embedded instruction was executed. Every claim below marked *verified* was read in the working tree on branch `develop`.

## 1. Approach summary

Opening a 174k-node project throws `RangeError: Maximum call stack size exceeded` inside `flattenTree` (`src/renderer/src/hooks/useDragDropTree.ts:45`, *verified*). No boundary exists above `<App/>`, so React 18 unmounts the whole root and the window goes blank. Scan (2.0 s / 169k files), IPC clone (~1.2 s), watchers and git all complete — they are slow, not fatal.

Fix the crash at the source, contain the blast radius, and leave a trail for the next incident:

- **A. Crash fix** — rewrite `flattenTree` as an explicit-stack loop with a single `push` per node. Output-identical (pre-order DFS, forward sibling order, per-parent `index` reset), no `push.apply` argument-count exposure.
- **B. Lookup index** — B1 (flatten the filtered tree) evaluated and rejected; B2 (delete the second full-array copy, replace six linear scans with a Map-backed named lookup) adopted. §2.
- **C. Two-tier error containment** — a panel-scoped boundary around the project tree *and* a root boundary of last resort, plus a global error trail for the classes neither boundary sees. §2.3.
- **D. Hardening** — `backgroundColor` on the main `BrowserWindow`.
- **E. Instrumentation** — flatten timing (renderer) + app-level `render-process-gone` / `child-process-gone` and per-window `unresponsive` logging (main).
- **F. Regression coverage** — 200k reproduction, invariant-scan parity, staleness tests, boundary/fallback/a11y/contrast tests, one Electron E2E scenario, UAT checklist.

**What this does and does not guarantee.** Layer coverage is explicit rather than absolute — "no blank window" holds only for the failure classes a boundary can intercept:

| Failure class | Caught by | User sees | Record |
|---|---|---|---|
| Throw during render/lifecycle inside the project tree | `PanelErrorBoundary` (panel-scoped) | "Project tree unavailable" in the sidebar; editor buffers and terminal keep running | `logger.error` |
| Throw during render/lifecycle anywhere else under `<App/>` | `RootErrorBoundary` | Full-window fallback with Restart / Copy / Open logs | `logger.fatal` |
| Throw inside the fallback itself | `FallbackGuard` (distinct inner boundary) | Dependency-free static text | best-effort `logger.fatal`, then inline-styled `document.body` sibling |
| Async throw, event-handler throw, unhandled rejection | `installGlobalErrorTrail()` | Nothing (UI stays as-is) | `logger.fatal` |
| Renderer/utility process death, hang | main-process handlers | OS-level blank/beachball (unchanged) | main log with `reason` + `exitCode` |
| Main-process crash | nothing in this issue | app exits | OS crash report |

In production, an error caught by `componentDidCatch` **does not** reach `window.onerror`, so the boundary's `logger.fatal` is the only record — it must fire regardless of the configured log level, and that is asserted. In development React re-throws to `window` as well, which is the real (dev-only) source of duplicate lines.

Performance work (virtualization, lazy loading, TTI budget) is deliberately **not** in this issue — §8.

## 2. Design decisions that needed evidence

### 2.1 A — why the explicit stack

`useDragDropTree.ts:45` is `flattened.push(...flattenTree(...))`, i.e. `push.apply` with one argument per node in the subtree. The engine's spread/apply argument limit is stack-size dependent (~10^5 on V8), so the first directory whose *flattened subtree* exceeds it throws. Recursion depth is not the trigger (that tracks directory nesting). The explicit stack removes both the argument-count and the call-depth exposure at once and keeps the exported signature (`nodes, parentId = null, depth = 0`) intact for existing callers and tests.

**Shape constraints the existing tests already pin** (`useDragDropTree.test.ts:41-96`, *verified*): DFS **pre-order**, **forward** sibling order, `index` **reset per parent**, `depth` incremented per level. A naive "push all children onto a stack" implementation reverses siblings, and a global running counter breaks `index`. The frame-cursor form below satisfies all four:

```ts
const stack = [{ nodes, parentId, depth, i: 0 }]
while (stack.length > 0) {
  const frame = stack[stack.length - 1]
  if (frame.i >= frame.nodes.length) { stack.pop(); continue }
  const node = frame.nodes[frame.i]
  const index = frame.i++
  flattened.push({ ...node, parentId: frame.parentId, depth: frame.depth, index })
  if (node.type === 'directory' && node.children?.length) {
    stack.push({ nodes: node.children, parentId: node.path, depth: frame.depth + 1, i: 0 })
  }
}
```

### 2.2 B — the two lookup questions

**B1 — feeding `filteredFiles` into the flattener at `ProjectTree.tsx:139`: REJECTED.**

- `filteredFiles` (`ProjectTree.tsx:299-305`, *verified*) returns **the same `files` reference** when `filterMode === 'all'` — the default, and the mode the crash was reported in. Zero crash or memory benefit on the failing path.
- In `markdown` mode it shrinks the set and changes one real behaviour: `selectedFolder` survives a filter-mode switch, so the cut/copy lookup (`:666`) and import-shortcut lookup (`:1143`) would silently no-op for a folder selected in `all` mode and filtered out in `markdown` mode.
- Semantics otherwise hold — the flattened array is a lookup index, never rendered; rendering goes through `rootFolderNode` → `ProjectTreeNode`, which descends only into expanded folders (`ProjectTreeNode.tsx:256`, *verified*).

→ recorded as a follow-up note on #60 (§8), not implemented here.

**B2 — deleting the second full-array copy (`enhancedFlattenedItems`, `ProjectTree.tsx:330-351`): ADOPTED.**

Two corrections to the incoming diagnosis:

- It is **not** a stack-overflow site. `[{...}, ...arr]` is array-literal spread (iterable copy), not `apply`; only `f(...arr)` / `push(...arr)` hits the argument limit.
- The copy is **redundant**. Every consumer (`:220`, `:476`, `:582`, `:1143`, `:1391`, *verified*) reads only `.path`, `.type`, `.parentId`, `.name` — never `depth` — and the `parentId || rootFolderNode.path` fixup at `:348` is already covered by the existing `targetNode.parentId || projectPath || ''` fallback at `:599`.

B2 therefore stands on **memory and CPU alone**: it removes a second ~174k-object allocation inside the very render that crashed, and replaces six linear `.find` scans — one of which (`:476`) runs per drag-over event — with hash lookups that are amortized O(1) on V8 (the spec guarantees sublinear). Retained footprint: the Map holds ~174k lightweight `string → reference` entries in place of ~174k freshly spread objects, so the change is net-negative on memory as well as on time.

An earlier draft justified B2 partly by "stable callbacks stop the keydown effects re-registering". That justification is **withdrawn**: lookups derived from the Map rebuild on exactly the same cadence as the array they replace, so effect churn is unchanged.

**Ordering and API constraints.**

- The hook exports **named lookups**, not a raw Map: `findNode(path)` (base tree) and `findNodeWithRoot(path)` (synthetic root first, then the Map). Root-inclusion policy lives in one module. `ProjectTree.tsx:139` must destructure and *use* them, or the API is dead code.
- *As shipped*, `findNodeWithRoot` takes a second parameter — `findNodeWithRoot(path, rootNode)` — because the synthetic root is assembled in `ProjectTree`, not in the hook; the caller supplies it, so root-inclusion policy still lives in one place while the root node itself stays owned by its builder.
- `findNodeWithRoot` checks the synthetic root **before** the Map — element-0 semantics today, since the root entry is prepended at `:336`. `rootFolderNode.path === projectPath` (`:319`, *verified*), and a parity test pins that identity by dropping a file onto a top-level file and asserting `targetParent === projectPath`.
- The root/no-root asymmetry is preserved exactly: `:666` (cut/copy) resolves through `findNode`, so the synthetic project root stays non-cuttable; the other five sites use `findNodeWithRoot`.
- Duplicate paths keep `Array.find` semantics via an inline `if (!map.has(path))` guard (first wins).
- The hook's own internal consumers resolve through the index too: `findNode` (`:200-202`) and `getProjection`'s two `.find` calls (`:110-111`). The module-level `getProjection` export gains an **optional** trailing index parameter so the six existing 4-argument tests (`useDragDropTree.test.ts:215-332`, *verified*) keep passing unchanged; the backward walk at `:141-153` stays positional (it is an ordered scan, not a lookup).

**B2 has a prerequisite.** `ProjectTree.tsx:699`'s keydown effect lists `[selectedFolder, flattenedItems, clipboard]` but calls `handlePaste` (`:701`, a plain function re-created every render, *verified*) — which is **absent from the deps**. Today the array identity churns on every tree rebuild and accidentally re-registers the listener often enough to hide it; removing the churn would expose a stale closure on the destructive paste path. So `executePaste` and `handlePaste` are wrapped in `useCallback` with honest deps (`executePaste`: `projectPath`, `clipboard`, `refreshProjectTree`; `handlePaste`: `selectedFolder`, `clipboard`, `showConfirm`, `executePaste`) and added to the effect deps **as the first commit**, before any lookup change, with a behavioural stale-closure test.

### 2.3 C — error containment, in three parts

**Two tiers, not one.** A root-only boundary turns a project-tree defect into "workspace gone", discarding unsaved Monaco buffers and a live terminal. `PanelErrorBoundary` wraps `<ProjectTree/>` at its mount point (`ProjectPanel.tsx:153` as shipped) and degrades inside the sidebar; the root boundary is the tier below it. The two-tier contract is documented in `docs/ui-components.md`.

*As shipped*, the panel copy reads **"Project tree unavailable. The rest of Erfana still works."**, and a failed retry reads **"Project tree is still unavailable."** rather than repeating the reassurance; the action is a `Reload` button whose accessible name is `Reload project tree`. Two behaviours were added at implementation time and are load bearing: focus returns to the Reload button after a failed retry (the rebuild would otherwise drop focus to `<body>`), and the boundary is **keyed by project** — `<PanelErrorBoundary key={projectPath ?? 'none'} …>` — because the error state survives re-renders, so without the key a tree that crashed on project A still reads "unavailable" after the user opens project B.

**The fallback-throw guard cannot live in the boundary that renders the fallback.** React never routes an error thrown by a boundary's own fallback back into that boundary. `RootErrorBoundary` therefore renders `{hasError ? <FallbackGuard><RootErrorFallback/></FallbackGuard> : children}`, where `FallbackGuard` is **always a distinct boundary class** (colocated in `RootErrorBoundary.tsx` is fine; merged into the same class is not). `FallbackGuard`'s own fallback is dependency-free static JSX: no CSS import, no `TEST_IDS`, no `window.api`, no `errorDetails` call.

**The emergency write must not touch `#root`.** Writing `textContent` into `#root` fights React's commit-phase DOM ownership (`NotFoundError`, or text wiped on the next commit). The last resort — reached only from the `FallbackGuard` path — appends a **sibling node to `document.body`**, styled **inline** (no stylesheet, no class, which keeps both the F1 dependency-free rule and the §2.4 CSS allowlist intact).

**Global error trail.** `installGlobalErrorTrail()` is imported by `main.tsx` **before** the route branch and installs `window.addEventListener('error' | 'unhandledrejection')` → `logger.fatal` in the same payload shape as the boundary. It is deliberately branch-agnostic: the overlay window gets a trail too.

> **Corrected against the shipped code.** This section originally claimed the trail "supersedes" the renderer logger's own pair "without double-logging". It does not, and cannot from this module. `RendererLogger.installErrorHandlers()` (`logger.ts:143-160`, *verified*) registers its own `error` / `unhandledrejection` listeners at `error` level, and **both fire**: one uncaught error produces a `fatal` line from the trail *and* an `error` line from the logger. Suppressing the logger's pair from the trail would require `stopImmediatePropagation()`, which would silently kill every `error` listener registered after this one — a worse defect than a duplicate log line. The duplicate is accepted and stated plainly in the module docblock; collapsing the two belongs in `logger.ts` and is recorded as a follow-up in §8. What the trail *does* guarantee, and what the tests assert, is idempotence (installing twice registers one listener per event type) and payload-shape parity with the boundary.

**Copy deck** — as shipped (`RootErrorFallback.tsx`, `RootErrorBoundary.tsx`, `errorDetails.ts`). Plain language first, raw error demoted; en dashes throughout, per the project style rule:

| Slot | Text |
|---|---|
| Heading | `Erfana stopped unexpectedly.` |
| Message — Restart available | `Files you saved are not affected. Restarting opens Erfana on the welcome screen.` |
| Message — Restart bridge missing, others present | `Files you saved are not affected. Quit Erfana and open it again.` |
| Degraded mode — no bridge method callable | `Files you saved are not affected. Erfana's recovery tools are unavailable, so quit Erfana and open it again. Log files are in:` followed by `.erfana/logs in your home folder` |
| Buttons | `Restart Erfana` · `Copy error details` · `Open logs folder` |
| Details summary | `Show error details` / `Hide error details` |
| Details region label | `Error details` |
| Details body | `Erfana {version} · {timestamp}`, then `name: message`, truncated stack, component stack |
| Elision marker | `… N more lines – use Copy error details for the full stack` |
| Status — copy | `Error details copied to clipboard.` / `Could not copy the error details – the clipboard is unavailable.` |
| Status — restart | `Restarting Erfana…` / `Restart didn't start – quit and reopen Erfana manually.` (3 s) / `Restart failed – quit and reopen Erfana manually.` |
| Status — logs | `Opened the logs folder.` / `Could not open the logs folder.` |
| `FallbackGuard` last resort | `Erfana stopped unexpectedly.` + `The recovery screen could not be drawn. Quit Erfana and open it again. Files you saved are not affected.` |

Three copy decisions came out of the QG-8 remediation and are deliberate, not drift:

- **The message branches on capability, not on taste.** "Restarting opens Erfana on the welcome screen" is a promise about a button, so it is shown only when that button exists; with the Restart bridge missing the sentence becomes "Quit Erfana and open it again."
- **Degraded mode drops the message paragraph entirely** and lets the instruction carry the description (`aria-describedby` points at it), because the instruction already opens with the same reassurance and duplicating it would make a screen reader read the sentence twice.
- **The log location is prose, not a path.** Degraded mode is exactly the case where `window.api.logging.getLogsDir()` cannot be called, so neither the real path nor the platform can be read; `~/…` would be wrong on Windows and `process.platform` is `undefined` under the sandbox. The relative part comes from the shared `LOGS_DIR_RELATIVE` constant that `LoggingService.getLogsDir()` also uses, so the two cannot drift.

`error.message` is untrusted text rendered as text only, inside the details disclosure — never in the headline, never as HTML — and is capped at `MAX_MESSAGE_CHARS` (2 000) at extraction so an attacker-influenced message cannot push the stack out of the 16 KB copyable report.

**Accessibility contract.**

- Fallback container: `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby={headingId}`, `aria-describedby={messageId}`, `tabIndex={-1}`, focused on mount. There is **no** separate `role="alert"` block — one announcement, and the container carries a real accessible name (asserted with `toHaveAccessibleName`, not merely `toHaveFocus`).
- One `role="status"` region carries every transient message: copy result, "Restarting Erfana…", and the 3 s "Restart didn't start — quit and reopen Erfana manually." guidance.
- Restart pending uses `aria-disabled="true"` + an early-return `onClick`, **never** the `disabled` attribute: Chromium blurs a control the instant it becomes `disabled` and parks focus on `<body>` — documented in this repo's own `src/renderer/src/components/Dialog/CLAUDE.md` (*verified*). Styling hangs off `[aria-disabled='true']` with `--opacity-disabled` (`design-tokens.css:380`, *verified*).
- Details region: `role="region"`, `aria-label="Error details"`, explicit `tabIndex={0}` (it scrolls), `id` referenced by the toggle's `aria-controls`, toggle carries `aria-expanded`.
- Copy status is **persistent until the next action** (no timed revert); a repeat copy clears-then-sets the status string so screen readers re-announce.

**Colour contract.** Message text uses `--color-text-primary`; meta and stack text use `--color-text-secondary` (`#858585` on `#161312` ≈ 5.1:1) as the floor. `--color-text-muted` / `--color-text-disabled` / `--color-text-placeholder` all resolve to `#6e6e6e` ≈ 3.6:1 (*verified against `design-tokens.css:62-95`; matches the lens review's 3.63:1*) and are **forbidden** on this surface. `RootErrorBoundary.contrast.test.ts` recomputes the ratios from the shipping stylesheets, modelled on `Dialog.contrast.test.ts` — it does not hardcode the numbers above.

**Layout.** Fallback root is a class-scoped flex column, `max-height: 100vh`, `overflow-y: auto`; the action row does not shrink; the details region is capped at `40vh`. The 200 % zoom case is covered by a test row.

### 2.4 CSS ownership and the overlay-leak constraint

The renderer has one `index.html` entry shared with the screenshot-overlay window (`src/renderer/index.html`, *verified*), and `main.import-isolation.test.ts` exists because a global `html, body, #root` rule in a statically imported stylesheet once leaked a crosshair cursor into every window. `RootErrorBoundary.css` is guarded by an **allowlist**: after comment stripping, every top-level selector must start with `.root-error`. A denylist of three element selectors would not have caught, say, a bare `button {}`.

The fallback *references* `.dialog-btn`, `.dialog-btn-primary`, `.dialog-btn-secondary` from markup only. Those rules live in `Dialog.css`, which is statically bundled into the entry CSS and therefore already present at crash time; `RootErrorBoundary.css` never declares or overrides them, so the allowlist stays intact.

The structural fix — a separate HTML entry for the overlay window, mirroring the preload split — is out of scope and recorded in §8.

### 2.5 D — `backgroundColor`, framed honestly

`backgroundColor` on the main `BrowserWindow` (`src/main/index.ts:78-94`, *verified*) removes the unpainted-window flash. It does **not** fix the reported black window: the app background is `--color-brand-black` `#161312`, still near-black. The symptom fix is C. Do **not** add a background rule to `src/renderer/src/index.css:12-18` — that file is shared with the transparent overlay window.

### 2.6 E — instrumentation placement

**Renderer.** The flatten timing log lives in a `useEffect` keyed on the memo result, not inside the `useMemo` — a memo body must stay pure, and StrictMode double-invokes it in dev. `logger.info` above a 50 ms duration threshold, `logger.debug` below, payload `{ nodeCount, durationMs }`. The instrumentation test asserts payload shape, never call count.

**Main.** One module, `src/main/utils/rendererCrashHandlers.ts`, two exports:

- `registerAppCrashLogging()` — `app.on('render-process-gone')` + `app.on('child-process-gone')`, registered **once** in `app.whenReady()` (`index.ts:192`, *verified*). App-level registration covers the overlay windows, the PDF/DOCX render window and the DOCX `utilityProcess`, and removes the "does macOS `activate` re-register per window?" question entirely. Logged fields are `details.reason` and `details.exitCode` only — `killed` is a *value* of `reason`, not a field. *As shipped*, that "reason + exitCode only" rule describes `render-process-gone`; the `child-process-gone` handler additionally logs the process `type`, plus `serviceName` and `name` when Electron supplies them, because a dead child process is otherwise unidentifiable in the log.
- `registerWindowResponsiveness(win)` — `unresponsive` / `responsive`, per window, called from `createWindow`.

Log-only in both cases: no auto-reload, no dialog, no relaunch (boot-loop safety).

### 2.7 Restart safety

Restart is safe today only because auto-restore of the last project is disabled (`useProjectManagement.ts:75-81`, "Load last project on mount - DISABLED", *verified*) — otherwise relaunching after a crash caused *by* a project would reopen that project and re-crash. Rather than depend on that coupling, the Restart handler calls `window.api.file.closeProject()` best-effort inside `try/catch` before `relaunchApp()`: it clears `lastProjectPath` with no new IPC surface, its side effects are benign because `app.quit()` follows, and a rejection does not block the relaunch. The invariant is documented in the component docblock and in `docs/ui-components.md`, and pinned by a new renderer test (`useProjectManagement.noAutoLoad.test.ts`) — a main-process autorestore test cannot pin a renderer-side invariant.

### 2.8 E2E crash-injection plumbing

`ERFANA_E2E_FORCE_CRASH=1` in the launching environment → `src/main/index.ts` appends `additionalArguments: ['--erfana-force-crash']` to `webPreferences` (only when the app is not packaged, so a packaged build ignores the variable) → `src/preload/index.ts` reads `process.argv` and exposes `window.__ERFANA_FORCE_CRASH__` through `contextBridge` → a small flag-gated component in `src/renderer/src/App.tsx` throws during render. This mirrors the existing, already-shipped `additionalArguments` + `process.argv` overlay-token pattern (`ScreenshotOverlayWindow.ts:319`, `src/preload/screenshotOverlay.ts:45`, *verified*), so it introduces no new mechanism. The renderer cannot set the flag; only the process launcher can.

## 3. File table

**42 entries as shipped (19 create, 23 modify).** The designed set was 38 (**19 create, 19 modify**) — the header previously read "17 create, 21 modify", which was a miscount of this same table, not a different set of files. Four modify entries were added while implementing and are marked *added during implementation* below, so the table matches the commit. Two entries beyond the 36 agreed at seam-resolution are called out in §9: `ProjectPanel.tsx` (the mount point that must wrap the tree) and `src/preload/index.d.ts` (the type surface for the E2E flag).

| File (repo-relative) | Action | Description |
|---|---|---|
| `src/renderer/src/components/ProjectTree/ProjectTree.tsx` | modify | **Commit 1**: `useCallback` for `executePaste` / `handlePaste`, `handlePaste` added to the `:699` dep array. **Commit 3**: delete `enhancedFlattenedItems` (`:330-351`); destructure and use `findNode` / `findNodeWithRoot` at `:139`; repoint `:220`, `:476`, `:582`, `:666`, `:1143`, `:1391`; update deps at `:699`, `:1154`. Net line count decreases. |
| `src/renderer/src/hooks/useDragDropTree.ts` | modify | Explicit-stack `flattenTree`; **single-pass** memo returning `{ flattenedItems, nodeIndex }` (array + Map built in one loop, first-wins via inline `map.has`); named `findNode` / `findNodeWithRoot`; internal `findNode` and `getProjection` resolve via the index; optional trailing index param on the exported `getProjection`. |
| `src/renderer/src/hooks/useDragDropTree.test.ts` | modify | 200k reproduction, invariant-scan parity, ~20 000-level chain, index/staleness tests. |
| `src/renderer/src/components/ProjectTree/ProjectTree.lookup.test.tsx` | create | Stale-closure paste test, six repointed lookups, root-first precedence, rebuild-between-renders staleness. |
| `src/renderer/src/components/RootErrorBoundary/RootErrorBoundary.tsx` | create | `RootErrorBoundary` + colocated **distinct** `FallbackGuard` class; defensive detail extraction in `try/catch`; `logger.fatal` with componentStack + `__APP_VERSION__`, level-independent; guard path appends an inline-styled `document.body` sibling as last resort. |
| `src/renderer/src/components/RootErrorBoundary/RootErrorFallback.tsx` | create | `role="alertdialog"` fallback: copy deck, details disclosure, Restart / Copy / Open logs, single `role="status"` region, per-action capability checks, degraded mode. |
| `src/renderer/src/components/RootErrorBoundary/RootErrorBoundary.css` | create | Class-scoped (`.root-error*`) only; flex column, `max-height: 100vh`, `overflow-y: auto`, non-shrinking action row, details capped `40vh`; `[aria-disabled='true']` styling via `--opacity-disabled`; `border-radius: 0`; no new tokens; never declares `.dialog-btn*`. |
| `src/renderer/src/components/RootErrorBoundary/errorDetails.ts` | create | `buildErrorDetails(error, componentStack, version)` (stack truncated ~100 lines with a literal elision marker) and `formatErrorReport(details)` (~16 KB cap, well under `CLIPBOARD_MAX_TEXT_LENGTH` = 5 MB). |
| `src/renderer/src/components/RootErrorBoundary/RootErrorBoundary.test.tsx` | create | Boundary + guard behaviour, level-independent `logger.fatal`, emergency sibling path. |
| `src/renderer/src/components/RootErrorBoundary/RootErrorFallback.test.tsx` | create | Actions, a11y contract, status announcements, degraded mode, failure paths. |
| `src/renderer/src/components/RootErrorBoundary/errorDetails.test.ts` | create | Truncation, marker text, cap, hostile error objects. |
| `src/renderer/src/components/RootErrorBoundary/RootErrorBoundary.css.test.ts` | create | **Allowlist** guard: after comment stripping, every top-level selector starts with `.root-error`. |
| `src/renderer/src/components/RootErrorBoundary/RootErrorBoundary.contrast.test.ts` | create | WCAG 1.4.3 AA ratios recomputed from `design-tokens.css` + `RootErrorBoundary.css`, modelled on `Dialog.contrast.test.ts`. |
| `src/renderer/src/components/Panels/PanelErrorBoundary.tsx` | create | Generic panel-scoped boundary (EditorErrorBoundary shape + a `Reload` action and `componentName` prop). |
| `src/renderer/src/components/Panels/PanelErrorBoundary.test.tsx` | create | Renders children, catches, logs `error` (not `fatal`), reload resets state. |
| `src/renderer/src/components/Panels/ProjectPanel.tsx` | modify | Wrap `<ProjectTree/>` at its only mount point in `<PanelErrorBoundary componentName="Project tree">`. |
| `src/renderer/src/utils/installGlobalErrorTrail.ts` | create | `window` `error` + `unhandledrejection` → `logger.fatal` in boundary payload shape; idempotent. **As shipped it does not supersede the logger's own `error`-level pair** — both fire; see the correction in §2.3 and the follow-up in §8. |
| `src/renderer/src/utils/installGlobalErrorTrail.test.ts` | create | Both event types, payload shape, idempotence, no double-log. |
| `src/renderer/src/main.tsx` | modify | Call `installGlobalErrorTrail()` before the route branch; wrap **only** the `<App/>` branch (`:51-55`) in `<RootErrorBoundary>`, inside `<React.StrictMode>`. |
| `src/renderer/src/main.errorBoundary.test.ts` | create | Source-text invariants: App branch wrapped; overlay branch **not wrapped in the boundary** (the trail import is expected on both). |
| `src/renderer/src/App.tsx` | modify | Test-only component that throws in render when `window.__ERFANA_FORCE_CRASH__` is set. |
| `src/renderer/src/hooks/useProjectManagement.noAutoLoad.test.ts` | create | Pins "no auto-load of last project on mount" — the invariant Restart safety rests on. |
| `src/renderer/src/constants/testids.ts` | modify | `Root Error Boundary (7)`: `ROOT_ERROR_BOUNDARY`, `ROOT_ERROR_DETAILS_TOGGLE`, `ROOT_ERROR_DETAILS`, `ROOT_ERROR_BTN_COPY`, `ROOT_ERROR_BTN_LOGS`, `ROOT_ERROR_BTN_RESTART`, `ROOT_ERROR_STATUS`. `Panel Error Boundary (1)`: `PANEL_ERROR_BOUNDARY`. |
| `src/renderer/src/constants/testids.test.ts` | modify | Two new count tests (7 / 1); prefixes `ROOT_ERROR` and `PANEL_ERROR` verified not to collide with the existing `EDITOR_ERROR` filter (`:157`). |
| `src/renderer/src/styles/utilities.css` | modify | Add `.root-error-details`, `.root-error-meta` to the `user-select: text` list (`:30-49`). |
| `src/renderer/src/styles/userSelect.audit.test.ts` | modify | Two new `AUDIT_211_SURFACES` rows. |
| `src/preload/index.ts` | modify | Read `--erfana-force-crash` from `process.argv`; expose `window.__ERFANA_FORCE_CRASH__` via `contextBridge`. |
| `src/preload/index.d.ts` | modify | Declare the optional `__ERFANA_FORCE_CRASH__` global. |
| `src/main/utils/rendererCrashHandlers.ts` | create | `registerAppCrashLogging()` (app-level `render-process-gone` + `child-process-gone`, `reason` + `exitCode`) and `registerWindowResponsiveness(win)` (`unresponsive` / `responsive`). |
| `src/main/utils/rendererCrashHandlers.test.ts` | create | Both exports: registration, payload fields, single registration, no side effects. |
| `src/main/index.ts` | modify | `backgroundColor` in the `BrowserWindow` options; `registerAppCrashLogging()` in `whenReady`; `registerWindowResponsiveness(mainWindow)` in `createWindow`; unpackaged-only `additionalArguments` for the E2E flag. |
| `src/main/index.test.ts` | modify | Assert `'backgroundColor' in options`; assert both registrations; add `fatal: vi.fn()` to the `LoggingService` logger mock (`:220-225`). |
| `vitest.main.ts` | modify | Per-file coverage floor for `src/main/utils/rendererCrashHandlers.ts` (enforced by the main-scoped Coverage job). |
| `e2e/root-error-boundary.e2e.ts` | create | Launch with `ERFANA_E2E_FORCE_CRASH=1`; assert `TEST_IDS.ROOT_ERROR_BOUNDARY` visible instead of an empty body. Modelled on `e2e/app-launch.e2e.ts`. |
| `docs/ui-components.md` | modify | Two-tier boundary contract, fallback copy deck + a11y contract, Restart-safety invariant. |
| `docs/known-issues.md` | modify | Replace/annotate the large-project crash entry; state the limits still owned by #149/#150. |
| `docs/large-project-performance-plan.md` | modify | Record #60's crash fix and the deferral list with owners. |
| `docs/CHANGELOG.md` | modify | Fix entry. |
| `src/shared/constants.ts` | modify | *Added during implementation.* `LOGS_DIR_RELATIVE` (`.erfana/logs`), so the degraded-mode log location and `LoggingService.getLogsDir()` read the same literal, and `FORCE_CRASH_ARG` (`--erfana-force-crash`), so both halves of the §2.8 handshake spell the flag identically. |
| `src/main/services/LoggingService.ts` | modify | *Added during implementation.* `LOGS_DIR` now derives from the shared `LOGS_DIR_RELATIVE` rather than an inline literal (`LoggingService.ts:33-38`). |
| `src/preload/index.test.ts` | modify | *Added during implementation.* Preload-suite maintenance alongside the §2.8 argv read (`index.ts:1122`, `forceCrash`). |
| `docs/technical-debt.md` | modify | *Added during implementation.* Entries #18–#23 from the change-set reviews: dead `useDragDropTree` API surface, inert `vitest.renderer.ts` coverage block, `test:cov` workspace fan-out, no tsconfig over `e2e/`, shared renderer HTML entry, `ThrottledWorker.workMany`. |

New `.ts` / `.tsx` / `.css` files each need the SPDX header pair — `scripts/check-spdx-headers.mjs` enforces `.ts .tsx .js .mjs .cjs .css` and the `license` job is a required check.

**Recorded deviations from the ~500-line-per-file guideline.** Two test files ship over it, both deliberately:

| File | Lines | Why it stays whole |
|---|---|---|
| `src/renderer/src/hooks/useDragDropTree.test.ts` | 887 | Carries the 200k reproduction, the O(n) invariant scan, the ~20 000-level depth chain and the index/staleness suites against one hook. Splitting separates the reproduction from the parity assertions that give it meaning. |
| `src/renderer/src/components/RootErrorBoundary/RootErrorFallback.test.tsx` | 574 | Per-describe `vi.useFakeTimers` with a substrate-specific `shouldAdvanceTime` recipe (documented in its docblock). The repo's split policy keeps per-`describe` fake-timer suites in one file and splits only when mocks hoist to module scope — see `docs/windows/contributing.md` §"Test-file split policy". |

## 4. Implementation sequence

1. **`handlePaste` dependency fix** — `useCallback` for `executePaste` + `handlePaste`, added to the `:699` deps, with the stale-closure behavioural test. Separate commit, before any lookup change.
2. **Flatten rewrite + single-pass index** — failing 200k test first, then the loop, then the invariant-scan parity suite and the ~20 000-level chain.
3. **Named lookups + ProjectTree repoint** — `findNode` / `findNodeWithRoot` used at `:139`, six call sites repointed, `enhancedFlattenedItems` deleted, staleness + root-precedence tests. Separable commit (§9).
4. **Boundary set + global trail** — `PanelErrorBoundary` + `ProjectPanel` wrap; `RootErrorBoundary` + distinct `FallbackGuard` + emergency sibling; `installGlobalErrorTrail` + `main.tsx` wiring + source-text invariants.
5. **Fallback UI** — copy deck, `role="alertdialog"` contract, single status region, `aria-disabled` Restart, details region, degraded mode, `closeProject()`-before-`relaunchApp()`.
6. **Main process** — `rendererCrashHandlers` (both exports) + `backgroundColor` + `index.test.ts` updates.
7. **Instrumentation and guards** — flatten `useEffect` log with threshold; CSS allowlist test; contrast test; `vitest.main.ts` coverage glob; fake-timer recipe applied; `useProjectManagement.noAutoLoad.test.ts`.
8. **E2E plumbing** — env → `additionalArguments` → preload flag → `App.tsx` thrower → `e2e/root-error-boundary.e2e.ts`.
9. **Docs** — `ui-components.md`, `known-issues.md`, `large-project-performance-plan.md`, `CHANGELOG.md`.
10. **Full battery + UAT.** `npm run lint && npm run typecheck && npm run test:ci && npx electron-vite build`, then `npm run test:e2e` locally (CI's `e2e.yml` is disabled, so this suite runs **only** on the developer machine — stated plainly because AC-4/AC-5 lean on it). UAT checklist, **owner: operator**:
    - (a) reopen the same 174k-node external-volume project — tree renders, no blank window (**AC-4**);
    - (b) open a small project — tree, drag-drop, cut/copy/paste, Cmd+Shift+I unchanged (**AC-5**);
    - (c) drag a file onto a folder and onto a top-level file — both land correctly;
    - (d) force the crash flag — fallback appears; Copy, Open logs, Restart each work; app reopens on the welcome screen, not the crashing project;
    - (e) confirm two "flatten completed" lines within 3 s at open, or their absence (feeds the §8 trigger).

## 5. Test strategy

**Coverage.** `src/main/utils/rendererCrashHandlers.ts` gets an enforced per-file floor in `vitest.main.ts` (the main Coverage job is a required check). The renderer target of >80 % on the new components is a **review-time expectation only**: `vitest.renderer.ts` declares its `coverage` block as a sibling of `test` rather than inside it, so it is inert — the same misplacement #55 F4 fixed for the main project. Recorded as a §8 follow-up.

| Change | Tests |
|---|---|
| `handlePaste` deps | Behavioural stale-closure test: select folder A, `Cmd+V`; change selection/clipboard without triggering a tree rebuild; `Cmd+V` again resolves the **current** state, not the first render's. |
| `flattenTree` (repro) | **One directory node whose `children` array holds 200 000 entries, passed as `flattenTree([dir])`.** A flat root array of 200k files executes zero spread and reproduces nothing. Assert `not.toThrow()`, `length === 200_001`, and shape locks: `flattened[0].type === 'directory'`, `flattened[1].parentId === dirPath`, `flattened[1].depth === 1`. A comment records the observed pre-fix `RangeError` with node/vitest/pool versions. |
| `flattenTree` (parity) | O(n) **invariant scan** over the 200k result, asserted to produce an empty violation list: every entry's `parentId` matches its frame, `depth` equals ancestor count, sibling `index` runs 0..n-1 per parent, pre-order position is monotonic. Plus the existing 2–4 node fixtures (`:16-96`) passing verbatim, a hand-written deep-equal on a mixed tree, `children: undefined`, `children: []`, files-only tree. Config-independent weight lives here, not in the RangeError observation. |
| `flattenTree` (depth) | Chain of ~20 000 levels does not throw. (500 levels passes on pre-fix code and would prove nothing.) |
| Index + lookups | First-wins on duplicate paths; miss returns `undefined`; `findNodeWithRoot` checks the synthetic root **before** the Map; `findNode` does **not** resolve the root (cut/copy stays root-safe); single-pass memo returns both structures from one loop. |
| Index staleness | (a) Re-render the hook with a mutated `files`: a removed path misses, an added path hits. (b) In `ProjectTree.lookup.test.tsx`, rebuild the tree between renders and assert the keydown handler resolves the **current** selection. |
| Drop parity | Drop a file onto a top-level file → `targetParent === projectPath` (pins `rootFolderNode.path === projectPath`); drop onto a folder → the folder itself. |
| `errorDetails.ts` | Stack truncated ~100 lines with the literal marker text; report ≤ 16 KB; `error.stack` getter that throws is survived; non-`Error` thrown value (string / `undefined` / object) yields a usable report. |
| `RootErrorBoundary` | Renders children when healthy; renders fallback on child throw; `logger.fatal` fires with componentStack + version **regardless of configured level**; `logger.fatal.mockImplementation(() => { throw … })` → fallback still renders and nothing propagates; **guard path**: mock `RootErrorFallback` to throw → guard's static text renders, nothing escapes past `RootErrorBoundary`; seeded `#root` with a child **and** a throwing fallback → inline-styled sibling text present on `document.body`; `document.body.appendChild` made to throw → no throw escapes. Suppress `console.error` per `EditorErrorBoundary.test.tsx:33-41`. |
| `PanelErrorBoundary` | Renders children; catches a tree throw and shows "Project tree unavailable"; logs at `error`, not `fatal`; Reload clears the error state; the rest of the app tree stays mounted. |
| `installGlobalErrorTrail` | `error` and `unhandledrejection` both reach `logger.fatal` with the boundary payload shape; installing twice registers once; a boundary-caught error is not double-logged. |
| Fallback — a11y | Container exposes `role="alertdialog"` + `aria-modal` and **has a non-empty accessible name** (`toHaveAccessibleName`), and holds focus on mount; details toggle flips `aria-expanded` and `aria-controls` resolves to a `role="region"` named "Error details" with `tabIndex={0}`; there is exactly one live region. |
| Fallback — Restart | Click → `window.api.file.closeProject()` then `window.api.system.relaunchApp()`; button gets `aria-disabled="true"` (never the `disabled` attribute) and **focus stays on the button**; the status region announces "Restarting Erfana…"; after 3 s it announces the manual-quit guidance; `relaunchApp` rejecting re-enables the button and announces the failure; `closeProject` rejecting does not block the relaunch; the 3 s timer is cleared on unmount. |
| Fallback — Copy | Copy → `textClipboard.writeText` with the capped report; status announces; copying twice announces twice (clear-then-set); status is persistent until the next action; a rejected write announces failure. |
| Fallback — capability | Per-action `typeof window.api?.system?.relaunchApp === 'function'` guards: a partial bridge disables only the affected action; with `window.api` absent, degraded mode offers **at least one operable recovery instruction** and a selectable log-folder path instead of dead buttons. |
| Fallback — timers | Recipe for every timed row: `vi.useFakeTimers()` / `vi.useRealTimers()` per test, `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`, and advance inside `await act(...)`. |
| Fallback — layout | Long stack + narrow viewport: the action row stays visible (non-shrinking) and the details region scrolls; repeated at a 200 % zoom equivalent. |
| CSS guards | Allowlist: after comment stripping, every top-level selector in `RootErrorBoundary.css` starts with `.root-error`. Contrast: recomputed ratios ≥ 4.5:1 for message and meta text; the three forbidden tokens are absent from the file. |
| TEST_IDS | Two new count tests (7 / 1); existing uniqueness / kebab-case / SCREAMING_SNAKE suites pass unchanged. |
| user-select audit | Two new `AUDIT_211_SURFACES` rows. |
| `main.tsx` | Source text: the App branch is wrapped in `<RootErrorBoundary>`; the **overlay branch is not wrapped in the boundary**; `installGlobalErrorTrail()` is called before the branch. |
| Main handlers | `registerAppCrashLogging()` registers `render-process-gone` + `child-process-gone` on `app` exactly once and logs `details.reason` + `details.exitCode` (no `killed` field); `registerWindowResponsiveness(win)` registers `unresponsive` / `responsive`; neither reloads, destroys, nor relaunches. |
| `index.test.ts` | `'backgroundColor' in mockBrowserWindow.mock.calls[0][0]` (no hex literal — the value is a design-token concern owned by the contrast/token layer); both registrations wired. |
| Instrumentation | Payload shape `{ nodeCount: number, durationMs: number }` and the info/debug threshold split; **never** an assertion on call count. |
| `useProjectManagement` | No auto-load of the last project on mount; `initialLoadComplete` is set immediately. |
| E2E (local only) | Launch with `ERFANA_E2E_FORCE_CRASH=1`; `TEST_IDS.ROOT_ERROR_BOUNDARY` is visible; the body is not empty. Condition-based waits only. |

## 6. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 200k fixture is slow / memory-heavy on the runner | medium | medium | Plain loop construction, invariant scan instead of deep-equal, one big case. Keep ≥150k if ever trimmed — the limit is ~10^5. |
| B2 changes a subtle drag / clipboard behaviour | medium | high | Named lookups keep root policy in one module; parity, precedence and staleness tests per call site; step 3 is a separable commit. |
| Stale-closure fix changes paste behaviour under rapid selection changes | low | high | Behavioural test drives the real keydown path; `useCallback` deps enumerated from the read source, not guessed. |
| `RootErrorBoundary.css` leaks into the overlay window | low | high | Class-scoped + allowlist guard; emergency path is inline-styled; structural fix deferred with an owner (§8). |
| Fallback itself throws | low | high | Distinct `FallbackGuard` boundary (React cannot route a fallback error to its own boundary) + `document.body` sibling; three test rows including an `appendChild` failure. |
| Boundary hides errors that used to surface in dev | medium | low | `logger.fatal` is level-independent; global trail records async paths; React still logs to console in dev. |
| Duplicate fatal lines in dev (React re-throws to `window` after `componentDidCatch`) | high (dev only) | low | Accepted and documented in §1; the trail is idempotent and does not double-log a boundary-caught error. `componentDidCatch` is **not** StrictMode-double-invoked; the `useMemo` is, which is why the timing log moved to an effect. |
| Buffered Enter restarts the app the moment the fallback appears | low | high | Focus lands on the labelled container, never on Restart; `aria-disabled` (not `disabled`) keeps focus stable after activation. |
| E2E crash flag reachable in a shipped build | low | medium | Main appends the argument only when the app is unpackaged **and** the env var is set; the renderer cannot set it; mirrors the shipped overlay-token pattern. |
| `index.test.ts` logger mock lacks `fatal` | high | low | Added in the same commit. |
| `render-process-gone` fires during E2E teardown, adding log noise | medium | low | Log-only, greppable message tag. |
| Latent twin `ThrottledWorker.workMany` (`ThrottledWorker.ts:123`) has the same `push(...items)` shape | low | medium | **Verified to have no production callers** (two test call sites only). Follow-up note, §8. |
| Fix addresses the dominant stage only — a 174k project still opens slowly | high | medium | Explicit deferral (§8) plus the new timing log so the next report carries data. |

## 7. Effort

| Block | Estimate |
|---|---|
| 1 — handlePaste dep fix + stale-closure test | 1–1.5 h |
| 2 — flatten rewrite + single-pass index + invariant-scan suite | 2–2.5 h |
| 3 — named lookups + repoint + staleness/precedence tests | 2–3 h |
| 4 — boundary set (root + guard + panel) + global trail + wiring tests | 4–5 h |
| 5 — fallback UI, a11y contract, copy deck, degraded mode, restart safety | 4–5 h |
| 6 — main-process handlers + backgroundColor + tests | 1.5–2 h |
| 7 — instrumentation, CSS allowlist, contrast test, coverage glob, noAutoLoad test | 2–2.5 h |
| 8 — E2E plumbing + spec | 1.5–2 h |
| 9–10 — docs, full battery, E2E, UAT | 2–2.5 h |
| **Total** | **≈ 21–26 h (3 days)** — complexity: **medium-high** |

Files: 42 as shipped (19 create, 23 modify) — see §3. The QG-4a findings roughly doubled the original 13–16 h estimate, almost entirely in the containment and accessibility layers.

## 8. Out of scope — deferrals, each with an owner

The structural rows below are also carried in [`docs/technical-debt.md`](../technical-debt.md) as entries #18–#23, which is where they will be picked up from.

| Deferred item | Owner | Rationale / trigger |
|---|---|---|
| Duplicate uncaught-error records — a `fatal` line from the trail *and* an `error` line from `RendererLogger.installErrorHandlers()` | `logger.ts` housekeeping | The trail cannot suppress the logger's pair without `stopImmediatePropagation()`, which would kill every `error` listener registered after it. Collapse the two where they are registered, not where they are observed (§2.3). |
| List virtualization of the project tree | #149/#150 | Rendering is already bounded by expansion state (`ProjectTreeNode.tsx:256`); virtualization is a TTI / scroll concern, not the crash. |
| Lazy / on-demand directory loading | #149/#150 | Requires a FileService + IPC contract change. |
| ≤2 s TTI budget | #149/#150 | Scan 2.0 s + IPC clone 1.2 s dominate; untouched here. |
| Cancelable project open | #149/#150 | Needs cancellation plumbing through `FileService` / IPC / store. |
| `React.memo` on `ProjectTreeNode` (verified absent) | #149/#150 | Pure re-render cost. |
| Double tree build within 3 s at open | #149/#150, **triggered** | **Trigger**: two `[ProjectTree] flatten completed` lines within 3 s of an open, observed via the new instrumentation ⇒ file the watcher/open dedup against #149/#150. Step 10(e) of the UAT checklist collects the observation. |
| Separate HTML entry for the overlay window (mirroring the preload split) | build-config housekeeping | Removes the shared-entry CSS-leak class permanently; the allowlist guard is the interim control. |
| `vitest.renderer.ts` coverage block declared outside `test` (inert) | test-config housekeeping | Same misplacement #55 F4 fixed for main; until then, renderer coverage targets are review-time only. |
| B1 — flatten the filtered tree | follow-up note on #60 | No benefit in the default `all` mode; changes `selectedFolder` lookup semantics in `markdown` mode (§2.2). |
| `ThrottledWorker.workMany` spread-push | follow-up note on #60 | Same defect class, no production caller today. |

## 9. Architect verification

### Acceptance criteria

| # | Criterion | Disposition |
|---|---|---|
| 1 | ≤2 s TTI | **Deferred** to #149/#150 — the measured cost is scan + IPC, outside the approved "fix the dominant stage" scope. §8. |
| 2 | Cancelable open | **Deferred** to #149/#150 — needs cancellation plumbing. §8. |
| 3 | Full tree fidelity | **Unaffected and protected.** No truncation, filtering or capping; the rewrite is output-identical and the O(n) invariant scan locks pre-order, forward sibling order, `depth`, `parentId`, per-parent `index`. B1 (which *would* have narrowed the lookup set) was rejected. |
| 4 | External volume | **Resolved by diagnosis** (APFS; node scale, not volume type) and now **enforced**: the 200k unit reproduction, the crash-flag E2E scenario, and UAT step 10(a) reopening the same 174k project (owner: operator). Enforcement runs locally — CI's `e2e.yml` is disabled. |
| 5 | No small-project regression | **Covered** — existing `useDragDropTree.test.ts` fixtures pass verbatim, plus lookup parity/precedence/staleness tests, the stale-closure paste test, the existing `ProjectTree.*` / `ProjectTreeNode` suites, the local `--project=electron` battery, and UAT step 10(b). |

### Pattern alignment

Boundary classes follow `EditorErrorBoundary` / `GitErrorBoundary`; `PanelErrorBoundary` sits beside its consumer, as `GitErrorBoundary` does. Co-located global CSS with tokens and `border-radius: 0`; contrast test modelled on `Dialog.contrast.test.ts`; `aria-disabled`-over-`disabled` follows this repo's own `Dialog/CLAUDE.md`; TEST_IDS centralised with the count-test convention; `(window as any).api` mocking, never `vi.stubGlobal('window', …)`; source-text invariant tests follow `main.import-isolation.test.ts`; E2E flag reuses the shipped `additionalArguments` + `process.argv` overlay-token mechanism; main-process handlers extracted to `src/main/utils/` rather than growing `index.ts` (428 lines), consistent with the extract-don't-extend rule for the oversized `ProjectTree.tsx` (1422 lines) — which this plan **shrinks**.

### API verification

Every API called was read in-tree: `window.api.system.relaunchApp` (`src/preload/index.ts:682`), `window.api.file.closeProject` (`ProjectTree.tsx:250` call site), `window.api.logging.openLogsFolder` (`src/preload/index.ts:906`), `textClipboard.writeText` + its 5 MB cap (`src/shared/ipc/clipboard-schema.ts:20`), renderer `logger.fatal` (`logger.ts:103`), main `logger.fatal` (`LoggingService.ts:564`), `__APP_VERSION__` (`vite-env.d.ts:13`, mirrored in `vitest.renderer.ts:12`), `--opacity-disabled` (`design-tokens.css:380`), `app.whenReady()` (`index.ts:192`), `additionalArguments` (`ScreenshotOverlayWindow.ts:319`).

### Two file-table additions beyond the agreed 36

- `src/renderer/src/components/Panels/ProjectPanel.tsx` — `PanelErrorBoundary` must wrap `<ProjectTree/>` at its only mount point; without this edit F2 has no effect.
- `src/preload/index.d.ts` — the E2E flag needs a type declaration where the other bridge types live (`:303`).

### Carried implementation conditions

1. **Step 3 (B2) stays a separable commit** so it can be dropped at review without touching the crash fix.
2. **The 200k fixture is one directory node with 200 000 children**, passed as `flattenTree([dir])` — a flat root array reproduces nothing.
3. **The index is built in one pass**: a single `useMemo` returns `{ flattenedItems, nodeIndex }` from the same loop, first-wins via inline `map.has`; no second traversal.
4. **`FallbackGuard` is always a distinct boundary class** — colocation in `RootErrorBoundary.tsx` is allowed, merging into one class is not.
5. **The emergency write never targets `#root`** — inline-styled sibling appended to `document.body`, from the guard path only.
6. **The flatten timing log lives in an effect, not the memo**, and no test asserts its call count.
7. **`ProjectTree.tsx:139` must destructure and use the named lookups**, or the hook API is dead code.
8. **The `handlePaste` dependency fix lands first**, as its own commit, before any lookup change.

### QG-11a remediation round (as shipped)

A QG-11a review round landed on top of the design above, all of it inside the approved scope. The containment layers picked up a single-alert guard channel (so the last-resort text is announced once, not twice), focus and announcement corrections in the panel boundary, a timeout on the restart race, a console-message trail in the entry module, and a log-location fallback for the overlay window; outside containment, the project tree's expansion-seed blocker was fixed. A closing micro-round then settled the announcement channels to exactly one per surface (the panel fallback dropped its `role="alert"`, keeping the focused Reload button's description; the emergency body sibling takes focus only when no guard alert reached the document) and rate-capped the renderer console-error trail at 20 records per window per 10 s, with one summary line carrying the dropped count — an error loop must not push the crash that started it out of the log rotation. Nothing here changes a contract stated above — treat the passages marked *as shipped* as the current reading.

### Verdict: APPROVED

All 31 findings are resolved in-plan (§10); one is partially disputed on a factual point and resolved anyway (F19's characterisation of the pre-fix depth behaviour — see the dispute note in the resolution record). No finding is deferred without an owner, and every prescribed structural follow-up is recorded in §8.

## 10. QG-4a resolution record

| # | Finding | Resolved by |
|---|---|---|
| F1 | Guard cannot live in the same boundary | §2.3 + §3 (`RootErrorBoundary.tsx`): distinct `FallbackGuard` class, `{hasError ? <FallbackGuard><RootErrorFallback/></FallbackGuard> : children}`, dependency-free static fallback; §5 guard test row; §9 condition 4 |
| F2 | Root-only boundary too coarse | §1 layer table, §2.3 two-tier contract, §3 `PanelErrorBoundary.tsx` + test + `ProjectPanel.tsx` wrap, §5 PanelErrorBoundary rows, `docs/ui-components.md` |
| F3 | False B2 justification; missing `handlePaste` dep | §2.2 justification withdrawn in writing; prerequisite `useCallback` fix as sequence step 1; §5 stale-closure row; named lookups replace the raw Map; §9 condition 8 |
| F4 | Error-trail gaps; StrictMode claim wrong | §1 layer coverage table + softened guarantee; §2.3 `installGlobalErrorTrail`; §3 module + test; §6 StrictMode row rewritten (`componentDidCatch` not double-invoked; `useMemo` is); §5 level-independent `logger.fatal` row |
| F5 | `#root` textContent write fights React | §2.3 emergency write moved to an inline-styled `document.body` sibling, guard path only; §5 three rows (fatal throws, seeded-root + fallback throw, `appendChild` failure); §6 old `#root` risk rows removed |
| F6 | Fixture false-green | §5 repro row restated as one directory node with 200 000 children via `flattenTree([dir])`, shape-lock asserts, pre-fix `RangeError` recorded in a comment; §9 condition 2 |
| F7 | Missing staleness tests | §5 "Index staleness" row (hook re-render with mutated `files`; ProjectTree rebuild between renders) |
| F8 | AC-4/AC-5 unenforced | §2.8 plumbing, §3 `e2e/root-error-boundary.e2e.ts` + `App.tsx` + preload + `index.ts`, §4 step 8 and step 10 UAT checklist (owner: operator), §5 E2E row stating CI e2e is disabled |
| F9 | Index construction unspecified | §2.2 + §3 single-pass memo returning `{ flattenedItems, nodeIndex }`, inline `map.has`; §9 condition 3 |
| F10 | Double-rebuild deferral has no trigger | §8 triggered row ("two flatten-completed lines within 3 s at open"), collected by UAT step 10(e) |
| F11 | Fallback role/naming | §2.3 `role="alertdialog"` + `aria-modal` + `aria-labelledby` + `aria-describedby`, separate `role="alert"` block dropped; §5 `toHaveAccessibleName` row |
| F12 | Restart/3 s messages not announced | §2.3 single `role="status"` region carries copy result, "Restarting Erfana…", and the 3 s guidance; §5 Restart row |
| F13 | `disabled` attribute blurs focus | §2.3 `aria-disabled` + early-return `onClick`, `[aria-disabled='true']` styling with `--opacity-disabled`, citing `Dialog/CLAUDE.md`; §5 "focus stays on the button" row |
| F14 | Contrast tokens unspecified | §2.3 colour contract (`--color-text-primary` / `--color-text-secondary` floor; three tokens forbidden, `#6e6e6e` ≈ 3.6:1 verified); §3 `RootErrorBoundary.contrast.test.ts` |
| F15 | Internal lookups bypass the index | §2.2: hook-internal `findNode` and `getProjection` resolve via the index; exported `getProjection` gains an **optional** trailing index param so the six 4-arg tests pass; `:141` walk stays positional |
| F16 | Log inside `useMemo` | §2.6 moved to a `useEffect` keyed on the result, info above 50 ms / debug below; §5 payload-shape-only assertion |
| F17 | Fake-timer recipe unspecified | §5 "Fallback — timers" row: per-test `useFakeTimers`/`useRealTimers`, `userEvent.setup({ advanceTimers })`, advance inside `await act(...)`; applies to the 3 s and copy-status rows |
| F18 | Coverage unenforceable | §3 + §5: per-file floor for `rendererCrashHandlers.ts` in `vitest.main.ts`; renderer 80 % stated as review-time only; `vitest.renderer.ts` misplacement recorded in §8 with an owner |
| F19 | Spot-checks weak; 500-level chain meaningless | §5 O(n) invariant scan asserted empty over the 200k result; depth chain raised to ~20 000 (dispute note below) |
| F20 | Root precedence unpinned | §2.2 root-first precedence stated; §5 drop-parity row asserting `targetParent === projectPath`; §3 `:139` must use the named lookups |
| F21 | Bridge assumed whole; no failure paths | §2.3 + §5: per-action `typeof` capability checks, `try/catch` + `.catch` re-enabling the button and announcing failure, 3 s timer cleared on unmount, "relaunch rejects" row |
| F22 | Copy-status revert unspecified | §2.3 persistent-until-next-action, clear-then-set; §5 "copy twice announces twice" row |
| F23 | Details region not addressable | §2.3 `role="region"` + `aria-label="Error details"` + `tabIndex={0}` + `aria-controls`; literal elision marker text; §5 accessible-name row |
| F24 | No copy deck; raw error in headline | §2.3 copy deck table, `error.message` demoted into details, degraded mode shows instructions + selectable log path; §5 "at least one operable recovery instruction" row |
| F25 | Handler fields and registration scope | §2.6 one module, `registerAppCrashLogging()` (app-level, once in `whenReady`, `reason` + `exitCode` only) + `registerWindowResponsiveness(win)`; §3 rename across source and test |
| F26 | CSS denylist too weak | §2.4 allowlist (every top-level selector starts with `.root-error`, comments stripped) + the `.dialog-btn` markup-only seam; §8 overlay-entry follow-up with an owner |
| F27 | Restart safety coupled to a disabled auto-restore | §2.7 `closeProject()` before `relaunchApp()` (best-effort, non-blocking) **and** documentation of the invariant; §3 new `useProjectManagement.noAutoLoad.test.ts` (renderer-side, replacing the proposed main-process edit) |
| F28 | O(1) overclaim | §2.2 "amortized O(1) on V8 (the spec guarantees sublinear)" |
| F29 | Map footprint unstated | §2.2 retained-footprint sentence (~174k lightweight entries replacing ~174k spread objects) |
| F30 | Hex literal in the window test | §5 `index.test.ts` row asserts `'backgroundColor' in options` only |
| F31 | Fallback layout unspecified | §2.3 layout paragraph + §3 CSS row (flex column, `max-height: 100vh`, `overflow-y: auto`, non-shrinking actions, details capped `40vh`); §5 layout row including the 200 % zoom case |

**Dispute (partial), F19.** The remediation is adopted in full — the invariant scan is added and the chain test is raised to ~20 000 levels. The finding's stated reason ("500 passes on pre-fix code") is right for the wrong mechanism: 500 levels passes because *neither* the pre-fix nor the post-fix implementation is depth-limited at that size, and the pre-fix failure mode is argument count, not call depth. A ~20 000-level chain is worth keeping because it pins that the *rewrite* did not trade a width limit for a depth limit — not because it reproduces the original bug. The test's docblock states that distinction so a future reader does not mistake it for a second reproduction.
