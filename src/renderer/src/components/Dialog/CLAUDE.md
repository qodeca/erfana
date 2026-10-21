# Dialog framework

All dialogs MUST compose on `BaseDialog`. Never build portals, overlays, or focus management from scratch.

## Focus management

Auto-focus, the Tab trap and the focus rescue all use `getTabbable()` – what Tab can actually land on. It **excludes `:disabled` controls** (a Start/Capture button disabled while work is pending is never the auto-focus target or a Tab boundary), **`tabindex="-1"` on every element type** (the screen and window pickers' roving options – only the selected one is a Tab stop, so the trap wraps to it), hidden inputs, and anything `checkVisibility()` says is not rendered.

| Prop | Behaviour |
|------|-----------|
| `initialFocusRef` | Focus this element instead of the first focusable in DOM order, ~10 ms after open. Silently ignored when the ref is empty, detached, disabled, or **outside the dialog subtree** – the default first-focusable behaviour applies unchanged. Pass a stable ref (it is in the focus effect's dependency array – same hazard as a non-primitive `initialFocusKey`). |
| `initialFocusKey` | Re-runs initial-focus resolution whenever the value changes. For a target that is disabled at open time and enables asynchronously (CameraDialog's Capture button, gated on the camera stream starting). |
| `focusRescueRef` | Where the `trapFocus` focusout rescue should send focus, instead of the first focusable in DOM order. Ignored (falling back to first-focusable) when empty, detached, disabled, or outside the dialog, so a control that only exists in the error state can be passed unconditionally. CameraDialog points it at Refresh – first-in-DOM-order there is the device `<select>`, where the next arrow key silently switches camera. |
| `trapFocus` | Cycles Tab / Shift+Tab within the dialog and pulls focus back in when it has already escaped. Default `true`. `false` also drops `aria-modal` – see below. |

**`initialFocusKey` is compared with `Object.is`, so pass a primitive.** A value rebuilt on every render – an object or array literal, an inline arrow – re-arms the pass every render, reschedules the timer before it ever fires, and focus never lands at all. Pass the boolean that gates the control (e.g. `canCapture`).

**`aria-modal="true"` and the focus trap go together (#91).** `aria-modal` tells a screen reader that everything behind the dialog is inert, which is only true while Tab cannot reach it. So `trapFocus` defaults to `true`, and `trapFocus={false}` drops `aria-modal` as well – a dialog never claims a modality it does not enforce. No shipping dialog opts out; one that needs to (a picker that must let focus reach another surface) passes `false` and says why at the call site. Never hand-roll a local `handleFocusTrap`.

**Focus returns to the opener on every close** – `isOpen` going false *and* unmount, which is how every DialogManager dialog closes. The opener is captured during render, before a child's `autoFocus` or focus effect moves focus inside, and focus is not returned if the close action already put it somewhere else (focus on `<body>` or inside the dialog counts as "nowhere else"). When the opener is gone by close time, focus goes to its region instead – the nearest `role="tree"` or `data-focus-return` ancestor captured at open (the region itself if it has a `tabindex`, else its first tabbable control). Two helpers outside this folder complete the chain: `ContextMenu` re-focuses whatever had focus at open before running an item's action (its items are not focusable, so the click leaves focus on `<body>`), and the project tree's `useTreeFocusRecovery` keeps focus in the tree when a rename or delete removes the focused row after the dialog has closed.

**Trap details.** The exact guards on the re-armed focus pass and the `focusout` rescue – the 1.5 s promotion window, why both share one focus authority, why an unmounted control is deliberately not rescued – are documented at length in `BaseDialog.tsx`, not restated here.

## Stacked dialogs

Every open BaseDialog (trapping or not – a `trapFocus={false}` dialog on top must still suppress the trap beneath it) sits on the **shared open-overlay stack** in `../../utils/overlayStack.ts`, registered through `../../hooks/useOverlayStackEntry.ts`. `SettingsOverlay` and the shared `ContextMenu` register on the same stack. The Tab trap and the focusout rescue both bail unless their dialog is the frontmost **modal** entry – the context menu registers `modal: false`, so a menu opened inside a trapping dialog takes Escape first but leaves the dialog's Tab trap working. Registration runs in a layout effect, so a new overlay is on the stack before it is painted. A held (auto-repeating) Escape is ignored, so it cannot close the stack one overlay at a time.

**Escape reaches only the topmost entry** (#229): one shared capture-phase listener calls that entry's `onClose` and nothing beneath it. A topmost dialog with `closeOnEscape={false}` makes Escape do nothing – it does not fall through. **Never add a private `document` Escape listener to a dialog or overlay**; for state-dependent Escape (cancel a running job, otherwise close) make `onClose` itself state-aware, as `TranscriptionDialog` and `DocumentImportDialog` do. A new modal surface that does not compose on BaseDialog registers with `useOverlayStackEntry` at the z-index it paints at.

**Ordering contract: the frontmost dialog is the one with the highest `zIndex`, and registration order only breaks a tie.** Both halves are locked by tests in `BaseDialog.test.tsx` ("stacked dialogs"). The failure this prevents, and why registration order alone is not enough, is in the module comment of `BaseDialog.tsx`.

## Dialog buttons (mandatory – never create custom button styles)

Use the `.dialog-btn` classes from `Dialog.css` (`.dialog-btn` is always required, plus one of `-primary` / `-secondary` / `-danger`).

`.dialog-btn` / `-primary` / `-secondary` have an out-of-directory consumer: `RootErrorFallback` (the crash-recovery screen) references them from markup while `RootErrorBoundary.css` deliberately never declares them, relying on `Dialog.css` already being in the entry bundle at crash time. A future "scope these to dialogs only" cleanup would leave the crash screen with unstyled buttons – caught by the "shared Dialog.css contract" block in `../RootErrorBoundary/RootErrorBoundary.css.test.ts`, which asserts both halves: that `Dialog.css` still declares `.dialog-btn` / `-primary` / `-secondary`, and that `RootErrorBoundary.css` never re-declares them.

## ARIA requirements

`ariaLabelledBy` is `ariaLabelledBy?: string` in the type – optional to the compiler, required by convention. Wiring it is two steps:

1. **Derive an id.** A dialog mounted through `dialogService` / `DialogManager` is handed a stack `id` in its config, so it builds the ids from that: `` const titleId = `dialog-title-${id}` `` and `` const messageId = `dialog-message-${id}` `` (see `AlertDialog.tsx`, `ConflictDialog.tsx`, `DropModeDialog.tsx`). A dialog with no config id that can be mounted more than once at a time uses `useId()` instead – `CameraDialog.tsx` does exactly that for its status live region: `` const statusRegionId = `camera-dialog-status-${useId()}` ``.
2. **Put that id on the title element** (`<h3 id={titleId} className="dialog-title">`) and pass the same value as `ariaLabelledBy`. `ariaDescribedBy` gets the body element's id the same way.

## Existing dialogs (only where the filename misleads)

Most dialog files do what their name says. These do not:

| File | What is not obvious |
|------|---------------------|
| `FileSystemDialog.tsx` | Shared base for file/folder create **and** rename – validation, character count, keyboard shortcuts. `NewFileDialog` / `NewFolderDialog` / `RenameDialog` are thin wrappers on it (`operation="create"` / `"rename"`) |
| `CameraDialog.tsx` | Single-shot: the frame is written to a temp file and returned to the caller immediately, with no review/retake state. Mirroring is **preview-only and off by default**: `.camera-preview--mirrored` (`transform: scaleX(-1)`) is applied to the `<video>` only while the per-camera checkbox is on (`useCameraMirrorPreference` → `useCameraMirrorStore`, persisted by `deviceId`), and `captureVideoFrame()` in `useCameraCapture.ts` draws the frame unflipped in every state, so the saved JPEG is never mirrored (#42). Uses `initialFocusRef` + `initialFocusKey={canCapture}` + `trapFocus` – the reference case for all three |
| `UnsavedChangesDialog.tsx` | Not the tab-close prompt: it asks about *another* tab's unsaved edits before a preview tab moves to that page (#124), in a `save` or a `conflict` (file changed on disk – no Save offered) variant. `initialFocusRef` is set on the choice that loses nothing, because first-in-DOM-order is the destructive button, and there is deliberately no Enter handler. The caller holds that tab's autosave while it is open (`editorSaveRegistry.holdAutosave`) |
