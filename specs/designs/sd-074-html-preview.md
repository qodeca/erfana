# Design: HTML preview with CSS and JavaScript execution

**Issue**: [#74](https://github.com/qodeca/erfana/issues/74) | **Branch**: `feature/74-html-preview` off `develop` | **Tier**: 2 | **Complexity**: complex

Revision 5 — round 1 addressed QG-4a X1–X22; round 2 the QG-4b judge verdicts; round 3 the
verification review (NEW-1…NEW-14 + the dependency-graph rebuild); round 4 the double-CSP-application
bug and its adjacent wording. Verified library facts carry a file:line citation.

---

## 0. Overview

A `.html` file opens as a **running page** in a dockview tab: a `WebContentsView` in its own process,
on its own in-memory session partition, with no preload and no node integration. Local files reach it
only through `erfana-preview://<opaque-root-token>/<path>`, realpath-confined to the project root and
refusing dot-prefixed and build-output directories. Remote subresources are gated by **two**
independent chokepoints — a host-listed CSP built from the project allowlist, and an unfiltered
`onBeforeRequest` handler.

**The isolation boundary, stated honestly.** Erfana exposes **no scripted API to the page**: no
preload, no `postMessage` endpoint, no bridge, no file-write path. The page's only influence is a
bounded set of **diagnostic signals**, each treated as untrusted data — never executed, never
reflected into a response header, always length-bounded and control-character-stripped:

| Signal | Source | Bound |
|---|---|---|
| Console messages | `console-message` | 512 chars, pure classifier |
| Load failures | `did-fail-load` | fixed error-code set |
| Request metadata | `onBeforeRequest` / `onErrorOccurred` | hostname only retained |
| `found-in-page` counts | Chromium find API | two integers |
| CSS-swap return value | `executeJavaScriptInIsolatedWorld` | one boolean, timeout-bounded |
| Enumerated keystrokes | `before-input-event` | closed list of 4 accelerators (§1.9) |

**Every renderer-bound emission on a page-drivable path is coalesced, and the reload pipeline itself
is rate-limited.** A page that runs `while(1) location.reload()` would otherwise drive, per iteration,
an entry-HTML read, a parse5 parse, up to 16 `confinePath` realpaths, watcher acquire/release churn, a
still-frame invalidation and a `loadStateChanged` send. §1.4 specifies the limiter. (Revision 3 said
"emission is rate-bounded so a page cannot use these as a denial-of-service channel" while coalescing
only failures and host toasts — stated more confidently than the mechanism supported. Corrected.)

Three structural choices carry the design:

1. **No filesystem path ever enters a URL.** An opaque per-project token is the URL host.
2. **Storage is blocked by `sandbox allow-scripts` in the CSP header** — a header-only directive
   giving an opaque origin, where `localStorage`/`sessionStorage` throw and `indexedDB` is
   unavailable. §2.7 confirms this does not break AC6.
3. **A preview-owned watcher pool**, separate from `FileWatcherService`, which has no in-process
   subscription API and whose 300 ms debounce alone breaks AC24.

---

## 1. Component architecture

Conventions: interface + class + factory + singleton (`ExternalFileService.ts:39/75/591/596`);
disposable handler bundles (`claude-status-handlers.ts:167-290`); `*-channels.ts` + `*-schema.ts`
pairs; the `Panels/ImageViewerPanel/` layout; SPDX header on every new file.

### 1.1 Protocol and path confinement

| Module | Key surface |
|---|---|
| `preview/previewScheme.ts` | `PREVIEW_SCHEME`, `registerPreviewScheme(): void` |
| `preview/PreviewRootRegistry.ts` | **Owns the token AND its CSP** — `issue(projectPath, hosts)`, `resolve(token): PreviewRootEntry \| null`, `rebuildCsp(projectPath, hosts)`, `revoke`, `clear` |
| `preview/previewPathResolve.ts` | `resolveConfined(realRoot, segments)`, `confinePath(realRoot, candidate)`, `isSafeSegment(s)` |
| `preview/previewCsp.ts` | `buildPreviewCsp(hosts): string` |
| `preview/previewResponseHeaders.ts` | `mimeForExtension`, `isKnownAssetType`, `buildResponseHeaders(contentType, csp)` |
| `preview/PreviewProtocolHandler.ts` | `attach(session, ctx): () => void` |

```ts
/** The CSP travels WITH the token and is applied at exactly ONE site: `buildResponseHeaders`
 *  in the protocol handler (§2.5). There is NO `onHeadersReceived` overwrite — the second
 *  application site is deleted (round-4 option b), so there is nothing to leave unwired or to
 *  drift out of sync. */
export interface PreviewRootEntry {
  readonly realRoot: string       // fsPromises.realpath of the project root
  readonly projectPath: string
  readonly csp: string            // built by buildPreviewCsp from the loaded allowlist
}
```

**Why the registry owns the CSP** (NEW-3). Revision 3 passed the CSP to `buildResponseHeaders` as a
plain parameter with no producer anywhere in the protocol handler's dependency set: §2.2's token entry
had no CSP field, §5(a)'s factory attached the handler before the token existed, and item 16's deps
contained no CSP producer and no path to the allowlist store. Nothing prevented an **empty CSP string
reaching `buildResponseHeaders`** — the exact hole X2b was filed to close. The CSP is now a field of
the entry the handler already resolves per request, and the wiring is `previewCsp → registry →
protocol handler` with real edges (§7 items 12 → 14 → 20).

**`buildResponseHeaders` rejects an invalid CSP** rather than serving an unprotected page:

```ts
/** Throws PREVIEW_CSP_INVALID unless `csp` contains BOTH `sandbox allow-scripts`
 *  AND `default-src 'none'`. An unwired or empty CSP therefore fails LOUDLY at the
 *  first request instead of silently shipping a page with no sandbox. The protocol
 *  handler catches it, returns 500 and records a `csp-missing` failure entry.
 *  NOTE: this is two substring tests — it catches an EMPTY or UNWIRED CSP, not every
 *  malformation. `buildPreviewCsp` is the sole author of the string and never appends
 *  untrusted directives, so a structurally-valid-but-weakened CSP cannot arise; the
 *  check is a wiring tripwire, not a parser. */
export function buildResponseHeaders(contentType: string, csp: string): Record<string, string>
```

**`mimeForExtension` uses a null-prototype map** (`Object.create(null)`) plus an `Object.hasOwn`
guard, returning the literal `application/octet-stream` for any non-own key — a plain object literal
would return a function for `.constructor` and that non-string would flow into the header builder.

### 1.2 Session policy, network gating, storage seal

| Module | Key surface |
|---|---|
| `preview/previewSessionPolicy.ts` | `nextPartitionName()`, `PREVIEW_WEB_PREFERENCES`, `buildPreviewWebPreferences(session)`, `hardenPreviewSession(session): () => void` |
| `preview/previewFilterDecision.ts` | `decideRequest(url, allowed): FilterVerdict` |
| `preview/PreviewRequestFilter.ts` | `attach(session, ctx): () => void` |
| `preview/PreviewHostBlockNotifier.ts` | `shouldNotify(projectPath, host): boolean`, `clear(projectPath?)` |
| `preview/PreviewStorageSeal.ts` | `assertSealed(session)`, `purge(session): Promise<void>` |

```ts
export const PREVIEW_WEB_PREFERENCES = Object.freeze({
  sandbox: true, contextIsolation: true, nodeIntegration: false,
  nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
  webviewTag: false, webSecurity: true, allowRunningInsecureContent: false,
  experimentalFeatures: false, enableBlinkFeatures: '', devTools: false,
  spellcheck: false, images: true, javascript: true, backgroundThrottling: true
  // `preload` is DELIBERATELY absent — asserted by key, not by value.
} as const)

/** The ONLY construction site. `session` is the sole runtime addition. */
export function buildPreviewWebPreferences(session: Session): WebPreferences {
  return { ...PREVIEW_WEB_PREFERENCES, session }
}
```

**The gate-3 assertion is on the constructed value, not the literal** (NEW-2). Revision 3 asserted the
frozen literal against itself — which proves nothing about what reaches `new WebContentsView` — and
simultaneously claimed "adding a key fails" for a value the factory must add `session` to. Both are
fixed: the call site is exactly `buildPreviewWebPreferences(session)`, and the test asserts

```ts
expect(omit(wc.getLastWebPreferences(), 'session')).toStrictEqual(PREVIEW_WEB_PREFERENCES)
```

so adding a key at the construction site fails, and the assertion is about the object Chromium
actually received.

`hardenPreviewSession` denies every permission, prevents `will-download`, and calls
`wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` (`electron.d.ts:17712`) — see §2.8 control
table for what that does and does **not** achieve. It does **not** touch response headers: the CSP is
applied at the single site in §2.5 (`buildResponseHeaders`, round-4 option b), never re-asserted here.

**Redirects** re-enter `onBeforeRequest` per hop and are decided independently; a hop targeting
`erfana-preview:` is **always refused regardless of the allowlist**.

**Request-lifetime accounting** (the AC10 sweep depends on it):

```ts
export interface PreviewFilterContext {
  getAllowedHosts(): ReadonlySet<string>
  onBlocked(kind, host, url, approvable: boolean): void
  onRequestStarted(id: number): void   // called ONLY for requests onBeforeRequest ALLOWS
  onRequestSettled(id: number): void   // called by BOTH onCompleted and onErrorOccurred
}
```

**`purge()` is `clearStorageData({ storages })` over the seven data-bearing storages + `clearCache()` + the auth, host-resolver and code caches** (v0.19.0; the shader cache is left out because clearing it never completes on Windows), and it is belt-and-braces, not the seal:

| Layer | Mechanism | Covers |
|---|---|---|
| Opaque origin (`sandbox allow-scripts`) | Header-only CSP directive | **This is the seal** — storage APIs throw / are unavailable |
| In-memory partition | `Session.fromPartition` without `persist:`; the NAME is reused after a bounded purge (v0.19.0), because Electron cannot destroy a session | `storagePath === null` |
| No service workers | `allowServiceWorkers: false` + `worker-src 'none'` | Persistent interception |
| Purge before Erfana-driven reload and around a partition reuse | `clearStorageData` over `PURGED_STORAGES` (everything but `shadercache`) + `clearCache` + `clearAuthCache` + `clearHostResolverCache` + `clearCodeCaches`, bounded | A cached CDN response surviving an approval reload; HTTP-level residue reaching the next preview |

Not purged, and acceptable: a page-initiated `location.reload()` (Erfana is not in that path) and
`window.name` — acceptable *because the opaque origin already makes durable storage unavailable*.

### 1.3 Failures and diagnostics

`PreviewFailureLog.record()` strips every Unicode `Cf` (bidi/zero-width) and `Cc` code point from
`resourceUrlOrHost`, ring-buffers at `MAX_FAILURES`, and coalesces emission at
`PREVIEW_FAILURE_COALESCE_MS` (250 ms) with a trailing send.
`previewConsoleClassify.classifyConsoleMessage(level, message, source)` is a pure function and the
only producer of `script-error` and `unresolved-specifier`.

### 1.4 Watching, reload, view

| Module | Responsibility |
|---|---|
| `watcher/singleFileWatch.ts` (**mod**) | `createSingleFileWatcher(path, handlers, overrides?)` |
| `preview/PreviewWatchPool.ts` | Preview-owned chokidar pool |
| `preview/PreviewWatchCoordinator.ts` | **Confining** diffing set-watch, per-panel cap |
| `preview/PreviewReloadPolicy.ts` | **Pure** classify + coalesce |
| `preview/previewCssSwap.ts` | Swap script builder |
| `preview/PreviewStillFrameCache.ts` | Capture on hide only, downscaled, defined fallback |
| `preview/PreviewFindController.ts` | `finalUpdate`-only forwarding |
| `preview/previewInputForward.ts` | The 4 forwarded accelerators (§1.9) |
| `preview/PreviewExportController.ts` | `printToPDF` of the live `WebContents` |
| `preview/PreviewSessionFactory.ts` | Build one sealed session |
| `preview/PreviewViewService.ts` | Lifecycle owner only |

**Why a preview-owned pool** (X4): `FileWatcherService.watchFile(filePath, webContents)` requires a
`WebContents` and delivers everything through `sendToSubscribers`. `FileWatcherService.ts` (498/499
lines) is **not touched**.

**Why `singleFileWatch.ts` is touched** (deviation approved at round 1): the pool must reuse
`createSingleFileWatcher`, which owns the security-load-bearing `followSymlinks: false` and
`disableGlobbing: true` invariants (`:13-16`, `:35-40`) — forking would duplicate them and they would
drift. `SINGLE_FILE_WATCH_OPTIONS.awaitWriteFinish.stabilityThreshold` is `300` (`:30-33`), which alone
breaks AC24, so an optional third parameter defaults to the existing constant (+4 lines; both call
sites byte-identical). Preview options: `{ stabilityThreshold: 50, pollInterval: 25 }`.

**`setWatchSet` confines every candidate** through `confinePath` — the same realpath gate the protocol
handler uses — *before* acquiring a watch. Out-of-root candidates are dropped, counted into `dropped`,
and badged. **Releases are awaited before acquires** so a reload storm cannot stack file descriptors
transiently (chokidar `close()` is async).

**The post-load pipeline is rate-limited** (NEW-5). `did-finish-load` triggers entry-HTML read →
parse → confine ×N → watch diff → still-frame invalidate → `loadStateChanged`. A page-driven reload
loop would run that per iteration:

```ts
/** At most one full post-load pipeline per PREVIEW_RELOAD_MIN_INTERVAL_MS (750 ms).
 *  A did-finish-load inside the window schedules ONE trailing run and drops the rest;
 *  `loadStateChanged` emission is coalesced on the same clock. */
```

The view still repaints on every page-initiated reload — Erfana cannot and should not stop that — but
Erfana's own work per reload is bounded, which is the part that is Erfana's problem.

**The CSS swap is bounded and defaults to reload.** `swapStylesheet` runs
`buildCssSwapScript(oldHrefBase, newHref)` through **`executeJavaScriptInIsolatedWorld`** (so a page
redefining `Array.prototype.find` or `Promise` cannot shadow it) raced against
`PREVIEW_SWAP_TIMEOUT_MS`. **Any outcome other than the literal boolean `true`** — timeout, throw,
non-boolean, `false` — falls back to `reload()`. `oldHrefBase` is the `erfana-preview://<token>/<enc>`
URL with `?v=` stripped, computed **main-side** from the changed path, never read back from the page.

**Still frames** are downscaled with `NativeImage.resize` to `PREVIEW_MAX_FRAME_EDGE_PX` before
`toDataURL`, then checked against `PREVIEW_MAX_FRAME_DATAURL_CHARS`. Over budget, `isBeingCaptured()`
skip, or a throw ⇒ **no frame emitted**, panel falls back to the placeholder colour. Never blank.

**Four lifecycle events**: `render-process-gone` and `unresponsive` ⇒ `loadState:'failed'` + badge,
Reload stays live; entry-file unlink ⇒ `failed` + "file deleted" banner; entry-file rename ⇒ treated
as delete.

```ts
export interface IPreviewViewService {
  open(req: PreviewOpenRequest, window: BrowserWindow): Promise<PreviewOpenResult>
  close(panelId: string): Promise<void>          // bounded destroy (X21)
  setBounds(panelId: string, bounds: PreviewBounds, seq: number): void
  setVisibility(panelId: string, visible: boolean, reason: string): Promise<void>
  reload(panelId: string, opts?: { ignoreCache?: boolean }): Promise<void>
  swapStylesheet(panelId: string, relPath: string): Promise<boolean>
  /** Approve-path entry point: rebuilds the CSP on the registry entry, purges, reloads.
   *  Keeps the registry encapsulated in the service so the approve handler needs only
   *  the service (not the registry) — see §5(c). */
  applyApprovedHosts(panelId: string, hosts: readonly string[]): Promise<void>
  destroyAll(reason: string): Promise<void>      // AC21 global-off
  onProjectChanged(oldPath: string | null, newPath: string | null): Promise<void>
  dispose(): Promise<void>
}
```

**One live view, with a usable refusal** (X20 + NEW-9):

* A second `open` with a **different** `panelId` returns
  `{ ok: false, errorCode: PREVIEW_VIEW_LIMIT_REACHED, holderPanelId }`. The refused panel renders
  "A preview is already open" + **Open as source** + **Close the other preview**, the last of which
  needs `holderPanelId` — revision 3 declared the affordance with no data to drive it.
* A second `open` with the **same** `panelId` is **replace, not refuse**: the existing view for that
  panel is destroyed and a fresh one opened. Without this a main-window renderer reload (dev HMR,
  `Cmd+R`, a crash-recovery reload) leaves the main-side view alive under a panel id the new renderer
  re-registers, and **every panel is permanently refused** until the app restarts.

**Bounds** are zoom-converted then clamped to the host window's content rect, and any rect with width
or height `<= 0` is dropped (§4.3).

**Close is a bounded destroy**: request `close()`, race `PREVIEW_CLOSE_TIMEOUT_MS` (1 000 ms), then
`webContents.destroy()`. `dispose()`, `destroyAll()` and `onProjectChanged` go straight to `destroy()`.

### 1.5 Settings and eligibility

| Module | Responsibility |
|---|---|
| `utils/atomicWrite.ts` (**mod**) | `atomicWriteJSON<T>(path, content, space?: number)` |
| `preview/erfanaDirGate.ts` | `resolveErfanaDir(realRoot)` (X3) |
| `preview/PreviewAllowlistStore.ts` | Independent parse + atomic write-back |
| `preview/GitignoreEvaluator.ts` | Hardened `git check-ignore` + TTL cache |
| `preview/previewExclusion.ts` | `isInExcludedDirectory(rel)`, `hasDotSegment(rel)`, `hasShortNameAlias(rel)` |
| `preview/PreviewEligibilityService.ts` | Five ordered checks |

`previewExclusion` is used at **both** layers — eligibility *and* step 8d of `resolveConfined`.

**`GitignoreEvaluator` uses an env ALLOWLIST, not a blocklist** (NEW-13). Revision 3 scrubbed
`GIT_DIR`, `GIT_CONFIG*`, `GIT_EXEC_PATH` and `GIT_ALTERNATE_OBJECT_DIRECTORIES` — which leaves
`GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_CEILING_DIRECTORIES`, `GIT_PROXY_COMMAND` and the `GIT_TRACE*`
family (an arbitrary-path file-append primitive) intact, and makes the AC12 assertion "`GIT_*`
scrubbed" unsatisfiable against its own spec:

```ts
const GIT_ENV_ALLOWLIST = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'LANG']
execFile(
  absoluteGitPath,                    // resolved ONCE via where/which from a SAFE cwd
  ['-C', projectRoot, '--no-optional-locks',
   '-c', 'core.fsmonitor=', '-c', `core.hooksPath=${NULL_DEVICE}`,
   'check-ignore', '--quiet', '--', relPath],
  { cwd: app.getPath('temp'),
    env: { ...pick(process.env, GIT_ENV_ALLOWLIST), GIT_CONFIG_NOSYSTEM: '1' },
    shell: false, timeout: 2000, windowsHide: true }
)
```

An allowlist is the only form whose test is writable as "no `GIT_*` variable other than
`GIT_CONFIG_NOSYSTEM` is present". Exit 0 = ignored, 1 = not, anything else = **fail open** (the fixed
directory list covers the dangerous cases; failing closed would make `.html` un-previewable on every
non-git project).

