# Dialog framework

All dialogs MUST compose on `BaseDialog`. Never build portals, overlays, or focus management from scratch.

## BaseDialog props

```tsx
<BaseDialog
  isOpen={isOpen}
  onClose={onClose}
  zIndex={zIndex}                    // from DialogContext or hardcoded
  closeOnBackdrop={true}             // false for modal operations
  closeOnEscape={true}               // false if custom Escape handling needed
  className="my-dialog"              // adds to dialog-container
  ariaLabelledBy={titleId}           // optional in the type, required by convention – points to title element
  ariaDescribedBy={descriptionId}    // recommended – points to body element
  initialFocusRef={captureButtonRef} // optional – focus this instead of the first focusable
  initialFocusKey={canCapture}       // optional – re-arm focus resolution (primitive!)
  focusRescueRef={refreshButtonRef}  // optional – where the focusout rescue should land
  trapFocus                          // optional – cycle Tab/Shift+Tab inside the dialog
>
```

BaseDialog portals into `#portal-root`.

## Focus management

The focusable selector **excludes `:disabled` controls**, so a Start/Capture button that is disabled while work is pending is never picked as the auto-focus target and never acts as a Tab boundary.

| Prop | Behaviour |
|------|-----------|
| `initialFocusRef` | Focus this element instead of the first focusable in DOM order, ~10 ms after open. Silently ignored when the ref is empty, detached, disabled, or **outside the dialog subtree** – the default first-focusable behaviour applies unchanged. Pass a stable ref (it is in the focus effect's dependency array – same hazard as a non-primitive `initialFocusKey`). |
| `initialFocusKey` | Re-runs initial-focus resolution whenever the value changes. For a target that is disabled at open time and enables asynchronously (CameraDialog's Capture button, gated on the camera stream starting). |
| `focusRescueRef` | Where the `trapFocus` focusout rescue should send focus, instead of the first focusable in DOM order. Ignored (falling back to first-focusable) when empty, detached, disabled, or outside the dialog, so a control that only exists in the error state can be passed unconditionally. CameraDialog points it at Refresh – first-in-DOM-order there is the device `<select>`, where the next arrow key silently switches camera. |
| `trapFocus` | Cycles Tab / Shift+Tab within the dialog and pulls focus back in when it has already escaped. Default `false`. |

**`initialFocusKey` is compared with `Object.is`, so pass a primitive.** A value rebuilt on every render – an object or array literal, an inline arrow – re-arms the pass every render, reschedules the timer before it ever fires, and focus never lands at all. Pass the boolean that gates the control (e.g. `canCapture`).

**`trapFocus` is opt-in (default `false`). Pass the prop; never hand-roll a local `handleFocusTrap`.** The exact guards on the re-armed focus pass and the `focusout` rescue – the 1.5 s promotion window, why both share one focus authority, why an unmounted control is deliberately not rescued – are documented at length in `BaseDialog.tsx`, not restated here.

## Stacked dialogs

BaseDialog keeps a **module-level stack of every open dialog** (trapping or not, because the dialog that lands on top is often a plain `ConfirmDialog`). The Tab trap and the focusout rescue both bail unless their dialog is the frontmost one.

**Ordering contract: the frontmost dialog is the one with the highest `zIndex`, and registration order only breaks a tie.** Both halves are locked by tests in `BaseDialog.test.tsx` ("stacked dialogs"). The failure this prevents, and why registration order alone is not enough, is in the module comment of `BaseDialog.tsx`.

## Standard CSS classes (from Dialog.css)

### Layout
- `.dialog-header` – title wrapper (bottom margin only, no background)
- `.dialog-title` – `h3` element, `var(--text-xl)`, `letter-spacing: -0.2px`
- `.dialog-body` – body wrapper (bottom margin)
- `.dialog-actions` – footer buttons (flex, gap, right-aligned)

### Buttons (mandatory – never create custom button styles)
- `.dialog-btn` – base button class (always required)
- `.dialog-btn-primary` – confirm/submit (violet)
- `.dialog-btn-secondary` – cancel/dismiss (transparent with border)
- `.dialog-btn-danger` – destructive actions (red)

`.dialog-btn` / `-primary` / `-secondary` have an out-of-directory consumer: `RootErrorFallback` (the crash-recovery screen) references them from markup while `RootErrorBoundary.css` deliberately never declares them, relying on `Dialog.css` already being in the entry bundle at crash time – a future "scope these to dialogs only" cleanup would silently break the crash screen.

### Modifiers
- `.dialog-container.my-dialog` – override container (e.g., `max-width`)

## ARIA requirements

`ariaLabelledBy` is `ariaLabelledBy?: string` in the type – optional to the compiler, required by convention. Wiring it is two steps:

1. **Derive an id.** A dialog mounted through `dialogService` / `DialogManager` is handed a stack `id` in its config, so it builds the ids from that: `` const titleId = `dialog-title-${id}` `` and `` const messageId = `dialog-message-${id}` `` (see `AlertDialog.tsx`, `ConflictDialog.tsx`, `DropModeDialog.tsx`). A dialog with no config id that can be mounted more than once at a time uses `useId()` instead – `CameraDialog.tsx` does exactly that for its status live region: `` const statusRegionId = `camera-dialog-status-${useId()}` ``.
2. **Put that id on the title element** (`<h3 id={titleId} className="dialog-title">`) and pass the same value as `ariaLabelledBy`. `ariaDescribedBy` gets the body element's id the same way.

## Existing dialogs (only where the filename misleads)

Most dialog files do what their name says. These four do not:

| File | What is not obvious |
|------|---------------------|
| `FileSystemDialog.tsx` | Shared base for file/folder create **and** rename – validation, character count, keyboard shortcuts. `NewFileDialog` / `NewFolderDialog` / `RenameDialog` are thin wrappers on it (`operation="create"` / `"rename"`) |
| `CameraDialog.tsx` | Single-shot: the frame is written to a temp file and returned to the caller immediately, with no review/retake state. Mirroring is **preview-only and off by default**: `.camera-preview--mirrored` (`transform: scaleX(-1)`) is applied to the `<video>` only while the per-camera checkbox is on (`useCameraMirrorPreference` → `useCameraMirrorStore`, persisted by `deviceId`), and `captureVideoFrame()` in `useCameraCapture.ts` draws the frame unflipped in every state, so the saved JPEG is never mirrored (#42). Uses `initialFocusRef` + `initialFocusKey={canCapture}` + `trapFocus` – the reference case for all three |
| `ScreenSelectDialog.tsx` | Not macOS-only and not feature-gated: the TerminalPanel toolbar opens it wherever screenshot capture is supported (macOS + Windows) whenever more than one display is connected |
| `ScreenPermissionDialog.tsx` | macOS Screen Recording denial – shown only **after** a capture is actually denied, never as a pre-check gate |
