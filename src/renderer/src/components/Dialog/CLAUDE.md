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
  ariaLabelledBy={titleId}           // required – points to title element
  ariaDescribedBy={descriptionId}    // recommended – points to body element
  initialFocusRef={captureButtonRef} // optional – focus this instead of the first focusable
  initialFocusKey={canCapture}       // optional – re-arm focus resolution (primitive!)
  focusRescueRef={refreshButtonRef}  // optional – where the focusout rescue should land
  trapFocus                          // optional – cycle Tab/Shift+Tab inside the dialog
>
```

## What BaseDialog provides

- Portal rendering to `#portal-root`
- Overlay backdrop with configurable click-to-close
- Escape key handling (configurable)
- Auto-focus on the first focusable element, or on a preferred target (`initialFocusRef`)
- **Tab-cycling focus trap** – opt-in via `trapFocus`, including recovery of focus that has already escaped the dialog
- Focus restore on close
- Fade-in + slide-up animation
- `role="dialog"` and `aria-modal="true"` on container

## Focus management

The focusable selector **excludes `:disabled` controls**, so a Start/Capture button that is disabled while work is pending is never picked as the auto-focus target and never acts as a Tab boundary.

| Prop | Behaviour |
|------|-----------|
| `initialFocusRef` | Focus this element instead of the first focusable in DOM order, ~10 ms after open. Silently ignored when the ref is empty, detached, disabled, or **outside the dialog subtree** – the default first-focusable behaviour applies unchanged. Pass a stable ref (it is in the focus effect's dependency array – same hazard as a non-primitive `initialFocusKey`). |
| `initialFocusKey` | Re-runs initial-focus resolution whenever the value changes. For a target that is disabled at open time and enables asynchronously (CameraDialog's Capture button, gated on the camera stream starting). |
| `focusRescueRef` | Where the `trapFocus` focusout rescue should send focus, instead of the first focusable in DOM order. Ignored (falling back to first-focusable) when empty, detached, disabled, or outside the dialog, so a control that only exists in the error state can be passed unconditionally. CameraDialog points it at Refresh – first-in-DOM-order there is the device `<select>`, where the next arrow key silently switches camera. |
| `trapFocus` | Cycles Tab / Shift+Tab within the dialog and pulls focus back in when it has already escaped. Default `false`. |

**`initialFocusKey` is compared with `Object.is`, so pass a primitive.** A value rebuilt on every render – an object or array literal, an inline arrow – re-arms the pass every render, reschedules the timer before it ever fires, and focus never lands at all. Pass the boolean that gates the control (e.g. `canCapture`).

The re-armed pass never steals focus. It runs only when all three hold: the preferred target is now focusable, focus is still where BaseDialog itself put it (or on `<body>`, where Chromium leaves it after disabling a focused control), and less than **1.5 s** has elapsed since the dialog opened. After that window the user has read the dialog and may be about to press Enter, so retargeting the keystroke would be worse than leaving focus alone.

The re-armed pass and the rescue are the **same focus authority**: the rescue records where it parked focus, so a transient disable inside the promotion window does not make the next promotion mistake BaseDialog's own rescue for a deliberate user move.

`trapFocus` also rescues focus **without a keystroke**: Chromium blurs a focused control the instant it becomes `disabled` and leaves focus on `<body>`, outside an `aria-modal` dialog. A `focusout` listener on the container detects that the control which lost focus is now `:disabled` and returns focus to `focusRescueRef` (or the first focusable control). A control that is still enabled and merely lost focus deliberately is left alone – no per-control `onBlur` handlers needed in individual dialogs.

**An UNMOUNTED control is deliberately NOT rescued.** Measured in this app's runtime (Electron 39.8.9 / Chromium 142): removing a focused element *does* fire a bubbling `focusout` with `relatedTarget: null`, but Blink clears focus **before** it detaches the node, so at dispatch the target still reports `isConnected: true` and `matches(':disabled') === false`. Rescuing there would fire on `DocumentImportDialog` / `TranscriptionDialog`'s ordinary footer swap – pressing Enter on "Import" would park focus on the `.dialog-btn-danger` Cancel that replaces it, where a second reflexive Enter aborts the operation just started. Unmounts fall through to the Tab trap, which recovers on the next keystroke.

## Stacked dialogs

BaseDialog keeps a **module-level stack of every open dialog** (trapping or not, because the dialog that lands on top is often a plain `ConfirmDialog`). The Tab trap and the focusout rescue both bail unless their dialog is the frontmost one.

Without it, a background trapping dialog – `DocumentImportDialog` and `TranscriptionDialog` are mounted at app root and stack at `zIndex 10000`, while `DialogManager` stacks at 10001+ – reads "focus is in the dialog on top of me" as "focus escaped to the page", `preventDefault()`s Tab and drags focus down. The top dialog's own trap then pulls it back to *its* first control, so Tab can never advance: pressing Cmd+Q during a transcription made both Quit and Cancel keyboard-unreachable.

**Ordering contract: the frontmost dialog is the one with the highest `zIndex`, and registration order only breaks a tie.** Paint order is what the user sees, so it is compared directly rather than inferred from open order. Registration order alone agreed with paint order everywhere reachable today, but it mis-answers one shape: a permanently-mounted app-root dialog at `zIndex 10000` whose `isOpen` cycles false → true while a `DialogManager` dialog at 10001+ is already up registers *last*, would claim topmost, and would reinstate the very keyboard trap the stack exists to prevent. Both halves of the contract are locked by tests in `BaseDialog.test.tsx` ("stacked dialogs").

Stack entries pair the per-instance container ref with the `zIndex` that instance renders at, so registration is idempotent under StrictMode's setup/cleanup/setup double-invocation, and "topmost" skips entries whose element is no longer connected – a leaked registration cannot wedge every later dialog. A dialog re-rendered at a new `zIndex` is re-ranked.

## What BaseDialog does NOT provide

- **Tab cycling by default** – `trapFocus` is opt-in (default `false`) so shipping dialogs keep their existing keyboard behaviour. Pass the prop; never hand-roll a local `handleFocusTrap`. `DocumentImportDialog` and `TranscriptionDialog` both deleted theirs in favour of it.

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

- `ariaLabelledBy` – use `useId()` for unique IDs: `const titleId = \`my-title\${useId()}\``
- `ariaDescribedBy` – point to body content element
- Dynamic content: add `role="alert" aria-live="assertive"` for errors, `role="status" aria-live="polite"` for success/progress
- Progress bars: `role="progressbar"` with `aria-valuenow/min/max`

## Dialog patterns by complexity

| Pattern | Example | Use when |
|---------|---------|----------|
| Simple confirm | `AlertDialog`, `ConfirmDialog` | Static message + buttons |
| Interactive | `FilePickerDialog`, `RenameDialog` | User input, keyboard navigation |
| Multi-state | `TranscriptionDialog` | Progress, error, success states; custom Escape logic |

## Existing dialogs (reference)

| File | Purpose |
|------|---------|
| `AlertDialog.tsx` | Simple OK dialog |
| `ConfirmDialog.tsx` | Yes/No confirmation |
| `FilePickerDialog.tsx` | List selection with keyboard nav |
| `PromptDialog.tsx` | Text input with validation |
| `NewFileDialog.tsx` / `NewFolderDialog.tsx` | Thin wrappers on `FileSystemDialog` (`operation="create"`), preset with icon and filename validation |
| `RenameDialog.tsx` | File/folder rename with validation – wraps `FileSystemDialog` (`operation="rename"`, auto-selects the whole name) |
| `FileSystemDialog.tsx` | Shared base for file/folder create **and** rename dialogs – validation, character count, keyboard shortcuts |
| `DropModeDialog.tsx` | Mode selection (move/copy/import) |
| `ConflictDialog.tsx` | File conflict resolution |
| `CameraDialog.tsx` | Webcam photo capture – live preview, device selector, shutter animation. Single-shot: the frame is written to a temp file and returned to the caller immediately, with no review/retake state. Mirroring is **preview-only and off by default**: `.camera-preview--mirrored` (`transform: scaleX(-1)`) is applied to the `<video>` only while the per-camera checkbox is on (`useCameraMirrorPreference` → `useCameraMirrorStore`, persisted by `deviceId`), and `captureVideoFrame()` in `useCameraCapture.ts` draws the frame unflipped in every state, so the saved JPEG is never mirrored (#42). Uses `initialFocusRef` + `initialFocusKey={canCapture}` + `trapFocus` – the reference case for all three |
| `ScreenSelectDialog.tsx` | Multi-monitor display picker – takes `displays: DisplayInfo[]`, returns the chosen `displayId`. Not macOS-only and not feature-gated: the TerminalPanel toolbar opens it wherever screenshot capture is supported (macOS + Windows) whenever more than one display is connected |
| `WindowPickerDialog.tsx` | Cross-platform window picker – thumbnail grid with roving tabindex, used where the OS has no native picker |
| `ScreenPermissionDialog.tsx` | macOS Screen Recording denial – offers open-settings and relaunch; shown only after a capture is actually denied, never as a pre-check gate |
| `DialogContext.tsx` | Dialog stack manager (z-index) |
| `DialogManager.tsx` | Imperative stack renderer (mounts dialogs from `dialogService`) |
| `dialogService.ts` | Imperative dialog API |
| `../DocumentImport/DocumentImportDialog.tsx` | Multi-state: options → progress → success/error (LiteParse) |
| `../Transcription/TranscriptionDialog.tsx` | Multi-state: options → progress → success/error (transcription) |