**Eligibility order**, first failure wins, everything failing opens as source:
`globally-disabled` → `not-html` → `outside-project` → `excluded-directory` → `gitignored`.

### 1.6 IPC

`ipc/preview/`: `isTrustedPreviewSender.ts` (§7.1 debt 31) · `emit.ts` (re-validate + `isDestroyed()` +
coalescing) · `lifecycle-handlers.ts` · `find-handlers.ts` · `allowlist-handlers.ts` ·
`ipc/preview-handlers.ts` (composition root).

The composition root subscribes the existing `globalSettingsService.onSettingsChanged` (the mechanism
`global-settings-handlers.ts` and `LoggingService` already use); when `htmlPreview.enabled` flips
false it calls `service.destroyAll('globally-disabled')`. Without this hop AC21 would only hold for
previews opened *after* the toggle.

### 1.7 PDF export

`PdfService.getSavePath` (`PdfService.ts:736`) and `savePdfToFile` (`:815`) are **private** and
`IPdfService` (`:595`) exposes only `exportToPdf`, which builds its own HTML from markdown and cannot
print a live `WebContents`. `PreviewExportController` therefore imports the already-exported
`deriveSafeFilename` from `src/main/utils/validateFilename.ts` (the same export `PdfService` uses at
`:740`) and runs its own `dialog.showSaveDialog` + `writeFile`. **`PdfService` is not modified**; the
#161 Windows-reserved-name handling is preserved because it lives in the shared helper.

### 1.8 Renderer

| Module | Responsibility |
|---|---|
| `stores/useOverlayOccluderStore.ts` | Occluder **counts** + microtask-coalesced notification |
| `hooks/useOccluder.ts` | `useOccluder(kind, active)` |
| `services/preview/OverlayGuardService.ts` | Single hide/show owner |
| `stores/usePreviewStore.ts` | Per-panel state incl. `limitReached` + `holderPanelId` |
| `Panels/HtmlPreviewPanel/**` | 11 files **+ `HtmlPreviewPanel.css`** |
| `Tabs/HtmlPreviewTab.tsx`, `providers/search/PreviewPageSearchProvider.ts` | — |
| `utils/monacoLanguage.ts`, `utils/monacoLanguageServices.ts`, `utils/resolvePanelKind.ts` | — |
| `Settings/sections/HtmlPreviewSection.tsx` | AC21 toggle |

**Styling**: a plain co-located global CSS file imported by the component (not a CSS module), every
colour/space/size from `src/renderer/src/styles/design-tokens.css`, `border-radius: 0`. The
placeholder's background is **held equal to the native view's backdrop at all times** — R1's seam
mitigation is only real if the two agree. That is now a moving value, not one constant: brand black
(`var(--color-brand-black)` / `setBackgroundColor('#FF161312')`) until the page has painted, then the
page's own resolved paper colour, pushed to the panel over `preview:backdropChanged` and written as an
inline `background` on the placeholder. See §1.8a.

**The occluder is pushed from `BaseDialog`, not `DialogContext`** (X13). The brief's claim that no
"is any dialog open" observable exists was wrong: `BaseDialog.tsx:95` holds a module-level
`openDialogStack` with `registerOpenDialog` (`:98`) / `unregisterOpenDialog` (`:104`). `DialogContext.dialogs`
(`:37`) holds only `showConfirm`/`showAlert`-style dialogs — TranscriptionDialog, DocumentImportDialog,
CameraDialog, ScreenSelectDialog, WindowPickerDialog, FilePickerDialog, FileSystemDialog,
ScreenPermissionDialog, DropModeDialog and ConflictDialog are **not** there.

**Where the push goes, and why it is coalesced** (NEW-10). `registerOpenDialog` calls
`unregisterOpenDialog` **first** as a dedupe (`:99`), so pushing the count from inside both functions
emits `0` then `1` synchronously on a single register — a spurious hide/show, a wasted `capturePage`
and a visible flash. Two changes together:

1. Push from the **`isOpen` effect's two call sites** (`:299-300`), not from inside the stack
   functions, so one register is one notification.
2. The store notifies on a **`queueMicrotask`**, collapsing any synchronous 0→1 pair to a single final
   value. This is needed as well as (1): the effect's dependency array is `[isOpen, zIndex]`
   (`:301`), so a `zIndex` change runs cleanup (unregister → 0) then body (register → 1) in the same
   commit, which (1) alone does not collapse.

Separate `useOccluder` producers remain only for `SettingsOverlay`, `ToastContext`, the shared
`ContextMenu/ContextMenu.tsx`, and `ImageViewerPanel/hooks/useFullScreenOverlay.ts`. A **dev-mode
assertion** fires when an element with `z-index >= BASE_ZINDEX` mounts while the count is 0.

`overlayGuard.sync()` also runs from `onDidActivePanelChange` (`EditorAreaSplitPanel.tsx:74`) —
occluder counts do not change on a tab switch, so without it AC17 case 1 has no trigger (X18).

### 1.8a Backdrop, toast placement and the chrome strip

Added after the feature shipped and was found unusable on a production build. Three rules, each
normative.

**(a) The backdrop invariant.** *The DOM placeholder's background and the native view's
`setBackgroundColor` always carry the same value.* The value is a two-phase state machine, kept pure
in `src/main/services/preview/previewBackdrop.ts`:

| Event | Phase | Note |
|---|---|---|
| `constructed` | chrome (`#FF161312`) | matches `var(--color-brand-black)`; nothing has painted yet |
| `did-start-loading` | chrome **on the first load only** | a reload keeps the previous document on screen, and `setBackgroundColor` is not deferred to the next paint — repainting under it flashes the page dark on every autosave |
| `did-stop-loading` | page | reads the page's own resolved backdrop, falling back to `#FFFFFFFF` |
| `did-fail-load` | page | belt-and-braces; `did-stop-loading` already covers it |
| `render-process-gone` | chrome | the DOM failure banner is what the user should be reading |

Two choices here are load-bearing and must not be "simplified":

- **`did-stop-loading`, never `did-finish-load`.** Chromium scopes `DidStartLoading`/`DidStopLoading`
  to *any document in the frame tree* but `DidFinishLoad` to the *primary main frame's* `onload`.
  Pairing the first with the third means one lazily-loaded `<iframe>` flips the backdrop to chrome
  with nothing to flip it back: the page is unreadable permanently. `did-stop-loading` also fires on
  a failed or cancelled load, which matters because `window.stop()` is page-callable.
- **The page's own colour, not white.** Forcing `#FFFFFFFF` breaks any page declaring
  `color-scheme: dark`, which then renders light text on white — the original defect mirrored. Main
  reads `getComputedStyle` in an isolated world (id 998, the `previewCssSwap` precedent) so the page
  cannot shadow it.

The resolved colour is emitted on `preview:backdropChanged` and written by `HtmlPreviewPanel.tsx` as
an inline `background` on the placeholder. Both halves move together, or the invariant is broken.

These listeners are registered as **siblings** of `did-finish-load` in `previewViewLifecycle.ts`,
deliberately outside `schedulePipeline()` — that pipeline is rate-limited and drops events during a
save burst, which would strand the backdrop in the chrome phase.

**(b) The toast moves; the page does not.** A toast used to register an occluder simply by existing,
which hid every live preview. Combined with `ToastContext`'s forced `duration: 0` for an actionable
toast, the preview's own blocked-host prompt hid every preview **indefinitely**. Now:

- `usePreviewBounds` publishes each live view's CSS-pixel rect into `stores/usePreviewViewportStore.ts`,
  keyed on **visible + live, not on occlusion** — occlusion is the guard's output and toast placement
  is one of its inputs, so keying on visibility would oscillate every frame.
- The pure `Toast/toastPlacement.ts` tries, in order: stay put, slide right, slide left, rise above.
  `ToastNotification` applies the winning offset as a `transform`.
- `useOccluder('toast', …)` moved out of `ToastContext` and into `ToastNotification`, registered
  **only when placement returns `blocked`**. It therefore **fails safe**: when nothing fits, the old
  hide-everything behaviour returns, so a consent prompt can never end up under an untrusted page.

**(c) The "Preview – content below is not Erfana" strip.** A permanently visible band of Erfana's own chrome above the
native view, which is inset below it by `PREVIEW_CHROME_INSET_PX` through the same `topInset` path the
find bar uses. Rule (b) keeps an untrusted page on screen while Erfana asks a security question, and
rule (a) gives that page browser-native colours, so this is what lets a reader tell a real Erfana
prompt from one the page drew. Was residual risk 8 (§2.8). Do **not** make it conditional.

> **Withdrawn 2026-09, by owner decision.** The paragraph above is kept because it is why the control
> was built, not because it still ships. The bar above a preview is now a conventional **toolbar**
> matching the Markdown editor's: `var(--border-width) solid var(--color-border-default)` under it,
> carrying a Find button and the permission chip. The naming label and the 2px accent seam are both
> gone, and **nothing replaced them** — no substitute wording, no tooltip, no icon.
>
> **What did not change:** the bar is still always-DOM Erfana chrome, still rendered unconditionally,
> and still a flow sibling ABOVE the page area rather than an overlay on it, so the page still cannot
> paint over it; the view rect is still clamped to the window content area; the security question is
> still asked inside the bar; and Erfana still never asks for credentials inside a preview. (The
> `PREVIEW_CHROME_INSET_PX` inset named above is itself historical — layout subtracts the bar's own
> box now.) **What is lost:** no on-screen text names the boundary any more, and a 1px neutral rule is
> weak against a light page, so §2.8 risk 8's residual is wider than the entry there originally
> recorded.

### 1.9 Keyboard forwarding

```ts
/** A ONE-WAY DOOR on what the sealed box lets through. `accel` = Cmd on macOS, Ctrl elsewhere. */
export const PREVIEW_FORWARDED_SHORTCUTS = Object.freeze([
  { key: 'f', accel: true }, { key: 's', accel: true },
  { key: 'w', accel: true }, { key: 'Escape', accel: false },
  // No zoom keys — see below.
] as const)
```

Page zoom matters, and it is **not** carried by this list. Host zoom is applied geometrically —
`clampAndZoomBounds` multiplies the CSS rect — so Cmd/Ctrl-+ would enlarge the preview *rectangle*
while the page's text stayed at 100%, making it relatively **smaller**. WCAG 2.2 SC 1.4.4 requires
text to reach 200%.

The **View menu** is what delivers it: `menu.ts` -> `previewZoomHandler` -> `zoomFocused` finds the
focused preview and calls `preview:setZoom`, which is clamped to `MIN_ZOOM_LEVEL`/`MAX_ZOOM_LEVEL` and
persisted per panel so a zoom survives a suspend/resume. The menu's items are handlers rather than
Electron's built-in zoom *roles* precisely so the two cannot both fire.

The zoom keys were briefly listed above as well. That was dead in one direction and a hazard in the
other: `PreviewForwardedShortcutSchema` never enumerated them, so every one was dropped at
`validateAndSend` and the renderer's zoom branch never ran — and widening that enum to "fix" it would
have zoomed **twice** per keypress, once from the accelerator and once from the forward. The forwarded
list and the schema are now pinned equal by a test, in both directions.

Everything else stays with the page. `before-input-event` is Chromium's pre-dispatch input pipeline,
not a page-callable API.

---

## 2. The `erfana-preview://` URL contract — one-way door

### 2.1–2.3 Scheme, token, encoding

