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
>
```

## What BaseDialog provides

- Portal rendering to `#portal-root`
- Overlay backdrop with configurable click-to-close
- Escape key handling (configurable)
- Auto-focus on first focusable element
- Focus restore on close
- Fade-in + slide-up animation
- `role="dialog"` and `aria-modal="true"` on container

## What BaseDialog does NOT provide

- **Tab-cycling focus trap** – only auto-focuses first element. If the dialog needs Tab to cycle within it, implement `handleFocusTrap` manually (see TranscriptionDialog for example).

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
| `CameraDialog.tsx` | Webcam photo capture – live preview, device selector, shutter animation. Single-shot: the frame is written to a temp file and returned to the caller immediately, with no review/retake state. Mirror gotcha: the `<video>` always carries `.camera-preview--mirrored` (`transform: scaleX(-1)`) while `captureVideoFrame()` in `useCameraCapture.ts` draws the frame unflipped, so the saved JPEG is the horizontal mirror of what the preview showed (#42) |
| `ScreenSelectDialog.tsx` | Multi-monitor display picker – takes `displays: DisplayInfo[]`, returns the chosen `displayId`. Not macOS-only and not feature-gated: the TerminalPanel toolbar opens it wherever screenshot capture is supported (macOS + Windows) whenever more than one display is connected |
| `WindowPickerDialog.tsx` | Cross-platform window picker – thumbnail grid with roving tabindex, used where the OS has no native picker |
| `ScreenPermissionDialog.tsx` | macOS Screen Recording denial – offers open-settings and relaunch; shown only after a capture is actually denied, never as a pre-check gate |
| `DialogContext.tsx` | Dialog stack manager (z-index) |
| `DialogManager.tsx` | Imperative stack renderer (mounts dialogs from `dialogService`) |
| `dialogService.ts` | Imperative dialog API |
| `../DocumentImport/DocumentImportDialog.tsx` | Multi-state: options → progress → success/error (LiteParse) |
| `../Transcription/TranscriptionDialog.tsx` | Multi-state: options → progress → success/error (transcription) |