**Token**: `randomUUID().replaceAll('-','')` → 32 lowercase hex chars (hex because Chromium
canonicalises hosts to lowercase, so it round-trips; also a valid hostname). Maps to
`PreviewRootEntry` (§1.1) — `realRoot`, `projectPath` **and the CSP**. Minted lazily on first
`preview:open`; revoked on project switch and app quit. A revoked token yields **404, not 403**. It is
**not a secret** — the page can read its own `location`; its job is to keep the filesystem path out of
the URL.

**Encoding**: `path.relative(realRoot, target).split(path.sep).map(encodeURIComponent).join('/')`.
`u.search` ignored, never read; `u.hash` never transmitted. Userinfo or a port ⇒ reject.

### 2.4 Request → response algorithm

```
 1. parse URL                                      malformed →              404
 2. method GET or HEAD                             otherwise →              405
 3. u.port / u.username / u.password empty         otherwise →              404
 4. registry.resolve(u.hostname)                   unknown/revoked →        404
 5. decodeURIComponent each segment                URIError →               400
 6. every segment passes isSafeSegment()           otherwise →              400
      (rejects '', '.', '..', NUL, '/', '\'; on win32 also /~[0-9]/ — NEW-1 layer 1)
 7. candidate = path.join(entry.realRoot, ...segments)
 8. CONFINEMENT — order is load-bearing:
      a. parentReal = await fsPromises.realpath(dirname(candidate))   ENOENT → 404
      b. rel = path.relative(realRoot, join(parentReal, basename(candidate)))
      c. rel === '' || rel.startsWith('..') || isAbsolute(rel) →              403 'path-escape'
      d. isInExcludedDirectory(rel) || hasDotSegment(rel) →                   403 'excluded-path'
      e. handle = await fs.open(candidate, O_RDONLY | O_NOFOLLOW)
             ELOOP (final component is a symlink) / ENOENT →                  404
      f. st = await handle.stat()
             !st.isFile() → 404
      g. lst = await fsPromises.lstat(candidate)
             lst.dev !== st.dev || lst.ino !== st.ino →                       403 'path-escape'
      h. NEW-1 layer 2 — re-run the exclusion rules against the FULLY RESOLVED path:
             realTarget = await fsPromises.realpath(candidate)
             relReal    = path.relative(realRoot, realTarget)
             relReal escapes || isInExcludedDirectory(relReal)
                          || hasDotSegment(relReal) →                         403 'excluded-path'
         (Narrows, does not fully close: the re-resolve at (h) can still race a parent-directory
          rename between (g) and here — same residual class as debt item 32. The dev/ino compare at
          (g) pins the identity of the OPENED handle, not of a future name resolution.)
 9. body = readExactly(handle, PREVIEW_MAX_ASSET_BYTES)
      more bytes remain than the cap →                                        413
10. if (!isKnownAssetType(ext) && destination is 'script'|'style')
        record 'unsupported-asset-type'      ← still 200
11. headers = buildResponseHeaders(mimeForExtension(ext), entry.csp)
      throws PREVIEW_CSP_INVALID →                                            500 'csp-missing'
12. return new Response(body, { headers })

EVERY path from 8e onward runs inside try { … } finally { await handle?.close() }.
```

**Step 8h closes the Windows 8.3 short-name bypass** (NEW-1). Step 8b builds `rel` from
`join(parentReal, basename(candidate))` and the basename is deliberately *not* resolved, so
`<root>/ENV~1` arrives at 8d as the literal `ENV~1` — no leading dot, passes `hasDotSegment` and
`isInExcludedDirectory`, opens cleanly under `O_NOFOLLOW` (a short name is a directory-entry alias,
not a reparse point), and passes the dev/ino compare because it **is** the same inode. `GIT~1/config`
is the same bypass one level up. This reopened the asset that step 8d exists to protect.

**Note on `realpath` semantics.** The review stated that "Node's plain `fs.realpath` … does not
canonicalise short names; only `fs.realpath.native` does." That is true of the **callback and sync**
`fs.realpath`, but **`fs/promises.realpath` already has native semantics** — `@types/node`
`fs/promises.d.ts:906` documents it as "using the same semantics as the `fs.realpath.native()`
function". This design uses `fs/promises` throughout, so the parent resolution at 8a was already
native. That does **not** rescue the finding: the bypass is the **unresolved basename** at 8b, which
no amount of parent canonicalisation fixes. The algorithm now writes `fsPromises.realpath` explicitly
rather than relying on the reader knowing the distinction, and step 8h resolves the full path.

**Layer 1** is a cheap `win32`-only segment rejection of `/~[0-9]/` at step 6. It is a second layer,
not the fix — a long name may legitimately contain `~1`, so it is `win32`-gated and the real
enforcement is 8h.

**Open item for implementation**: the exact 8.3 alias Windows assigns to `.env` (leading-dot names
alias unusually) **must be confirmed on a Windows host** and added as a test case; do not assume
`ENV~1`.

**Step 9 bounds the read** (NEW-11). Revision 3 checked `st.size` at 8f then called
`handle.readFile()`, which reads to EOF — a file grown between stat and read would be served in full.
`readExactly` reads at most `PREVIEW_MAX_ASSET_BYTES` and returns 413 if more remains.

Other corrections this encodes: step 8d is new in round 1 (X6); revision 1's claim that reading from a
handle "closes the realpath→read TOCTOU window" is **withdrawn** — a residual remains and is documented
(§2.8 risks 6–7, debt items 32–33) because Node has no `openat`; `resolveConfined` returns a `Buffer`,
not a handle, so 404/413 cannot leak a descriptor (a real concern given #146–#151). Step 10's
destination is read from the `sec-fetch-dest` request header, falling back to `request.destination`
(**unverified** whether `protocol.handle`'s `Request` populates it; a test asserts at least one is
present). Reading a *request* header is safe — it is never reflected.

### 2.5 Privileges, CSP, headers

```ts
protocol.registerSchemesAsPrivileged([{ scheme: PREVIEW_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true,
                corsEnabled: true, bypassCSP: false, allowServiceWorkers: false, stream: false } }])
```

| Flag | Why |
|---|---|
| `standard` | Authority component ⇒ relative URLs resolve. Without it AC6 fails outright. |
| `secure` | Secure context; scheme subresources are not mixed content beside `https:` assets. |
| `supportFetchAPI` + `corsEnabled` | Set together: the document is at an opaque origin, so every `fetch`, module script and `@font-face` load to the scheme is cross-origin. |
| `bypassCSP: false` | Would bypass the *embedder's* CSP. |
| `allowServiceWorkers: false` | Persistent, interceptive storage. |
| `stream: false` | No `Range`/206 in v1 and Electron will not synthesise it. |

**The CSP is built from the allowlist, not from `https:`** (X2b). `buildPreviewCsp(hosts)`
re-validates each host against `PreviewHostSchema`'s regex **and** explicitly rejects `\r`/`\n`. The
regex admits no space, `;`, `'`, `"`, `,`, `\r` or `\n`; JavaScript's `$` without `m` matches
end-of-input only (unlike Python's), so a trailing newline cannot slip past the anchor.

**Reject behaviour is skip-and-badge, never throw** (NEW-4). A host that fails re-validation is
**omitted from the source list** and recorded as an `allowlist-invalid` failure entry; the CSP is
still produced. Throwing was unspecified in revision 3 and would have been the worst outcome: a throw
on the approve-path rebuild (`registry.rebuildCsp`) would leave the entry on a stale CSP after a
successful write. An empty result is still safe — it degrades to `erfana-preview:` only — and
`buildResponseHeaders`' invariant check (§1.1) catches an **empty or unwired** CSP (it is two
substring tests, so it catches absence, not every malformation — but `buildPreviewCsp` is the sole
author of the string and never appends untrusted directives, so a structurally-valid-but-weakened CSP
cannot arise).

```
default-src 'none';
script-src 'unsafe-inline' 'unsafe-eval' erfana-preview: {hosts};
style-src  'unsafe-inline' erfana-preview: {hosts};
img-src    data: blob: erfana-preview: {hosts};
font-src   data: erfana-preview: {hosts};
media-src  blob: erfana-preview: {hosts};
connect-src erfana-preview: {hosts};
frame-src 'none'; object-src 'none'; worker-src 'none';
form-action 'none'; base-uri 'none';
sandbox allow-scripts
```

`'unsafe-inline'`/`'unsafe-eval'` are deliberate: agent-built single-file tools *are* inline scripts.
Isolation comes from the process, the opaque origin and the absent bridge — not from `script-src`.

**Response headers**, all literals except the CSP:

```
Content-Type: <null-prototype table>          Content-Security-Policy: <entry.csp>
Cache-Control: no-store                       X-Content-Type-Options: nosniff
Access-Control-Allow-Origin: *                Cross-Origin-Resource-Policy: cross-origin
Referrer-Policy: no-referrer                  X-DNS-Prefetch-Control: off
```

`X-DNS-Prefetch-Control: off` is a one-literal mitigation for half of §2.8 risk 3 — see there for what
it does and does not cover. **There is no `onHeadersReceived` CSP overwrite** (round-4 option b): the
CSP is set once, here, by `buildResponseHeaders`, so there is a single application site and no second,
hostless owner to leave unwired or drift out of sync. Deleting the second site is what makes §2.6's
single-ownership claim literally true rather than aspirational.

### 2.6 GHSA-4p4r-m79c-wq3v

`buildResponseHeaders(contentType, csp)` is the **single** response-header constructor **and the single
CSP application site** — round-4 option b deleted the `onHeadersReceived` overwrite that an earlier
revision also specified, so this is now literally true, not merely asserted. `contentType` comes from a
null-prototype, `hasOwn`-guarded table of compile-time constants; `csp` comes from `buildPreviewCsp`
via the registry entry, whose only variable input provably contains no CSP delimiter, and is
invariant-checked before use. No requested path, decoded segment, filename, query string or request
header reaches a response header.

### 2.7 Opaque origin vs AC6 — confirmed

* **No-CORS** (`<link rel=stylesheet>`, classic `<script src>`, `<img src>`) apply cross-origin. Two
  headers are load-bearing: **`Cross-Origin-Resource-Policy: cross-origin`** (an opaque-origin
  document is never same-origin with `erfana-preview://<token>`) and **the exactness of the MIME table
  under `nosniff`**.
* **CORS-gated** (`<script type="module">`, `@font-face`, `fetch`) send `Origin: null` with
  credentials `omit`; the literal `*` satisfies them. **No `Origin` reflection anywhere.**
* **`'self'` is never used** — an opaque origin has no self. Asserted by test.

Residual (AC22): `document.styleSheets[i].cssRules` on a *linked* sheet throws cross-origin. Rendering
unaffected; inline `<style>` readable.

### 2.8 Threat model (merge gate 1)

**Assets.** (A1) Files in the open project outside the excluded set. (A2) Files outside the project
root. (A3) Erfana's IPC surface and main renderer. (A4) The user's OS account. (A5)
`.erfana/settings.json` integrity. (A6) The user's trust in what the preview pane shows.

**Attackers.** (T1) A malicious `.html` in the project — primary; arrives via clone, agent, or
download; runs arbitrary JS with `unsafe-eval`. (T2) A malicious **repository** — controls
`.gitignore`, `.git/config`, `.erfana/`, symlinks, short-name-aliasable filenames and layout before
the user previews. (T3) A network attacker on an approved host. (T4) A compromised approved CDN.

**Controls.**

| Control | Asset | Effect |
|---|---|---|
| Own process + in-memory partition, no preload, frozen `sandbox`/`contextIsolation` prefs asserted on the **constructed** value | A3, A4 | Defeats T1 reaching IPC/node |
| `sandbox allow-scripts` opaque origin | A4 | Defeats T1 persisting anything |
| realpath + `O_NOFOLLOW` + dev/ino + **post-resolve exclusion re-check** (§2.4 8h) | A2, A1 | Defeats symlink escape and Windows 8.3 alias bypass |
| `hasDotSegment` + `isInExcludedDirectory` at the protocol layer | A1 (partial) | Defeats T1 reading `.git`, `.env`, `.erfana` |
| Host-listed CSP (single application site) **and** unfiltered `onBeforeRequest`, per-hop redirect decisions | A1 | Defeats T1 exfiltrating over HTTP(S) |
| `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` | A1 | **Narrows WebRTC local-IP exposure only** — see risk 3 |
| `X-DNS-Prefetch-Control: off` | A1 | Suppresses `dns-prefetch`; does **not** cover `preconnect` — risk 3 |
| Host grammar rejects IP literals, `localhost`, `.local`, `.internal` | A4 | Raises the bar on loopback targets; no IP pinning — risk 4 |
| Watch-set realpath confinement | A2 | Defeats T2 planting a watch outside the root |
| `erfanaDirGate` + non-recursive `mkdir` | A5, A2 | Defeats T2's symlinked `.erfana` |
| Hardened `git` (absolute path, safe cwd, **env allowlist**, `core.fsmonitor=`) | A4 | Defeats T2's `.git/config` RCE |
| Enumerated 4-shortcut input forwarding | A3 | Bounds the input bridge |

**Accepted risks:**

1. **Any previewed page can read most of your project.** Operator-accepted. After steps 8d and 8h,
   what remains readable is every file under the root whose resolved path contains no dot-prefixed
   segment and is not under `node_modules`, `dist`, `out`, `coverage` or `.git` — all source, docs,
   notes and data. A secret in `config.json` is readable; one in `.env` is not.
2. **Exfiltration over an approved host.** The allowlist controls *which* origins, never *what* is
   sent. T4 turns any approved CDN into a channel.
3. **Exfiltration over channels no chokepoint sees.**
   * **WebRTC over TURN.** `setWebRTCIPHandlingPolicy('disable_non_proxied_udp')` is a **local-IP
     exposure policy**; it does not stop an `RTCPeerConnection` reaching an attacker-controlled TURN
     server over **TCP/443**. No permission gates a data channel, `onBeforeRequest` does not observe
     ICE/TURN traffic, and Chromium does not enforce `connect-src` on WebRTC. This is a real,
     unmitigated general-purpose exfiltration channel. (Revision 3's control table claimed it
     "defeats T1 exfiltrating over WebRTC" — wrong, and corrected above before item 85 transcribes it.)
   * **`<link rel=preconnect>`.** Opens a real TCP/TLS connection with no HTTP request, so
     `onBeforeRequest` never fires and there is no header to control it. ~60 bytes leak per hostname
     via subdomain labels.
   * **DNS prefetch** is now suppressed by `X-DNS-Prefetch-Control: off`, which Chromium honours.
     (Revision 3 said "no API to disable them" — wrong for prefetch, right for preconnect.)
   * DNS resolution for an allowlist-blocked host may still occur before cancellation.
   §0's allowlist statement is therefore not written as an unqualified guarantee.
4. **DNS rebinding is not defended.** The grammar rejects literal IPs and `localhost`, but a name that
   *resolves* to a private address is not detected — no IP pinning between resolution and connection.
   Residual is **blind fire-and-forget requests** to loopback or LAN services: the opaque origin means
   the page cannot read any response, so this is a write-side SSRF shape, not a read primitive.
5. **The allowlist is a speed bump, not a wall.** It lives in the project, so a clone or an agent edit
   can pre-approve hosts before a human sees a prompt.
6. **Hardlinks defeat path confinement.** `realpath` resolves symlinks but not hardlinks (debt 33).
7. **A residual realpath→open race.** Narrowed, not closed; Node has no `openat` (debt 32). The 8h
   re-resolve narrows but does not remove it.
8. **UI spoofing.** Mitigated: the rect is clamped to the window content area, the panel keeps tab and
   toolbar chrome, **Erfana never asks for credentials or API keys inside a preview panel** (the AC22
   page says so), and a persistent **"Preview – content below is not Erfana" strip** now sits above every live preview
   in always-DOM chrome with the native view inset below it (`PREVIEW_CHROME_INSET_PX`), so the page
   cannot cover it. Promoted from follow-up to shipped when toast placement (sd-074b follow-up) stopped
   hiding the preview during a security prompt: an untrusted page now stays on screen while Erfana asks
   "Approve this host?", and the strip is what distinguishes a genuine prompt from a drawn one.
   Residual: the strip proves the panel is a preview, not that a dialog elsewhere is genuine.

   **Amended 2026-09 (owner decision, §1.8(c)).** The naming label and the 2px accent seam were
   withdrawn when the bar became a conventional toolbar; nothing replaced either. The structural half
   of this entry stands unchanged — always-DOM Erfana chrome, a flow sibling above the page area, a
   clamped view rect, no credential prompts in a preview — but the wording that told a reader which
   side of the line they were looking at is gone. **Widened residual:** nothing on screen names the
   boundary, and a 1px neutral rule is weak against a light page, so a page drawing a convincing fake
   Erfana dialog inside its own rectangle meets one fewer cue. Accepted as stated.
9. **Git config keys beyond `core.fsmonitor`.** The hardened invocation overrides the one key known to
   execute a command during `check-ignore`. Bounded by fail-open and by `check-ignore` being the only
   subcommand run.
10. **Windows short-name aliases beyond the tested set.** Step 8h resolves the full path before
    re-checking, which is general — but the alias Windows assigns to a leading-dot name is unverified
    on a Windows host and is an explicit implementation-time confirmation item.
11. **A permanent Chromium attack surface.** Shipping execution makes Chromium advisories a recurring
    obligation.

---

## 3. The `.erfana/settings.json` allowlist — one-way door

### 3.1 Schema (zod **v4**)

The repo is on `zod ^4.1.12` (`package.json:58`); `z.nativeEnum` is deprecated in v4 and appears
nowhere in `src/` — `z.enum(ErrorCode)` throughout. `.max()` on arrays, `.default([])` and
`.startsWith()` are v4-valid; the implementer re-verifies the inferred input/output types under v4's
stricter `.default()` split before the schema file lands.

```ts
export const PREVIEW_ALLOWLIST_VERSION = 1
export const MAX_ALLOWLIST_HOSTS = 200

export const PreviewHostSchema = z.string().min(1).max(253)
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/)
  .refine(isApprovableHost, { message: 'host is not approvable' })

/** Rejects IPv4/IPv6 literals (incl. bracketed), all-numeric label sets, `localhost`,
 *  `*.localhost`, `*.local`, `*.internal`. Applied on BOTH read and write paths. */
export function isApprovableHost(host: string): boolean

export const PreviewAllowlistSchema = z.object({
  version: z.literal(PREVIEW_ALLOWLIST_VERSION),
  hosts: z.array(PreviewHostSchema).max(MAX_ALLOWLIST_HOSTS).default([])
})
```

**The allowlist is NOT in `ProjectSettingsSchema`** (X1). `ProjectSettingsService.ts:94-103` throws
`PROJECT_SETTINGS_VALIDATION_FAILED` on any parse failure and that **blocks project load**, so a
clone-delivered allowlist with one bad host would make the folder permanently un-openable.
`ProjectSettingsSchema` gains **`htmlPreview: z.unknown().optional()`** only.

### 3.2 Migration and forward-compatibility

| On-disk state | Behaviour |
|---|---|
| No `htmlPreview` / no `allowlist` | Empty allowlist, write-back enabled |
| `version === 1`, valid | Parsed |
| `version === 1`, invalid or non-approvable host, or >200 entries | Empty allowlist, write-back **disabled**, `allowlist-invalid` badge. **Project opens normally.** |
| `version` anything else | Empty allowlist, write-back **disabled**, `allowlist-unsupported-version` badge. Project opens normally. |
| Unknown extra keys | Preserved — the write path re-reads and mutates the raw object rather than serialising the parsed one |

Fail closed on an unknown version: a future version may express *narrowing* semantics that an older
build would widen into "host fully approved".

### 3.3 Write-back path

```
approveHost(host):                                  ← root is NOT a parameter (NEW-8)
  0. projectRoot = projectService.getCurrentProjectPath()   // main-side ONLY
     host = new URL(`https://${host}`).hostname             // ASCII/punycode normalise
     PreviewHostSchema.parse(host)                          // incl. isApprovableHost
  1. realRoot   = await fsPromises.realpath(projectRoot)
  2. erfanaDir  = await resolveErfanaDir(realRoot)          ← X3 gate
  3. settingsPath = join(erfanaDir, 'settings.json')
  4. raw = exists ? JSON.parse(await readFile(settingsPath,'utf8')) : {}
       parse throws OR raw not a plain object → ABORT, do NOT overwrite
  5. block = raw.htmlPreview?.allowlist
       block exists && block.version !== 1 → ABORT (fail closed)
  6. hosts = new Set(block?.hosts ?? []); hosts.add(host)
       hosts.size > MAX_ALLOWLIST_HOSTS → ABORT, PREVIEW_ALLOWLIST_FULL
  7. raw.htmlPreview = { ...raw.htmlPreview,
                         allowlist: { version: 1, hosts: [...hosts].sort() } }
  8. await atomicWriteJSON(settingsPath, raw, 2)     ← 2-space indent + trailing newline
  9. re-read + re-validate; swap the in-memory set; RETURN the new host set to the caller.
     The approve HANDLER (not the store) then calls service.applyApprovedHosts(panelId, hosts),
     which rebuilds the CSP on the registry entry, purges and reloads — see §5(c). The store
     never holds the registry or the view.
```

**The project root is never a request parameter** (NEW-8). Revision 3 wrote
`approveHost(projectRoot, host)` and declared an `APPROVE_HOST` channel with **no request schema at
all** — leaving an implementer free to put `projectRoot` in the payload, which is X10's bug class on a
*write* path: a renderer-supplied path would steer an `atomicWriteJSON`. The schema is now explicit
and `.strict()` (§4.2), and the root is resolved main-side from `ProjectService`, exactly as
`PreviewOpenRequest` does.

Serialised behind a per-project tail-promise chain.

**`resolveErfanaDir` — the X3 gate.** Revision 1 did `join(projectRoot,'.erfana')` →
`mkdir(recursive:true)` → `atomicWriteJSON` with nothing realpathing `.erfana`. `mkdir -p` succeeds
silently when the path is already a symlink to a directory, and `atomicWrite.ts:29-30` derives the
temp path from `dirname(filePath)` — so **both** the temp write and the rename land inside the symlink
target. A repo shipping `.erfana -> ../../.claude` would have Erfana overwrite that file on the single
most expected action in the feature.

```ts
/** 1. lstat — exists and isSymbolicLink() → REFUSE.
 *  2. absent → mkdir NON-recursively (mode 0o700), so an existing symlink raises EEXIST.
 *  3. realpath, then require `path.relative(realRoot, real) === '.erfana'` — the same
 *     containment rule previewPathResolve uses, not a second one. */
export async function resolveErfanaDir(realRoot: string): Promise<string>
```

**`atomicWriteJSON` gains an optional `space`** — today it calls a bare `JSON.stringify(content)`
(`atomicWrite.ts:34`), so the first Approve would collapse a hand-edited, git-tracked file to one line.
Default `undefined` leaves `ProjectLockService` byte-identical.

### 3.4 Same project in two windows

Accepted breakage; must not corrupt. **Guaranteed**: the file always parses. **Lost**: a host approved
in window A between B's read and B's write. **Not attempted**: cross-window locking. **Side effect**:
`mode: 0o600` makes a previously-`0644` file owner-only — invisible to git, real on disk; in AC22.

---

## 4. IPC contract

### 4.1 Channels

`PreviewChannels`: `CHECK_ELIGIBILITY`, `OPEN`, `CLOSE`, `SET_BOUNDS`, `SET_VISIBILITY`, `RELOAD`,
`APPROVE_HOST`, `FIND`, `STOP_FIND`, `EXPORT_PDF`. `PreviewEvents`: `FAILURES_CHANGED`,
`HOST_BLOCKED`, `FIND_RESULT`, `STILL_FRAME_CHANGED`, `LOAD_STATE_CHANGED`, `FORWARDED_SHORTCUT`.
Both frozen `as const`.

### 4.2 Schemas — `src/shared/ipc/preview-schema.ts`

**Every request schema is `.strict()`** (NEW-14): revision 3 marked only `PreviewOpenRequestSchema`,
leaving the other three silently accepting extra keys — the same drift `.strict()` exists to stop.

```ts
export const PanelIdSchema = z.string().min(1).max(256)

/** No `projectPath` (X10). A test asserts rejection when one is present. */
export const PreviewOpenRequestSchema = z.object({
  panelId: PanelIdSchema, filePath: z.string().min(1), bounds: PreviewBoundsSchema
}).strict()

/** No `projectRoot` (NEW-8). Root resolved main-side from ProjectService. */
export const PreviewApproveHostRequestSchema = z.object({
  panelId: PanelIdSchema, host: z.string().min(1).max(253)
}).strict()

export const PreviewSetBoundsSchema = z.object({
  panelId: PanelIdSchema, bounds: PreviewBoundsSchema,
  seq: z.number().int().nonnegative()          // main drops seq <= last applied
}).strict()

export const PreviewSetVisibilitySchema = z.object({
  panelId: PanelIdSchema, visible: z.boolean(),
  /** Diagnostics ONLY — a bounded string, NOT an enum (X14): a closed enum fails OPEN.
   *  Add a fifth OccluderKind, forget the zod enum, and safeParse DROPS the message,
   *  leaving the preview visible over the new overlay, silently. */
  reason: z.string().max(32)
}).strict()

export const PreviewFindRequestSchema = z.object({
  panelId: PanelIdSchema, text: z.string().min(1).max(1024),
  forward: z.boolean(), findNext: z.boolean(), matchCase: z.boolean()
  // no wholeWord — FindInPageOptions in 39.8.9 is exactly {forward?, findNext?, matchCase?}
}).strict()

/** The host here is a REPORTING value, not an approval value (SEC-019). PreviewHostSchema
 *  gates the APPROVE path only; if it also gated the toast, an IPv6 literal, an underscore
 *  host or a trailing-dot host would be blocked with NO user-visible signal at all. */
export const PreviewHostBlockedPayloadSchema = z.object({
  panelId: PanelIdSchema, host: z.string().min(1).max(253), approvable: z.boolean()
})

/** AC20 entry shape. `z.enum(ErrorCode)` — NOT `z.nativeEnum` (zod v4). */
export const PreviewFailureSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['blocked-host','insecure-scheme','missing-local-file','path-escape',
                'excluded-path','asset-too-large','unsupported-asset-type','csp-missing',
                'network-error','network-timeout','script-error','unresolved-specifier',
                'allowlist-invalid','allowlist-unsupported-version']),
  resourceUrlOrHost: z.string().max(2048),   // never absolute; Cf/Cc-stripped by record()
  reasonCode: z.enum(ErrorCode),
  timestamp: z.number().int().nonnegative()
})
```

Plus `PreviewCheckEligibility{Request,Response}Schema`, `PreviewOpenResponseSchema`,
`PreviewFailureListPayloadSchema`, `PreviewFindResultSchema`, `PreviewStillFrameSchema`,
`PreviewLoadStatePayloadSchema`, `PreviewForwardedShortcutSchema`, and the `PreviewBridge` interface.

### 4.3 Validation, bounds, zoom

Every R→M handler: `isTrustedPreviewSender(event)` → `safeParse` → act inside try/catch. No handler
throws. Every M→R send re-validates before `wc.send` and guards `wc.isDestroyed()`
(`claude-status-handlers.ts:90-103`). `setBounds` and `setVisibility` use `send`, not `invoke`.

**Throttle**: one send per `requestAnimationFrame` plus a trailing send 120 ms after the last change.
rAF is exactly the maximum useful rate — the renderer lays out at most once per frame. `seq` makes the
stale-drop rule explicit rather than relying on transport ordering.

**Coordinate space and zoom.** `getBoundingClientRect()` returns **CSS pixels**; `View.setBounds` takes
**DIPs relative to the window content view**, and a native `View` is a sibling surface unaffected by
the host renderer's zoom. Browser zoom scales CSS px onto DIPs, so:

```
dip = Math.round(cssPx * mainWindow.webContents.getZoomFactor())
```

**Multiply, not divide.** `getZoomFactor()` is "zoom percent divided by 100, so 300% = 3.0"
(`electron.d.ts:17732-17744`): at 300 % a 100-CSS-px placeholder occupies 300 DIPs. Reachable today —
`src/main/menu.ts:79-81` ships `resetZoom`/`zoomIn`/`zoomOut`. Conversion is **main-side** (no IPC, no
trust question). After conversion the rect is clamped to the window content rect and any rect with
width or height `<= 0` is dropped.

### 4.4 Type index

**Protocol and result types live in `src/shared/ipc/preview-types.ts` (work item 4), a leaf module with
no dependencies beyond `errors.ts` and `constants.ts`.** Revision 3 declared them "defined once" inside
`preview-schema.ts` at item 40 while items 10–39 consumed them — the graph was not compilable at each
step. Moving them to a leaf fixes that without duplicating a definition.

```ts
// shared/ipc/preview-types.ts  (item 4)
export interface PreviewBounds { x: number; y: number; width: number; height: number }
export type FilePanelKind = 'image' | 'preview' | 'editor'

export type PreviewFailureType =
  | 'blocked-host' | 'insecure-scheme' | 'missing-local-file' | 'path-escape'
  | 'excluded-path' | 'asset-too-large' | 'unsupported-asset-type' | 'csp-missing'
  | 'network-error' | 'network-timeout' | 'script-error' | 'unresolved-specifier'
  | 'allowlist-invalid' | 'allowlist-unsupported-version'

/** What a producer hands to PreviewFailureLog.record; `id`/`timestamp` are added there. */
export interface PreviewFailureInput {
  type: PreviewFailureType; resourceUrlOrHost: string; reasonCode: ErrorCode
}

export type ConfineVerdict =
  | { ok: true; realTarget: string; rel: string }
  | { ok: false; reason: 'escape' | 'excluded' | 'missing' }

export type PreviewResolveResult =
  | { ok: true; body: Buffer; ext: string }
  | { ok: false; status: 400 | 403 | 404 | 413 | 500; reason: PreviewFailureType }

export type PreviewOpenResult =
  | { ok: true }
  /** `holderPanelId` is present for PREVIEW_VIEW_LIMIT_REACHED so the refused panel can
   *  offer "Close the other preview" (NEW-9). */
  | { ok: false; errorCode: ErrorCode; holderPanelId?: string }

export type PreviewApproveResult =
  | { ok: true; hosts: readonly string[] } | { ok: false; errorCode: ErrorCode }

export interface PreviewFindResult {
  panelId: string; requestId: number; matches: number; activeMatchOrdinal: number
}
export type PdfExportResult = { ok: true; path: string } | { ok: false; errorCode: ErrorCode }
export interface PreviewStillFrame {
  dataUrl: string; width: number; height: number; capturedAt: number
}
export interface PreviewWatchState { watched: string[]; dropped: string[] }

/** The main→renderer emitter bundle. Declared HERE (item 4), so `PreviewViewService` (item 39)
 *  depends on the emit TYPE from a strictly-lower item, never on the emit IMPLEMENTATION
 *  (`emit.ts`, item 43). Members take the item-4 result interfaces above; the concrete
 *  zod-validated payloads (failuresChanged/hostBlocked/loadStateChanged) are re-validated inside
 *  emit.ts before send, so this type stays free of any item-41 schema import. */
export interface PreviewEmitters {
  failuresChanged(panelId: string, failures: readonly PreviewFailureInput[], truncated: boolean): void
  hostBlocked(panelId: string, host: string, approvable: boolean): void
  findResult(r: PreviewFindResult): void
  stillFrameChanged(panelId: string, frame: PreviewStillFrame): void
  loadStateChanged(panelId: string, state: 'idle'|'loading'|'ready'|'failed', dropped: number): void
}
```

**Injection seams.** `PreviewViewDeps` is declared in `PreviewViewService.ts` (item 39) and
`PreviewHandlerDeps` in `preview-handlers.ts` (item 47); each references only interfaces from
strictly-lower items (or the item-4 `PreviewEmitters` type), keeping the graph upward-only. The
five missing edges the round-3 spot-check found are now in the table: **39 → 22** (`storageSeal`) and
**47 → 19, 24, 39, 42** (`allowlistStore`, `hostBlockNotifier`, `service`, `isTrustedSender` — the
composition root constructs all four).

```ts
export interface PreviewViewDeps {
  sessionFactory: IPreviewSessionFactory; watchCoordinator: IPreviewWatchCoordinator
  reloadPolicy: IPreviewReloadPolicy;     stillFrameCache: IPreviewStillFrameCache
  findController: IPreviewFindController; failureLog: IPreviewFailureLog
  exportController: IPreviewExportController; storageSeal: IPreviewStorageSeal   // ← 39→22
  emit: PreviewEmitters                   // the TYPE, from item 4
  getZoomFactor: () => number             // injected so tests need no real BrowserWindow
  now: () => number
}
export interface PreviewHandlerDeps {
  service: IPreviewViewService            // ← 47→39
  eligibility: IPreviewEligibilityService // ← 47→28
  allowlistStore: IPreviewAllowlistStore  // ← 47→19
  hostBlockNotifier: IPreviewHostBlockNotifier   // ← 47→24
  projectService: Pick<IProjectService, 'getCurrentProjectPath'>   // NEW-8: the ONLY root source
  globalSettings: Pick<IGlobalSettingsService, 'getSettings' | 'onSettingsChanged'>
  isTrustedSender: (event: IpcMainInvokeEvent | IpcMainEvent) => boolean   // ← 47→42
}
```

`SearchOptions` / `SearchMatch` are re-exported from `useSearchStore` (renderer-only).

---

## 5. Data flow walkthroughs

**(a) Click `page.html` → running page.** `ProjectPanel.handleFileSelect` → `resolvePanelKind`
(in-flight map) → (`.html` only) `preview:checkEligibility` → five ordered checks →
`openFileInPanel(api, path, {kind:'preview', renderer:'always'})`.

**`renderer: 'always'` is required** (X12): dockview's default `onlyWhenVisible`
(`dockview-core/dist/cjs/dockview/options.d.ts:169`, `:46`) removes the element from the DOM when the
tab is inactive, so the `ResizeObserver` would fire 0×0, the view would collapse, and the
`'inactive-tab'` hide path would be dead code.

Panel mount → first rect → `preview:open` → main re-checks eligibility; same-panelId ⇒ replace,
different ⇒ refuse with `holderPanelId` (NEW-9) → `PreviewSessionFactory`:
**load allowlist → `registry.issue(projectPath, hosts)` (the registry builds the CSP via
`buildPreviewCsp` and stores it on the entry) → partition → harden → protocol attach → filter attach
→ `assertSealed`** (throws ⇒ no view). Then
`new WebContentsView({ webPreferences: buildPreviewWebPreferences(session) })` → `addChildView` →
zoom-converted, clamped `setBounds` → `setBackgroundColor(CHROME_BACKDROP)` (§1.8a) → `setWindowOpenHandler` deny
→ `will-navigate` deny → `attachInputForwarding` → `loadURL`.

`did-finish-load` → **rate-limited pipeline** (§1.4) → read entry HTML → `extractStaticLinks` (uses
`parseSrcset`) → **confining** `setWatchSet` (releases awaited before acquires) →
`stillFrameCache.invalidate` → coalesced `preview:loadStateChanged`.

**(b) Save `style.css` → in-place swap.** Pool `change` → `PreviewReloadPolicy.classify` (`.css` ⇒
swap; anything else ⇒ reload; mixed burst ⇒ reload) → `stillFrameCache.invalidate` →
`buildCssSwapScript` → `executeJavaScriptInIsolatedWorld`, raced against `PREVIEW_SWAP_TIMEOUT_MS`.
The script clones the `<link>`, sets a `?v=<counter>` href, **inserts**, awaits `load`, **then**
removes the old node, resolving after one `requestAnimationFrame`. Anything but literal `true` ⇒
`reload()`.

**AC24, re-derived from the WRITE** (X5). Revision 1's arithmetic was unachievable:
`FileWatcherService.ts:29` `DEBOUNCE_DELAY = 300` + `singleFileWatch.ts:30-33` `stabilityThreshold = 300`
+ `WATCH_COALESCE_MS = 120` ≈ 440–720 ms of floor. The preview-owned pool removes both 300 ms terms:

| Stage | Budget |
|---|---|
| `awaitWriteFinish.stabilityThreshold` (preview options) | 50 ms |
| stability poll granularity (`pollInterval: 25`) | ≤ 25 ms |
| `PREVIEW_WATCH_COALESCE_MS` | 30 ms |
| Classify + script build + isolated-world dispatch | ~5 ms |
| In-page `<link>` fetch over `erfana-preview:` (local, `no-store`) | 10–40 ms |
| Stylesheet parse + style recalc + one rAF | 16–50 ms |
| **Total, write → swap promise resolved** | **~136–200 ms typical, ~250 ms upper** |

The stop-clock stays at the **write**. P95 < 300 ms is achievable for the corpus page but tight: the
budget assumes a stylesheet in the low tens of KB and a page in the low thousands of DOM nodes. If
measurement shows the corpus missing, the number to propose is **400 ms**, not a redefined stop-clock.

**(c) Unapproved host → block → toast → approve → reload.** `onBeforeRequest` (**no filter**) →
`decideRequest` → `callback({cancel:true})` → `failureLog.record('blocked-host')` →
`hostBlockNotifier.shouldNotify` → within the 3-host budget, `preview:hostBlocked {host, approvable}`
→ toast, with an Approve action **only when `approvable: true`**.

**The chokepoint is unfiltered** (X2a). Verified: `WebRequestFilter.urls` is **required**
(`electron.d.ts:18730`, no `?`), so revision 1's "filter by types only, never urls" was not writable;
`types` is an **allowlist** (`:18719-18725`) whose unlisted members are never delivered and therefore
never cancellable; `resourceType` includes `'other'` (`:21580`) which `types` cannot express, so
passing *any* `types` array makes every `other` request invisible. Omitting `cspReport`/`ping` made
`fetch('erfana-preview://<token>/.env')` → `navigator.sendBeacon(...)` a zero-interaction silent
exfiltration. Fix: the no-filter overload `onBeforeRequest(listener)` (`:18636`); badge-noise
suppression moved **inside** the handler, **after** the cancel decision.

Approve → `preview:approveHost {panelId, host}` → the handler calls `store.approveHost(host)` (§3.3,
returns the new host set) → then `service.applyApprovedHosts(panelId, hosts)`, which
**`registry.rebuildCsp` → `storageSeal.purge` awaited → `failureLog.clear()` → `reloadIgnoringCache()`**.
Keeping the rebuild+reload behind one service method is what lets the approve handler depend on the
service alone, not on the registry (§4.4). Page state is lost; the reload *is* the retry AC9's wording
permits — stated on the AC22 page or it gets filed as an AC14 bug.

**The Approve toast does not exist yet** (X16): `ToastContext.tsx:6-12` `Toast` is
`{id,title,message,type,duration}` with no action field, and `showToast` (`:38`) defaults `duration`
3000 ms with an unconditional auto-dismiss (`:44-48`). Work item: `action?: {label, onClick}`, rendered,
with `duration: 0` forced when present.

**(d) Dialog → hide → still frame → return.** Any `BaseDialog` opens → the `isOpen` effect pushes
`openDialogStack.length` → microtask-coalesced store notify → `overlayGuard.sync()` →
`visible = isPanelActive() && !isOccluded()` → changed ⇒ `preview:setVisibility(false, 'dialog')`.
Main: idempotent check → **capture first** (`isBeingCaptured()` guard → downscale → emit, or emit
nothing and let the panel fall back to the placeholder colour) → `setVisible(false)`. Capturing before
hiding is mandatory: the capturer count keeps the page visible while a capture is in flight. Close →
`setVisible(true)` → `addChildView(view)` (re-adding an already-present child reorders it topmost).
Tab activation follows the same path via `onDidActivePanelChange` (X18).

**(e) Find-in-page.** `SearchBar` sets `capabilities` and subscribes `onCountChange`. `search()`
resolves `[]` — correct for `matchList:false`. `found-in-page` fires repeatedly; only
`finalUpdate === true` is forwarded. Clearing the query → `clearHighlights()` pushes
`{total:0, activeOrdinal:0}` **before** `stopFindInPage('clearSelection')`, which produces no
`found-in-page` result. Enter/▼ → `navToken + 1` → the relative-nav effect issues
`navToken - lastHandledNavToken` steps. Revision 1's "two presses are two effect runs" was **wrong**
(X15c) — an effect observes only the latest dependency value.

**(f) Project switch.** Main: **`destroy()`** the view → `stillFrameCache.drop` / `failureLog.clear` /
`watchCoordinator.release` / find + input detach → filter and protocol detach →
`hostBlockNotifier.clear()` → `rootRegistry.revoke(oldPath)` (token **and CSP** die together) →
`clearStorageData` + `clearCache` → release the partition. **One partition, because there is one
view** (X20). Renderer: `clearAllEditorTabs()`; `usePreviewLifecycle` cleanup calls `preview:close`,
idempotent.

---

## 6. SearchProvider widening

```ts
export interface SearchCapabilities {
  readonly randomAccess: boolean   // search() returns the full list; navigateTo(index) is real
  readonly matchList: boolean      // search()'s array is authoritative (vs onCountChange pushes)
  readonly wholeWord: boolean      // findInPage has no such option in 39.8.9
}
export interface SearchCount { total: number; activeOrdinal: number }   // 1-based ordinal

export interface SearchProvider {
  readonly id: string; readonly name: string; readonly capabilities: SearchCapabilities
  search(query: string, options: SearchOptions): Promise<SearchMatch[]>
  clearHighlights(): void; dispose(): void
  navigateTo?(index: number, options?: { focusEditor?: boolean }): void  // REQUIRED if randomAccess
  updateCurrentMatch?(currentIndex: number): void                        // REQUIRED if matchList
  nextMatch?(): void; previousMatch?(): void                             // REQUIRED if !randomAccess
  onCountChange?(l: (c: SearchCount) => void): () => void                // REQUIRED if !matchList
}

// PreviewPageSearchProvider — explicit constructor (revision 1 gave it none, X15b)
constructor(panelId: string, bridge: Pick<PreviewBridge,'find'|'stopFind'|'onFindResult'>)
```

`assertProviderContract(provider)` throws when declared capabilities and present members disagree.

| Provider | randomAccess | matchList | wholeWord |
|---|---|---|---|
| `MonacoSearchProvider` | true | true | true |
| `PreviewSearchProvider` (markdown DOM) | true | true | true |
| `PreviewPageSearchProvider` | false | false | false |

**Store**: adds `count`, `capabilities`, `navToken`, `navDirection`. `setMatches` derives `count`
**only when `capabilities.matchList`**. `nextMatch`/`previousMatch` branch on `randomAccess`.
`providerStates` caches **and restores** `capabilities` alongside `count`, and
`restoreProviderState`'s `else` branch (`useSearchStore.ts:180-189`) resets `count`, `navToken` **and**
`capabilities` — otherwise a restored state pairs one provider's `matches` with another's
`capabilities`. The cache is **dormant today** (`setActiveProvider` has no production caller), so this
is correctness-in-advance.

**`SearchBar`**: (1) label is
`capabilities.matchList ? \`${currentIndex+1} of ${matches.length}\` : \`${count.activeOrdinal} of ${count.total}\``
— revision 1 read `count.activeOrdinal` for both, but its only writer is `setMatches`, which
`nextMatch` never calls, so **Monaco's ordinal would have frozen at "1 of 17"**; (2) nav disabled on
the matching branch; (3) call sites unchanged; (4) the navigate effect splits; (5)
`onCountChange` subscription; (6) whole-word toggle disabled when unsupported.

```ts
// Token ref (X15b). Revision 1's [navToken, navDirection, provider] effect ran ON MOUNT with
// navToken 0, issuing an unrequested findInPage({findNext:true}) before any user input.
const lastHandledNavToken = useRef(useSearchStore.getState().navToken)
useEffect(() => {
  if (!provider || provider.capabilities.randomAccess) return
  const steps = navToken - lastHandledNavToken.current
  if (steps <= 0) { lastHandledNavToken.current = navToken; return }
  for (let i = 0; i < steps; i++) {
    navDirection === 'next' ? provider.nextMatch?.() : provider.previousMatch?.()
  }
  lastHandledNavToken.current = navToken
}, [navToken, navDirection, provider])
```

`HtmlPreviewPanel` **must** build its provider in `useMemo(..., [panelId])`.

**Revision 1's "byte-identical" / "unchanged by construction" claims are withdrawn** — change (1) is
precisely the defect they concealed. Monaco is preserved by an explicit branch plus a regression test.

**Files in the same commit (12)**: `SearchProvider.ts` · `MonacoSearchProvider.ts` ·
`PreviewSearchProvider.ts` · `PreviewPageSearchProvider.ts` (new) · `providerAssertions.ts` (new) ·
`search/index.ts` · `useSearchStore.ts` · `SearchBar.tsx` · `SearchBar.test.tsx` ·
`MonacoSearchProvider.test.ts` · `PreviewSearchProvider.test.ts` · `useSearchStore.test.ts`.

**`EditorContentLayout` is NOT in this set** — `HtmlPreviewPanel` renders its own `SearchBar` and never
goes through it; its only consumer is `MarkdownEditorPanel` with the two existing concrete providers.

---

## 7. File-by-file work plan

88 items. **Every `Deps` value is strictly less than its own item number**, so the tree is compilable
at each step. Phases: **1–19** leaf and pure modules; **20–39** the main-process preview service;
**40–51** IPC, main entry, preload; **52–60** the search widening; **61–84** the renderer and lint;
**85–88** docs, the static corpus and doc indexes.

| # | File | Act | What | AC | Deps |
|---|---|---|---|---|---|
| 1 | `shared/errors.ts` | mod | `PREVIEW_*` group incl. `PREVIEW_HOST_NOT_APPROVABLE`, `PREVIEW_CSP_INVALID`. `ERROR_MESSAGES[PREVIEW_LOCAL_FILE_MISSING]` **must quote the path** (`"<path>" could not be read`) — `redactUserInput`'s `QUOTED_SPAN` (`:49`) only replaces between the first and last `"`, so an unquoted message makes item 2 a no-op | 20 | — |
| 2 | `main/utils/redactUserInput.ts` | mod | `PREVIEW_LOCAL_FILE_MISSING` → `USER_INPUT_CODES` (`:28`) | 20 | 1 |
| 3 | `shared/constants.ts` | mod | `PREVIEW` block: asset/watch/failure caps, `WATCH_COALESCE_MS: 30`, `WATCH_STABILITY_MS: 50`, `CLOSE_TIMEOUT_MS`, `SWAP_TIMEOUT_MS`, `FAILURE_COALESCE_MS: 250`, `MAX_HOST_TOASTS: 3`, `RELOAD_MIN_INTERVAL_MS: 750`, frame caps | — | — |
| 4 | `shared/ipc/preview-types.ts` | new | **Leaf type module** (§4.4) incl. `PreviewEmitters`, so items 11–39 do not depend forward | — | 1,3 |
| 5 | `preview/previewExclusion.ts` | new | `isInExcludedDirectory`, `hasDotSegment`, `hasShortNameAlias` | 12 | — |
| 6 | `preview/previewFilterDecision.ts` | new | Pure `decideRequest` | 7,8 | 4 |
| 7 | `preview/previewSrcset.ts` | new | Pure `parseSrcset` | 13 | — |
| 8 | `preview/linkExtract.ts` | new | Pure `extractStaticLinks` (parse5 ^8.0.1) | 13 | 7 |
| 9 | `preview/previewScheme.ts` | new | `PREVIEW_SCHEME`, `registerPreviewScheme` | 2 | — |
| 10 | `shared/ipc/preview-settings-schema.ts` | new | Versioned allowlist + `isApprovableHost` (zod v4) | DoD2,9 | — |
| 11 | `preview/previewPathResolve.ts` | new | `isSafeSegment`, `confinePath`, `resolveConfined` (§2.4 incl. 8h + `readExactly`) | 3,4 | 1,4,5 |
| 12 | `preview/previewCsp.ts` | new | `buildPreviewCsp`; skip-and-badge on a rejected host, never throw | 2,8 | 1,4,10 |
| 13 | `preview/previewResponseHeaders.ts` | new | Null-prototype MIME table; `isKnownAssetType`; `buildResponseHeaders` — **single CSP application site**, rejects an invalid CSP | 2,5,6 | 4,12 |
| 14 | `preview/PreviewRootRegistry.ts` | new | **Owns token + CSP**; `issue(projectPath, hosts)` builds + stores the CSP, `rebuildCsp` | 4 | 4,9,12 |
| 15 | `preview/PreviewFailureLog.ts` | new | Ring buffer; Cf/Cc strip; emission coalescing | 7,10,20 | 1,3,4 |
| 16 | `preview/previewConsoleClassify.ts` | new | Pure console classifier | 7 | 1,4,15 |
| 17 | `main/utils/atomicWrite.ts` | mod | Optional `space` param (default unchanged) | 9 | — |
| 18 | `preview/erfanaDirGate.ts` | new | `resolveErfanaDir` (X3) | 9 | 11 |
| 19 | `preview/PreviewAllowlistStore.ts` | new | Independent parse + atomic write-back; root from `ProjectService`; returns the new host set (no registry, no view) | 9 | 10,17,18 |
| 20 | `preview/PreviewProtocolHandler.ts` | new | `protocol.handle` on the partition session; the ONLY CSP application site via `entry.csp` | 2,4,6 | 11,13,14,15 |
| 21 | `preview/previewSessionPolicy.ts` | new | Frozen prefs + `buildPreviewWebPreferences(session)`; `hardenPreviewSession` (permissions/downloads/WebRTC; **no header touch**) | 2,3,5 | 12,13 |
| 22 | `preview/PreviewStorageSeal.ts` | new | `assertSealed`; `purge` = `clearStorageData` over `PURGED_STORAGES` + `clearCache` + auth/resolver/code caches | 5 | 13,21 |
| 23 | `preview/PreviewRequestFilter.ts` | new | Unfiltered `onBeforeRequest`; per-hop redirects; started/settled; timeout sweep | 8,10 | 6,15 |
| 24 | `preview/PreviewHostBlockNotifier.ts` | new | `MAX_HOST_TOASTS` budget | 8 | 3 |
| 25 | `shared/ipc/project-settings-schema.ts` | mod | `htmlPreview: z.unknown().optional()` **only** | 9 | — |
| 26 | `preview/GitignoreEvaluator.ts` | new | Hardened `git check-ignore` with an **env allowlist** | 12 | — |
| 27 | `shared/ipc/global-settings-schema.ts` | mod | `HtmlPreviewSettingsSchema` + `htmlPreview`; correct the stale `@see Issue #74 - real-time git status refresh` at `:37` | 21 | — |
| 28 | `preview/PreviewEligibilityService.ts` | new | Five ordered checks | 12,21 | 5,26,27 |
| 29 | `watcher/singleFileWatch.ts` | mod | Optional `overrides` param (+4 lines; call sites byte-identical) | 13,24 | — |
| 30 | `preview/PreviewWatchPool.ts` | new | Preview-owned chokidar pool | 13,24 | 3,29 |
| 31 | `preview/PreviewWatchCoordinator.ts` | new | Confining diffing set-watch via `confinePath`; releases awaited before acquires | 13 | 4,8,11,30 |
| 32 | `preview/PreviewReloadPolicy.ts` | new | Pure classify + coalesce | 14 | 3 |
| 33 | `preview/previewCssSwap.ts` | new | Swap script builder | 14 | 3 |
| 34 | `preview/PreviewStillFrameCache.ts` | new | Capture on hide; downscale; no-frame fallback | 19 | 3,4 |
| 35 | `preview/PreviewFindController.ts` | new | `finalUpdate`-only forwarding | 15 | 4 |
| 36 | `preview/previewInputForward.ts` | new | `PREVIEW_FORWARDED_SHORTCUTS` + attach | 15 | — |
| 37 | `preview/PreviewExportController.ts` | new | `printToPDF` of the live wc; own dialog; imports `deriveSafeFilename`. **`PdfService` NOT modified** | 16 | 1,4 |
| 38 | `preview/PreviewSessionFactory.ts` | new | load allowlist → `registry.issue` (registry builds CSP) → partition → harden → protocol → filter → seal | 2,3 | 14,19,20,21,22,23 |
| 39 | `preview/PreviewViewService.ts` | new | Lifecycle; single view + replace-same-panel; clamp + zoom; reload rate limit; bounded destroy; `applyApprovedHosts`; `destroyAll`; 4 lifecycle events | 1,2,14,17,19,21 | 4,15,22,31,32,33,34,35,36,37,38 |
| 40 | `shared/ipc/preview-channels.ts` | new | Channel constants | — | — |
| 41 | `shared/ipc/preview-schema.ts` | new | All payloads, all `.strict()`; `PreviewBridge` | 20 | 1,4,10,40 |
| 42 | `ipc/preview/isTrustedPreviewSender.ts` | new | Preview's own sender predicate (§7.1 item 31) | — | — |
| 43 | `ipc/preview/emit.ts` | new | `PreviewEmitters` impl; re-validate + `isDestroyed()`; coalescing | — | 3,41 |
| 44 | `ipc/preview/lifecycle-handlers.ts` | new | eligibility/open/close/bounds/visibility/reload | — | 28,39,41,42,43 |
| 45 | `ipc/preview/find-handlers.ts` | new | find/stopFind/exportPdf | 15,16 | 35,37,41,42 |
| 46 | `ipc/preview/allowlist-handlers.ts` | new | approveHost: store.approveHost → service.applyApprovedHosts | 9 | 19,39,41,42 |
| 47 | `ipc/preview-handlers.ts` | new | Composition root; `onSettingsChanged` → `destroyAll`; constructs service + eligibility + store + notifier | 21 | 19,24,27,28,39,42,44,45,46 |
| 48 | `main/index.ts` | mod | **+5 lines**: scheme pre-ready, bundle var, register, dispose | — | 9,47 |
| 49 | `preload/previewBridge.ts` | new | The whole bridge in its own module | — | 40,41 |
| 50 | `preload/index.ts` | mod | **+2 lines**: import + spread | — | 49 |
| 51 | `preload/index.d.ts` | mod | `preview: PreviewBridge` | — | 41 |
| 52 | `providers/search/SearchProvider.ts` | mod | `SearchCapabilities`, `SearchCount`, widened interface | 15 | — |
| 53 | `providers/search/MonacoSearchProvider.ts` | mod | Add `capabilities` | 15 | 52 |
| 54 | `providers/search/PreviewSearchProvider.ts` | mod | Add `capabilities` | 15 | 52 |
| 55 | `providers/search/PreviewPageSearchProvider.ts` | new | Count-only; explicit ctor; `clearHighlights` pushes a zero count first | 15 | 41,52 |
| 56 | `providers/search/providerAssertions.ts` | new | `assertProviderContract` | 15 | 52 |
| 57 | `providers/search/index.ts` | mod | Exports | 15 | 52,53,54,55,56 |
| 58 | `stores/useSearchStore.ts` | mod | `count`/`capabilities`/`navToken`; cache+restore `capabilities` | 15 | 52 |
| 59 | `components/Search/SearchBar.tsx` | mod | The six changes + token ref | 15 | 52,58 |
| 60 | Search test files | mod | `SearchBar.test.tsx` (the `:32` double), `MonacoSearchProvider.test.ts`, `PreviewSearchProvider.test.ts`, `useSearchStore.test.ts` | 15 | 52,53,54,55,56,57,58,59 |
| 61 | `stores/useOverlayOccluderStore.ts` | new | Counts + **microtask-coalesced notify** + dev assertion | 17,18 | — |
| 62 | `hooks/useOccluder.ts` | new | Register/release hook | 17,18 | 61 |
| 63 | `Dialog/BaseDialog.tsx` | mod | **+2 lines in the `isOpen` effect (`:299-300`)**, NOT inside the stack functions (NEW-10) | 17 | 61 |
| 64 | `Toast/ToastContext.tsx` | mod | `action?: {label,onClick}`; `duration:0` when actionable; occluder push | 8,17 | 61 |
| 65 | `Toast/ToastNotification.tsx` | mod | Render the action button | 8 | 64 |
| 66 | `ContextMenu/ContextMenu.tsx` | mod | `useOccluder('menu', …)` | 17 | 62 |
| 67 | `ImageViewerPanel/hooks/useFullScreenOverlay.ts` | mod | `useOccluder('overlay', …)` | 17 | 62 |
| 68 | `stores/usePreviewStore.ts` | new | Per-panel state incl. `holderPanelId` | 19,20 | 4,41 |
| 69 | `services/preview/OverlayGuardService.ts` | new | Single hide/show owner | 17,18 | 61,68 |
| 70 | `utils/openFileInPanel.ts` | mod | `FilePanelKind`, `renderer` option, `buildPanelId(kind, path)`; `getFilePanelId(path)` stays kind-free | 1,11,12 | 4 |
| 71 | `Panels/HtmlPreviewPanel/**` | new | 11 files **+ `HtmlPreviewPanel.css`**; memoised provider; still-frame fallback; limit-reached state uses `holderPanelId` + **`openFileInPanel(kind:'editor')`** | 1,19,20 | 55,59,68,69,70 |
| 72 | `components/Tabs/HtmlPreviewTab.tsx` | new | Tab component | 1 | — |
| 73 | `utils/monacoLanguage.ts` | new | Extension → language id | 11 | — |
| 74 | `utils/monacoLanguageServices.ts` | new | `disableWorkerLanguageServices` | 11 | — |
| 75 | `Editor/MonacoMarkdownEditor.tsx` | mod | **2 lines** (`:417` language, `:14` services) | 11 | 73,74 |
| 76 | `utils/resolvePanelKind.ts` | new | Async kind resolution + per-path in-flight promise map | 1,12,21 | 41,70 |
| 77 | `Panels/ProjectPanel.tsx` | mod | `handleFileSelect` (`:78-88`) async | 1,12 | 76 |
| 78 | `Panels/TerminalPanel.tsx` | mod | **~4 lines** at `:277` | 12 | 76 |
| 79 | `Panels/MarkdownEditorPanel.tsx` | mod | Replace hand-built id `:430-449`; **net −9** | 12 | 70 |
| 80 | `DockLayout/components/EditorAreaSplitPanel.tsx` | mod | Register panel + tab; `sync()` from `onDidActivePanelChange` (`:74`); drag occluder | 1,17 | 69,71,72 |
| 81 | `ProjectTree/context-menu/*` + `ProjectTree.tsx` + `__test__/testUtils.tsx` | mod | `openAsSource` on `.html` nodes | 11 | 70 |
| 82 | `Settings/sections/HtmlPreviewSection.tsx` | new | AC21 toggle | 21 | 27 |
| 83 | `Settings/SettingsOverlay.tsx` | mod | **+3 lines** | 17,21 | 62,82 |
| 84 | `eslint.config.mjs` | mod | **Two selectors into the SAME array** at `:125-153` | 18 | 69 |
| 85 | `docs/security.md` | mod | Threat model §2.8 (with the NEW-6/NEW-7 corrections) — DoD gate 1 | DoD1 | all |
| 86 | `docs/features/html-preview.md` + README | new/mod | AC22 page | 22 | all |
| 87 | `e2e/fixtures/html-preview-corpus/**` | new | Five corpus pages with machine-checkable sentinels (self-contained, multi-file, CDN, error, runaway loop). **Static HTML/CSS/JS — no code dependency.** An INPUT: needed while items 38–39 and 71 are built and by the AC24/AC25 tests, not after the code. Buildable at any time; `Deps: —` reflects that, not a late position | 24,25 | — |
| 88 | Doc index updates | mod | `ipc-patterns.md`, `api-services-features.md`, `error-codes.md`, CHANGELOG, CLAUDE.md service catalogue | — | all |

**Line-count containment:**

| File | Today | Δ | Containment |
|---|---|---|---|
| `preload/index.ts` | **1153** | **+2** | Whole bridge in `preload/previewBridge.ts` |
| `MarkdownEditorPanel.tsx` | 614 | **−9** | Deletes the hand-built id and the file's only `eslint-disable` |
| `main/index.ts` | 614 | +5 | Scheme + bundle are one line each |
| `SettingsOverlay.tsx` | 601 | +3 | Section body in a new file |
| `TerminalPanel.tsx` | 1352 | +4 | Inside the existing callback |
| `shared/errors.ts` | 425 | ~+44 → **469** | Enum + message entries only |
| `shared/constants.ts` | 446 | ~+42 → **488** | One `PREVIEW` block — **close to the limit**; the next constant goes in `shared/config/preview-config.ts` |
| `BaseDialog.tsx` | ~330 | +2 | Two lines in the existing effect |
| `PdfService.ts` | 862 | **0** | Not modified (§1.7) |
| `FileWatcherService.ts` | 498 | **0** | Not touched (X4) |
| `watcher/singleFileWatch.ts` | ~70 | +4 | Optional param only |

### 7.1 Deferred debt to record at Phase 10

Items **31–33** are the next free numbers (highest today is 30; the file never reuses numbers), each
in the file's `**Severity** / **Impact** / **Problem** / **Recommended Solution** / **Files** /
**Status**` shape with a `(#74, 2026-08)` suffix.

* **31 — `isTrustedSender` now exists in three copies.** Low. The predicate is duplicated in
  `clipboard-handlers.ts`, `claude-status-handlers.ts:62-80` and (new) `preview/isTrustedPreviewSender.ts`.
  Drift is the failure mode for a security predicate. Not fixed in #74 because rewriting a working
  predicate in two files this feature does not otherwise touch is regression surface for zero AC
  coverage; it lives in its own module so the extraction is a file move plus two import edits.
  Solution: move to `src/main/ipc/isTrustedSender.ts`, import from all three, collapse three test files
  into one.
* **32 — Residual realpath→open race.** Medium. The parent chain is realpath-confined before the open
  and `O_NOFOLLOW` blocks the final component, but Node has no `openat`, so the chain cannot be walked
  atomically; an attacker able to rename a parent directory between the two (or between the dev/ino
  compare and the 8h re-resolve) can redirect a read. Requires local write access already inside the
  project. Solution: revisit if Node exposes `openat`. Files: `previewPathResolve.ts`.
* **33 — Hardlinks defeat path confinement.** Medium. "`realpath` resolves symlinks but not hardlinks,
  so a hardlink planted inside the project to a file outside it is served as an in-project file. Not
  defended — a reliable check needs device + link-count heuristics with false positives, and planting
  one requires local code execution, which is already outside the preview's threat model." Files:
  `previewPathResolve.ts`, `docs/security.md`.

---

## 8. Test plan

`vitest.main.ts` (`src/main/**`, `src/shared/**`, `scripts/**`) and `vitest.renderer.ts`
(`src/renderer/src/**`) both run in the required `test` job. `e2e.yml` is **disabled** and excluded
from required checks. `windows-checks` runs only `typecheck` + `test:main`, so every Windows-sensitive
behaviour lives main-side or in `src/shared/`.

> **What the required job locks, and what it does not.** Under `vi.mock('electron')` the main-project
> tests verify **configuration**, not **behaviour**: that `omit(getLastWebPreferences(),'session')`
> equals the frozen literal, that the CSP contains `sandbox allow-scripts` and no `'self'`, that the
> partition name has no `persist:`, that the protocol handler returns 403 for an escape, that
> `purge()` precedes `reload`. They do **not** verify that the opaque origin makes `localStorage`
> throw, that a `<meta>` CSP cannot restore `allow-same-origin`, that `storagePath` is really `null` at
> runtime, or that the page runs in a **separate OS process**. Those are Chromium runtime properties
> and live only in `e2e/`, which gates nothing. **Merge gate 3 is met in its configuration-locking
> half and unmet in its behavioural half**; the behavioural half is a local pre-release checklist item.

| AC | Test | Cat | Assertion |
|---|---|---|---|
| 1 | `HtmlPreviewPanel.test.tsx` | R | Rect forwarded verbatim; "full width" = the Dockview editor-area content rect; `renderer:'always'`; the limit-reached state renders **Close the other preview** driven by `holderPanelId` and **Open as source** calling `openFileInPanel(kind:'editor')` |
| 1 | `useViewBounds.test.ts` | R | 0×0 not forwarded; rAF coalescing; trailing send at 120 ms |
| 2 | `previewSessionPolicy.test.ts` | M | `buildPreviewWebPreferences(session)` returns `{...PREVIEW_WEB_PREFERENCES, session}`; **`omit(getLastWebPreferences(),'session')` `toStrictEqual` the frozen literal**, so adding a key at the construction site fails; `'preload' in prefs === false`; zero `net.Server`; `isProtocolHandled`; partition `!== defaultSession`; `setWebRTCIPHandlingPolicy` called; **`hardenPreviewSession` registers NO `onHeadersReceived` handler** (round-4 option b) |
| 2 | e2e + §11 manual | e2e | `getOSProcessId() !== process.pid`. **Not provable in the required job** |
| 3 | `PreviewViewService.sealedbox.test.ts` | M **DoD3** | The NEW-2 assertion above; `contextIsolation`/`sandbox`/`nodeIntegrationInSubFrames:false`/`webviewTag:false`/`webSecurity:true`; **symlink-escape and out-of-root-realpath cases** — replacing revision 1's `../../etc/passwd`, unreachable because `standard:true` makes Chromium collapse `..` (incl. `%2e%2e`) before `protocol.handle` sees it |
| 4 | `previewPathResolve.test.ts` | M | Symlinked final component (ELOOP ⇒ 404); symlinked intermediate dir; out-of-root realpath ⇒ 403; dev/ino mismatch ⇒ 403; NUL/`\` ⇒ 400; root ⇒ 403; **a file grown between stat and read is truncated at the cap and 413s** (NEW-11); a spy asserts `handle.close()` on **every** failure path incl. 404/413/500. Plus a case proving normalize-only confinement would have passed |
| 4 | `previewPathResolve.win32.test.ts` | M | **NEW-1**: with a mocked `fsPromises.realpath` returning long names, `<root>/ENV~1` and `GIT~1/config` are **403 `excluded-path`** at step 8h; `hasShortNameAlias` rejects `/~[0-9]/` segments on `win32` only; a long name legitimately containing `~1` is served on POSIX |
| 5 | `PreviewStorageSeal.test.ts` | M | CSP contains `sandbox allow-scripts`, not `allow-same-origin`; no `persist:`; `assertSealed` throws on a persistent partition; **`purge()` calls both `clearStorageData` and `clearCache`**, ordered before `reload` |
| 5 | `e2e/html-preview.storage.spec.ts` | e2e | `localStorage` throws; nothing on disk after reload or restart. **Behavioural half of gate 3** |
| 6 | `linkExtract.test.ts` + `previewSrcset.test.ts` | M | Exact relative paths; table-driven `parseSrcset` incl. **commas inside URLs** |
| 6 | `previewResponseHeaders.test.ts` | M | Always CORP `cross-origin`, literal `*` ACAO, **`X-DNS-Prefetch-Control: off`**; `.css`→`text/css`, `.js`/`.mjs`→ a JS MIME; `isKnownAssetType` for the 20-extension list; `.constructor`/`.__proto__`/`.toString` ⇒ `application/octet-stream`; **`buildResponseHeaders` throws `PREVIEW_CSP_INVALID` for `''`, for a CSP missing `sandbox allow-scripts`, and for one missing `default-src 'none'`** (NEW-3); **this is the single CSP application site — no `onHeadersReceived` overwrite exists** |
| 6 | `previewCsp.test.ts` | M | Empty allowlist ⇒ `erfana-preview:` only, no `https:`; two hosts ⇒ exactly `https://a https://b`; **a rejected host is omitted and badged, and the function never throws** (NEW-4); property test rejects `;`, space, quote, `\r`, `\n`, non-ASCII |
| 6 | `PreviewRootRegistry.test.ts` | M | `issue` builds + stores the CSP on the entry; `rebuildCsp` replaces it; `revoke` drops token **and** CSP; the protocol handler reads `entry.csp` and **never** receives `''` |
| 7a | `previewFilterDecision.test.ts` | M | Allow decision only, never real network |
| 7b | `previewConsoleClassify.test.ts` | M | Uncaught exception ⇒ `script-error`; bare specifier ⇒ `unresolved-specifier` naming it; unrelated ⇒ `null`; Cf/Cc stripped; 512-char truncation |
| 7b | `PreviewProtocolHandler.mime.test.ts` | M | `.tsx` with `sec-fetch-dest: script` records `unsupported-asset-type`, still 200 |
| 8 | `PreviewRequestFilter.test.ts` | M | Registered via the **no-filter overload** — a spy asserts one argument; a `ping` request to an unapproved host is **cancelled**; `onRequestStarted` only on allow |
| 8 | `PreviewRequestFilter.redirect.test.ts` | M | Allowlisted host → unapproved is cancelled and badged at hop 2; a hop targeting `erfana-preview:` is refused even when the host is allowlisted |
| 8 | `PreviewHostBlockNotifier.test.ts` | M | First 3 distinct hosts toast; the 4th is badge-only |
| 8 | `Toast.action.test.tsx` | R | Actionable toast renders its button, `duration === 0`; `approvable:false` renders no Approve |
| 8 | `preview-schema.hosts.test.ts` | M | `[::1]`, `foo_bar.example`, `example.com.` each produce **both a toast payload and a badge entry**, `approvable:false` |
| 9 | `PreviewAllowlistStore.test.ts` | M | 2-space indent **and trailing newline**; **an existing pretty-printed file keeps its formatting**; `$schema` and unknown keys survive; malformed aborts without overwriting; version 2 refuses read and write; **a project with an invalid allowlist still opens**; **`approveHost` takes no root parameter, reads it from `ProjectService`, and returns the new host set without touching the registry or the view** |
| 9 | `allowlist-handlers.test.ts` | M | `PreviewApproveHostRequestSchema` **rejects** a payload containing `projectRoot` or `projectPath` (NEW-8); after `store.approveHost` the handler calls `service.applyApprovedHosts(panelId, hosts)` |
| 9 | `erfanaDirGate.test.ts` | M | Symlinked `.erfana` **refused**; non-recursive `mkdir` raises EEXIST; `relative(realRoot, real) === '.erfana'` |
| 9 | `preview-settings-schema.test.ts` | M | `isApprovableHost` rejects `127.0.0.1`, `[::1]`, `0x7f.1`, `localhost`, `db.localhost`, `printer.local`, `svc.internal`, an all-numeric label set; accepts `cdn.jsdelivr.net` |
| 9 | `project-settings-schema.test.ts` | M | An invalid `htmlPreview` block does **not** fail `ProjectSettingsSchema` |
| 10 | `PreviewRequestFilter.timeout.test.ts` | M | One `network-timeout` within `REQUEST_TIMEOUT_MS + TIMEOUT_SWEEP_MS`; **no toast**; **an allowed request that completes produces NO timeout entry** |
| 11 | `monacoLanguage.test.ts` + `monacoLanguageServices.test.ts` | R | Extension mapping; disabling setters called on css/scss/less, html, json, ts/js |
| 11 | `strategies.test.tsx` | R | "Open as source" on `.html`/`.htm` only; `kind:'editor'` |
| 12 | `previewExclusion.test.ts` | M | Exhaustive: five dirs at root and nested; `\` separators; mixed case; decoys (`my-node_modules`, `distribution`) must **not** match; `hasDotSegment` at any depth; `hasShortNameAlias` |
| 12 | `GitignoreEvaluator.test.ts` | M | Exit 0/1/128 → ignored/not/fail-open; TTL cache; argv contains `-C`, `--no-optional-locks`, `-c core.fsmonitor=`, `--`; `cwd` is **not** the project root; **the child env contains ONLY the allowlist plus `GIT_CONFIG_NOSYSTEM=1` — asserted positively, so `GIT_TRACE`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_PROXY_COMMAND` and `GIT_CEILING_DIRECTORIES` cannot survive** (NEW-13); `shell:false`; absolute binary path |
| 13 | `PreviewWatchCoordinator.test.ts` | M | Diff behaviour; **an out-of-root candidate is dropped, counted and badged, and NO watch is acquired**; **releases are awaited before acquires**; over-cap paths in `dropped` in priority order; a test documents that a JS-injected `<link>` is not watched |
| 13 | `PreviewWatchPool.test.ts` | M | Uses `createSingleFileWatcher` with `stabilityThreshold: 50`; existing call sites unchanged; `dispose()` closes every watcher |
| 14 | `PreviewReloadPolicy.test.ts` | M | `.css` ⇒ swap; others ⇒ reload; mixed burst ⇒ reload |
| 14 | `previewCssSwap.test.ts` + `PreviewViewService.swap.test.ts` | M | Inserts before removing, awaits `load`; runs via `executeJavaScriptInIsolatedWorld`; **timeout, throw, `false` and a non-boolean each fall back to `reload()`**; `oldHrefBase` derived main-side without `?v=` |
| 15 | `PreviewFindController.test.ts` | M | Non-final `found-in-page` not forwarded; `find` passes exactly `{forward,findNext,matchCase}` |
| 15 | `SearchBar.countOnly.test.tsx` | R | Label from the pushed count; nav enabled on `count.total>0`; Enter calls `nextMatch()`; whole-word disabled; **no `findInPage` on mount**; **clearing the query resets the label** |
| 15 | `SearchBar.monaco.regression.test.tsx` | R | Stepping through 17 matches shows "2 of 17", "3 of 17"… — not a frozen "1 of 17" |
| 15 | `useSearchStore.test.ts` | R | Switching provider twice never pairs one provider's `matches` with another's `capabilities`; the `else` branch resets `count`, `navToken`, `capabilities` |
| 15 | `previewInputForward.test.ts` | M | Exactly the listed shortcuts forwarded with `preventDefault()` — `f`/`s`/`w`/`Escape` only, and the forwarded set is pinned equal to `PreviewForwardedShortcutSchema`; Cmd+R, Cmd+P and plain typing are not. Zoom keys are NOT forwarded: the View menu owns page zoom, and forwarding them too would zoom twice per keypress |
| 1.8a | `previewBackdrop.test.ts` | M | The transition table over all five events; a `start`→`stop` burst settles on the page colour; a reload never repaints chrome; a crash does. The readability assertion is a **property, not a literal** — the painted backdrop must reach 4.5:1 against black, which `#161312` (≈1.2:1) cannot pass for the wrong reason |
| 1.8a | `toastPlacement.test.ts` | R | Hand-built rects (jsdom does no layout): no overlap; partial; full cover ⇒ `blocked`; exact touch yields clearance, not 1 px. Plus: the occluder is registered **only** on `blocked`, and the published rect is cleared on hide and on unmount |
| 1.8a | `PreviewViewService.test.ts` | M | Closing a window drains its views without warning; the destroyed-window fake's `removeChildView` must **throw**, or the assertion passes against unfixed code |
| 16 | `PreviewExportController.test.ts` | M | `printToPDF` with `printBackground:true`; `deriveSafeFilename` applied; **`PdfService` not imported** |
| 17 | `OverlayGuardService.test.ts` | R | One case per trigger — **tab activation**, dialog, settings, toast, context menu, full-screen overlay. Case 4 (tab drag) has **no test**: `EditorAreaSplitPanel.tsx:119` sets `disableDnd`, so it is unreachable; AC17 is three testable cases plus one structurally covered |
| 17 | `BaseDialog.occluder.test.tsx` | R | Opening any BaseDialog raises the count; nesting two and closing one keeps it raised; **a single `registerOpenDialog` produces exactly ONE occluder notification (not 0 then 1), and a `zIndex` change produces none** (NEW-10); the dev assertion fires for a high-z-index element mounted with count 0 |
| 18 | `scripts/preview-eslint-guard.test.ts` | M | **A source scan, not in-process ESLint**: (a) `eslint.config.mjs` contains both new selectors inside the single `no-restricted-syntax` array; (b) scanning `src/renderer/**`, `OverlayGuardService.ts` is the only hit for `SET_VISIBILITY` / `api.preview.setVisibility`. Under `scripts/` because `vitest.main.ts:10` includes `scripts/**/*.test.{js,mjs,ts}`; in-process ESLint is dropped because the required job greps all vitest output for deprecation lines (`checks.yml:104`) |
| 19a | `PreviewStillFrameCache.test.ts` | M | Frame after a hide, PNG prefix, dimensions equal the downscaled bounds; longest edge ≤ cap; data URL under cap; **over-budget, skipped or throwing capture emits NO frame** and the panel shows the placeholder colour; no capture on bounds change; capture after `invalidate` |
| 19b | AC22 release checklist | manual | "No visible flash on hide/show" |
| 20 | `preview-schema.test.ts` + `PreviewFailureLog.test.ts` | M | Entry shape; `resourceUrlOrHost` never absolute (property test); **Cf/Cc stripped**; ring buffer caps and sets `truncated`; **emission ≤1 send per 250 ms with a trailing send**; **all 14 `type` values have a named producer** |
| 20 | `redactUserInput.preview.test.ts` | M | A `PREVIEW_LOCAL_FILE_MISSING` message with a quoted path is redacted with **no path fragment surviving** |
| 21 | `PreviewEligibilityService.test.ts` + `preview-handlers.test.ts` | M | Global-off with a populated allowlist ⇒ `globally-disabled`, `open` refused, **no `WebContentsView` and no partition constructed**; flipping `enabled` false via `onSettingsChanged` **destroys the live view and revokes the token** |
| 22 | `docs/features/html-preview.md` | review | No build step; the allowlist is a speed bump; **approval reloads and loses state**; the AC13 static-link limit; sandbox breakage — `localStorage` throws, **`alert`/`confirm`/`prompt` and `<a download>` silently no-op**, linked-sheet CSSOM unreadable; dot-prefixed files unservable; the `0600` mode change; two-windows behaviour; **Erfana never asks for credentials inside a preview**; §2.8 accepted risks in user language |
| 23 | `windows-checks` | CI | `typecheck` + `test:main`, covering `src/main/services/preview/**`, `src/main/ipc/preview/**`, `src/shared/ipc/preview-*` and `scripts/preview-eslint-guard.test.ts`. Named Windows cases: **8.3 short-name aliases (`ENV~1`, `GIT~1`) and the `~[0-9]` segment rule**; `\` separators; a `C:\…` root round-tripping with **no drive letter in the URL**; `renameWithRetry` EPERM; `NULL_DEVICE` in the git argv; `where`-resolved absolute git path |
| 24 | `e2e/html-preview.perf.spec.ts` | e2e gate | P95 < 300 ms over 20 CSS saves on corpus page 2, **clocked from the write** |
| 25 | `e2e/html-preview.corpus.spec.ts` + `PreviewViewService.corpus.test.ts` | e2e + M | Five sentinels: (1) `-OK-1` via `wc.getTitle()`; (2) `-OK-2` only after CSS **and** image land; (3) `-OK-3` against a **real allowlisted CDN**, skipped when offline; **no `setCertificateVerifyProc` or any certificate bypass in the preview partition, tests included**; (4) error page ⇒ ≥3 badge entries incl. `unsupported-asset-type`, `isDestroyed()===false`; (5) runaway loop ⇒ IPC round trip within 1 s, and `close()` resolves within `PREVIEW_CLOSE_TIMEOUT_MS` |
| — | `PreviewViewService.lifecycle.test.ts` | M | `render-process-gone`/`unresponsive` ⇒ `failed` + badge, Reload live; entry unlink ⇒ `failed` + banner; rename treated as delete; **a second `open` with the SAME panelId replaces; with a DIFFERENT panelId refuses and returns `holderPanelId`** (NEW-9) |
| — | `PreviewViewService.bounds.test.ts` | M | Zoom factor 1.5 scales the applied rect (**multiply**); a rect exceeding the window content rect is clamped; width or height `<= 0` dropped |
| — | `PreviewViewService.reloadStorm.test.ts` | M | **NEW-5**: 20 `did-finish-load` events inside `RELOAD_MIN_INTERVAL_MS` produce **one** entry-HTML read, **one** `setWatchSet` and **one** `loadStateChanged`; watcher release is awaited before the next acquire |

**Coverage floors** in `vitest.main.ts` — note `coverage.include` today is
`['src/main/**/*.{ts,tsx}', 'scripts/**/*.{js,mjs}']` (`vitest.main.ts:24`), which **excludes
`src/shared/**`**, so `isApprovableHost` — the one predicate gating both the approve path and the CSP
contents — would carry no floor (NEW-12). Add `src/shared/ipc/preview-*.ts` to `coverage.include`, then
floor at 95/95/95/95: `previewPathResolve.ts`, `previewFilterDecision.ts`, `previewResponseHeaders.ts`,
`previewCsp.ts`, `previewExclusion.ts`, `erfanaDirGate.ts`, `shared/ipc/preview-settings-schema.ts`.

---

## 9. Risks and mitigations

**R1 — Bounds-sync tearing** (high/med). rAF coalescing + 120 ms trailing + `seq` + the placeholder
painted with whatever the native view's backdrop currently is, kept in step by `preview:backdropChanged`
(§1.8a). Residual: 1–2 frames of seam under load.

**R2 — Watcher file descriptors** (med/med). The pool is **additive** to `FileWatcherService`'s
app-wide `MAX_WATCHED_FILES = 100`. One live view × 16 files ⇒ **116 worst case**. chokidar is pinned
to v3 **for fd reasons** (`singleFileWatch.ts:16`); this repo has a documented EMFILE history
(#146–#151). Mitigations: the 16 cap, one live view, priority ordering, `dropped` surfaced,
**releases awaited before acquires** so a reload storm cannot stack FDs transiently, pool `dispose()`
on close and project switch. Residual: ~90 editor tabs plus a preview approaches the trouble zone.

**R3 — Overlay coverage gaps** (certain/high). Pushing from `BaseDialog`'s `isOpen` effect covers every
current and future dialog; four non-BaseDialog overlays register explicitly; a dev assertion catches
the next. Residual: an overlay that is neither paints under the view until seen in development.

**R4 — Path confinement** (low/critical). realpath-confined parent + `O_NOFOLLOW` + dev/ino +
**post-resolve exclusion re-check** + the watch coordinator reusing the same gate. **Residual is real
and documented**: hardlinks, the realpath→open race, and unconfirmed Windows alias forms (§2.8 risks
6, 7, 10; debt 32–33).

**R5 — Windows** (high/high). No filesystem path in a URL; absolute git binary; safe cwd; per-platform
`NULL_DEVICE`; short-name handling at two layers. Every Windows-sensitive test is main-side. Residual:
UNC / network volumes accepted as broken (#60); the `.env` alias form needs host confirmation.

**R6 — The `deprecated` CI tripwire** (low/med). No new npm dependency; `protocol.handle` only;
Electron mocked; `z.nativeEnum` avoided; the AC18 guard is a source scan rather than in-process
ESLint. Residual: a future Electron or vitest bump — which is what the tripwire exists to catch.

**R7 — Over-500-line files** (certain/low). See §7; `constants.ts` lands at ~488 with the overflow
destination named.

**R8 — `sandbox allow-scripts` breaks working pages** (med/med). AC5 behaviour; errors land in the
badge; AC6 unaffected (§2.7). Residual: `alert`/`confirm`/`prompt` and `<a download>` silently no-op.

**R9 — Approval reload loses state** (certain/low). Stated on the AC22 page.

**R10 — Runaway loops and reload storms** (med/low). No watchdog (operator decision); own process;
bounded destroy; the post-load pipeline is rate-limited so Erfana's own work per page-initiated reload
is capped.

**R11 — UI spoofing** (med/high). Clamped rect + retained tab/toolbar chrome + "Erfana never asks for
credentials inside a preview" + the always-DOM Erfana bar the view sits below. **Amended 2026-09**: that
bar is now a conventional toolbar (Find + permission chip); its "Preview – content below is not Erfana"
label and 2px accent seam were withdrawn by owner decision, with nothing in their place, so the
mitigation is structural only and no longer names itself. Widened residual §2.8 risk 8, §1.8(c).

**R12 — Exfiltration channels outside every chokepoint** (med/high). **New, and honestly unmitigated.**
WebRTC over TURN/TCP-443 and `<link rel=preconnect>` are general-purpose channels that neither the CSP
nor `onBeforeRequest` observes; `X-DNS-Prefetch-Control: off` closes only the prefetch half. §2.8 risk 3.
Accepted for v1 — the alternative is blocking `RTCPeerConnection`, which Electron exposes no supported
switch for at the session level, and which would need a Chromium-flag change with app-wide effect.

---

## 10. What this design deliberately does not do

**Non-goals from the issue**: no build step; no devtools for the page; no Erfana↔page scripted API;
`.md` stays static and sanitized; no structural browser-creep prevention.

| Narrowing | Reason |
|---|---|
| ~~**One live preview**~~ **SUPERSEDED by sd-074b D5** | Was: "No AC asks for concurrency; LRU had no exit state." LRU now HAS an exit state — a suspended preview keeps its still frame and re-opens itself when its tab is activated — so several previews run at once, capped by `PREVIEW.MAX_LIVE_VIEWS`. Same-panelId re-open still replaces |
| **`stream:false`, no `Range`/206** | Electron will not synthesise range responses; large-`<video>` seeking does not work |
| **Dot-prefixed paths are unservable** | A blanket rule beats a blocklist. Cost: `.well-known` is unreachable |
| **`~[0-9]` segments rejected on `win32`** | 8.3 alias defence layer 1. Cost: a long name legitimately containing `~1` is unservable **on Windows only** |
| **AC13 covers statically parseable links only** | JS-injected `<link>`, dynamic `import()`, fetched CSS and nested `@import` are undiscoverable without executing the page |
| **Only four accelerators are forwarded** | Cmd+R, Cmd+P, devtools accelerators and all text editing stay with the page |
| **AC17 case 4 has no test** | `disableDnd` makes it unreachable |
| **Exact hosts only; no IP literals, `localhost`, `.local`, `.internal`; `http:` never allowlistable** | A wildcard grants more than intended; loopback is an SSRF shape; plain HTTP is mixed content anyway |
| **DNS rebinding is not defended** | No IP pinning. Residual is blind fire-and-forget to loopback/LAN; the opaque origin prevents reading responses |
| **WebRTC and `preconnect` exfiltration are not blocked** | No supported session-level API; §2.8 risk 3, R12 |
| **AC10 timeout UX is quiet in the badge** | Operator decision; an interrupting message per offline CDN asset is worse than a badge count |
| **Blocked-host toasts stop after 3 distinct hosts per panel** | Otherwise a page mints unbounded hosts and turns the toast stack into a DoS surface |
| **A hostile page can defeat its own CSS swap** | Any non-`true` outcome falls back to a full reload; the cost lands on the page |
| **Markdown links to `.html` open source** — kept, deliberately | Matches today's `.svg` behaviour; not AC1's "explicit action". sd-074b makes the same link RUN when clicked inside an HTML preview, and the divergence is intended: a markdown link is a "show me the source" gesture, an HTML hyperlink is a hyperlink. Unifying them needs the "Open as text" action in technical-debt #455 first, so it is a separate issue |
| **`getFilePanelId(path)` stays kind-free** | Its only two call sites (`TranscriptionDialog.tsx:216`, `DocumentImportDialog.tsx:146`) pass markdown paths, so `.html` lossiness is **unreachable** |
| **`PreviewExportController` duplicates PdfService's save-dialog config** | Its save path is private and `IPdfService` exposes only `exportToPdf`; ~10 duplicated lines beat widening a working service. `deriveSafeFilename` is shared, so #161 is not duplicated |
| **No cross-window allowlist locking** | Two windows on one project is accepted as broken; the kept guarantee is that the file always parses |
| **`isTrustedSender` is copied, not extracted** | Safety wins over convenience; debt 31 |
| **Monaco worker-backed services are disabled, not bundled** | AC11 asks for highlighting (Monarch, main-thread); bundling four workers raises a `file://` module-worker question no AC requires |
| **Hardlinks and the realpath→open race are documented, not fixed** | No proportionate fix without `openat`; debt 32–33 |
| **No UI trust chrome in v1** | §2.8 risk 8; follow-up |
| **`alert`/`confirm`/`prompt` no-op; `<a download>` is refused and badged** | The `sandbox` token withholds `allow-modals` and `allow-downloads`; granting either re-opens a modal-blocking or file-write surface. sd-074b keeps the refusal but stops it being silent: a download click now records a `blocked-link` failure |
| **A single CSP application site (no `onHeadersReceived` overwrite)** | Round-4 option b: one owner cannot drift or be left unwired; §2.6's single-ownership claim becomes literal. A CDN subresource's own CSP header is ignored by the browser anyway, so the second site protected nothing |
| **AC24 is a local gate; AC19b is manual** | Shared CI runners flake on perf floors; visual regression is local-only |
| **Gate 3's behavioural half is not in CI** | `e2e.yml` is disabled; re-enabling it is out of scope for #74 |

---

## 11. Verification criteria (Phase 8)

- [ ] `npm run lint` clean, including the two new selectors in the **single** `no-restricted-syntax`
      array and the one justified `eslint-disable` in `OverlayGuardService.ts`.
- [ ] `npm run typecheck` clean, including the breaking `SearchProvider` change across all **12** §6
      files and every schema under **zod 4** (`z.enum(ErrorCode)`, no `z.nativeEnum` anywhere).
- [ ] `npm run test:ci` green with **no un-whitelisted `deprecated|DEP[0-9]+` line**.
- [ ] `npx vitest --run --config vitest.main.ts --project main --coverage` green including the seven
      floors **and the widened `coverage.include`**.
- [ ] `scripts/preview-eslint-guard.test.ts` is **observed to run**, not merely to pass.
- [ ] `npm run check:headers` + `reuse lint` green.
- [ ] `npx electron-vite build`; `registerPreviewScheme()` present in `out/main/index.js` **before**
      the `whenReady` call.
- [ ] `npm run test:main` green on windows-latest.
- [ ] **On a real Windows host**: confirm the 8.3 alias Windows assigns to `.env` and add it as a test
      case; verify `<root>/<alias>` is refused (§2.4 8h, §2.8 risk 10).
- [ ] `git diff --stat` shows **no change** to `clipboard-handlers.ts`, `claude-status-handlers.ts`,
      `FileWatcherService.ts` or `PdfService.ts`.
- [ ] No file added or modified by this change exceeds 500 lines.
- [ ] Manual: `.html` source view highlights HTML with **no Monaco worker error**.
- [ ] Manual: all five corpus pages; the error badge includes `unsupported-asset-type`; the runaway
      page's tab closes within `PREVIEW_CLOSE_TIMEOUT_MS`.
- [ ] Manual: corpus page 2 proves AC6 under the opaque origin.
- [ ] Manual: `getOSProcessId() !== process.pid` (not provable in the required job).
- [ ] Manual: `fetch('erfana-preview://<token>/.git/config')` is **refused**; `sendBeacon` to an
      unapproved host is **blocked and badged**.
- [ ] Manual: a repo with `.erfana` symlinked outside — Approve **refuses**, target untouched.
- [ ] Manual: a project whose allowlist is invalid **still opens**; an Approve on a pretty-printed
      settings file **keeps its formatting**.
- [ ] Manual: Cmd+F reaches the search bar after clicking into the page.
- [ ] Manual: opening a `TranscriptionDialog` hides the view **with no flash** (one hide, one show).
- [ ] Manual: at 150 % zoom the native view still covers the placeholder exactly.
- [ ] Manual: reload the main renderer with a preview open — the panel re-opens rather than being
      permanently refused (NEW-9).
- [ ] **Merge gate 1**: §2.8 transcribed into `docs/security.md` **with the corrected WebRTC and
      DNS-prefetch wording**, reviewed by the security-auditor agent.
- [ ] **Merge gate 2**: versioned allowlist schema in `src/shared/ipc`, with a test proving an invalid
      allowlist does not block project load.
- [ ] **Merge gate 3**: the sealed-box **configuration** test green in the required job, asserting
      `omit(getLastWebPreferences(),'session')`; the **behavioural** half run locally and recorded in
      the PR description. Gate 3 is not claimed as fully CI-enforced — see §8.
- [ ] `docs/technical-debt.md` carries items 31, 32 and 33 from §7.1.
