# Design: Central text-clipboard service (issue #203) — v2 (post lens-review)

Phase 4 architecture for GitHub issue #203 (Erfana — Electron 39 + React 18 + TypeScript, electron-vite; sandbox ON, contextIsolation ON, nodeIntegration OFF).

> **v2 changes** fold in the lens-review findings. Headline: the bridge is now **asynchronous** (`ipcRenderer.invoke`/`ipcMain.handle`), reversing the issue's literal "synchronous" wording on the evidence that Monaco does not need a sync clipboard and `sendSync` freezes the renderer (lens finding [3], 4 lenses). All must-fix + should-fix findings are incorporated; the changelog is at the end.

## Goal

A single central renderer text-clipboard service that all in-scope text surfaces route through, backed by Electron's native `clipboard` module in the **main process**, exposed via a new **asynchronous, Zod-validated** preload bridge. Fixes the Monaco copy/paste `NotAllowedError` and unifies error handling.

## Hard constraints (verified in discovery + lens-review)

- Sandbox is ON → Electron `clipboard` module is NOT usable in preload. Bridge MUST be preload → IPC → main process `clipboard` (electron/electron#36945).
- **Asynchronous IPC** via `ipcRenderer.invoke` + `ipcMain.handle` (NOT `sendSync`). Electron docs call `sendSync` a "last resort" that blocks the whole renderer; Monaco's paste override is a plain JS callback that can `await readText()` then `executeEdits` (verified: existing Cmd+B/F/G overrides are ordinary callbacks). Async restores the standard `invoke`+Zod validation pipeline.
- **Sender validation (must-fix [1]):** every clipboard handler validates `event.senderFrame` against the app origin before touching the OS clipboard; on mismatch it returns the safe value (`''`/`false`) + `logger.warn`. This is a new chokepoint and sets the convention.
- **Payload bound (should-fix [4]):** `writeText` payload is validated by Zod `z.string().max(CLIPBOARD_MAX_TEXT_LENGTH)`; oversize → reject (`false`) + `logger.warn`.
- Terminal decision table `src/renderer/src/utils/terminalClipboard.logic.ts` (`getClipboardAction`/`shouldPassThrough`) preserved verbatim — encodes #28 (SIGINT-when-no-selection, no-double-paste, selection-kept-after-copy) and #122 (cut≠copy). Only the underlying read/write swap to the central service.
- Genuine failures → `showErrorToast` + `logger.error`. Remove ALL silent-catch on in-scope surfaces. **Toast policy (should-fix [6]):** always `logger.error` on failure; gate the user-facing toast behind one short retry (re-attempt after ~50 ms) and debounce/coalesce so a burst yields one toast. (User-confirmed "toast every failure" intent preserved — just retry-and-dedupe so a transient OS clipboard lock doesn't spam.)
- Out of scope, DO NOT touch: project-tree file clipboard (`useClipboardStore.ts`, `api.file.copyItem/moveItem`).

## 1. Component layering

```
MAIN: electron `clipboard`
  ▲ readText() / writeText(s)
  src/main/ipc/clipboard-handlers.ts
    ipcMain.handle('clipboard:readText',  e => { assertSender(e); return clipboard.readText() })   [ASYNC]
    ipcMain.handle('clipboard:writeText', (e, t) => { assertSender(e); clipboard.writeText(parse(t)); return true }) [ASYNC]
    registerClipboardHandlers()  (called from index.ts)
  ▲ ipcRenderer.invoke(channel, payload) → Promise
PRELOAD (sandbox-safe, no electron `clipboard`):
  src/preload/index.ts  api.clipboard = { readText(): Promise<string>; writeText(t): Promise<boolean> }
  src/preload/index.d.ts  Window.api.clipboard typing (from shared ClipboardBridge type)
  ▲ window.api.clipboard.*
RENDERER:
  src/renderer/src/services/textClipboard.ts
    TextClipboardService (singleton): async writeText(t): Promise<boolean>; readText(): Promise<string>
    Single TRANSPORT-ERROR chokepoint: retry-once + debounced toast + logger.error
    Test seam = exported `textClipboard` singleton + module-level `vi.mock` (no hook)
  ▲ imported by consumers
CONSUMERS: useTerminalClipboard, useTextareaClipboard (+3 migrated dupes),
  useEditorContextMenu, EditorContextMenu, MonacoMarkdownEditor (via monacoClipboardCommands.ts),
  MarkdownPreview, PreviewContextMenu, FilePickerDialog
```

Native Edit menu (`src/main/menu.ts` role-based cut/copy/paste/selectAll) stays as-is — see §9.

## 2. Files

### New

| Path | Responsibility | Est. lines |
|------|----------------|------------|
| `src/main/ipc/clipboard-handlers.ts` | `registerClipboardHandlers()` — two async `ipcMain.handle` handlers wrapping electron `clipboard`, sender validation, Zod parse, try/catch → `logger.error` | ~70 |
| `src/shared/ipc/clipboard-channels.ts` | `CLIPBOARD_CHANNELS` const (`readText`, `writeText`) | ~15 |
| `src/shared/ipc/clipboard-schema.ts` | Zod `ClipboardWriteTextSchema` (`z.string().max(N)`), `CLIPBOARD_MAX_TEXT_LENGTH`, and `ClipboardBridge` TS contract type imported by preload + handler (nice-to-fix [10]) | ~30 |
| `src/renderer/src/services/textClipboard.ts` | `TextClipboardService` singleton: async `writeText`/`readText`, retry-once + debounced toast + log chokepoint | ~110 |
| ~~`src/renderer/src/hooks/useTextClipboard.ts`~~ | **dropped in review** — no consumer used the hook; the test seam is the exported `textClipboard` singleton + module-level `vi.mock` | — |
| `src/renderer/src/utils/monacoClipboardCommands.ts` | **pure** copy/cut/paste command logic (deps injected: `{ getSelection, getValueInRange, executeEdits, isReadOnly, textClipboard }`), mirrors `terminalClipboard.logic.ts` (must-fix [2]) | ~90 |
| `src/renderer/src/services/textClipboard.test.ts` | service unit tests (mock `window.api.clipboard`; assert retry, debounce, toast+log) | ~170 |
| `src/renderer/src/utils/monacoClipboardCommands.test.ts` | pure-logic tests: single-fire copy/cut/paste, read-only guard, empty-selection no-op | ~150 |
| `src/main/ipc/clipboard-handlers.test.ts` | main handler tests (mock electron `clipboard`; sender validation; Zod reject; error path) | ~120 |

### Modified

| Path | Change |
|------|--------|
| `src/main/index.ts` | import + call `registerClipboardHandlers()` |
| `src/preload/index.ts` | add `clipboard: { readText, writeText }` to `api` (uses `ipcRenderer.invoke`) |
| `src/preload/index.d.ts` | add `clipboard: ClipboardBridge` typing to `Window.api` |
| `src/renderer/src/hooks/useTerminalClipboard.ts` | swap `navigator.clipboard.*` → service (async, already Promise-based); keep `logic.ts` + `xterm.paste()` verbatim; verify `onError` callers before removing |
| `src/renderer/src/hooks/useTextareaClipboard.ts` | rebuild cut/copy/paste on service; remove silent catches; keep `maxLength` reject as a silent product rule (no toast) |
| `src/renderer/src/hooks/useEditorContextMenu.ts` | paste reads via service (await) |
| `src/renderer/src/components/ContextMenu/EditorContextMenu.tsx` | cut/copy write via service; cut deletes only on `writeText === true` |
| `src/renderer/src/components/Editor/MonacoMarkdownEditor.tsx` | register copy/cut/paste via `editor.addAction` (keybindings + `contextMenuGroupId:'9_cutcopypaste'`) delegating to `monacoClipboardCommands.ts` |
| `src/renderer/src/components/Editor/MarkdownPreview.tsx` | Cmd+C handler writes via service, drop silent catch |
| `src/renderer/src/components/ContextMenu/PreviewContextMenu.tsx` | copy write via service |
| `src/renderer/src/components/Dialog/FilePickerDialog.tsx` | copy-path write via service, drop silent catch |
| `src/renderer/src/components/Dialog/PromptDialog.tsx` | delete inline cut/copy/paste, use `useTextareaClipboard` |
| `src/renderer/src/components/Dialog/FileSystemDialog.tsx` | delete inline dupes, use `useTextareaClipboard` |
| `src/renderer/src/components/Editor/DiagramViewer/ChatBubble.tsx` | delete inline dupes, use `useTextareaClipboard` |

Extracting `monacoClipboardCommands.ts` keeps `MonacoMarkdownEditor.tsx` from growing; the editor file only gains thin `addAction` registrations. All files stay ≤500 lines; Phase 5 verifies line counts.

## 3. IPC contract — ASYNC + Zod

Channels (`src/shared/ipc/clipboard-channels.ts`): `readText: 'clipboard:readText'`, `writeText: 'clipboard:writeText'`.

| Channel | Request | Resolves to |
|---------|---------|-------------|
| `clipboard:readText` | none | `Promise<string>` (`''` on failure) |
| `clipboard:writeText` | `text: string` (Zod `z.string().max(CLIPBOARD_MAX_TEXT_LENGTH)`) | `Promise<boolean>` (`false` on failure/reject) |

Handler shape (both): `assertSender(event)` first → on mismatch return safe value + `logger.warn`; then `safeParse` the payload (writeText) → on failure return `false` + `logger.warn`; then call electron `clipboard` in try/catch → `logger.error` + safe return on throw. `CLIPBOARD_MAX_TEXT_LENGTH` is a named constant in `clipboard-schema.ts` (proposed 5 MB of text; revisit in review). This is the codebase's first dedicated clipboard IPC; it follows the standard `invoke`+Zod convention (`logging-schema.ts` precedent) — no special deviation needed now that the bridge is async (corrects v1's inaccurate `getPlatform`/`getArch` precedent claim, lens finding [3]).

## 4. Renderer service API — ASYNC surface

```ts
class TextClipboardService {
  async writeText(text: string): Promise<boolean>   // true on success
  async readText(): Promise<string>                  // '' on failure
}
export const textClipboard = new TextClipboardService()
// test/DI seam:
export function useTextClipboard(): TextClipboardService  // returns the singleton
```

Async matches the consumers (terminal/textarea hooks are already `Promise`-based; the v1 "sync-wrapped-in-Promise" code smell disappears). No `cut`/`paste` helpers in the service — those are composite (clipboard primitive + surface-specific text mutation); the service owns only the primitive. **readText return is untrusted plain text** — documented on the method: consumers MUST treat as data (no `innerHTML`/`eval`/`dangerouslySetInnerHTML`); current consumers insert via `executeEdits`/`xterm.paste`/textarea value, all data sinks (cosmetic [13]).

Failure handling (transport-error chokepoint): on a failed `invoke` (throw, or main returns `false`), retry once after ~50 ms; if still failing, `logger.error` always and `showErrorToast` through a debounced emitter (coalesces bursts within a short window into one toast).

## 5. Monaco override strategy — addAction + pure logic

Monaco's built-in clipboard actions use the browser clipboard (throws `NotAllowedError`). Override with `editor.addAction` (not raw `addCommand`) so the action also registers in the context menu and reliably owns the chord; `addCommand` is not relied upon to suppress the built-in (lens must-fix [2]):

```ts
editor.addAction({ id: 'erfana.clipboardCopy', label: 'Copy', keybindings: [CtrlCmd|KeyC],
  contextMenuGroupId: '9_cutcopypaste', contextMenuOrder: 1, run: ed => clipboardCopy(deps(ed)) })
// …Cut (KeyX), Paste (KeyV) likewise → clipboardCut / clipboardPaste
```

All decision logic lives in `monacoClipboardCommands.ts` as pure functions taking injected deps:
- `clipboardCopy`: empty selection → no-op; else `await textClipboard.writeText(getValueInRange(sel))`.
- `clipboardCut`: empty selection → no-op; `isReadOnly` → no-op; `await writeText`; on success `executeEdits(range→'', endCursorState)`.
- `clipboardPaste`: `isReadOnly` → no-op; `const text = await textClipboard.readText()`; if text, `executeEdits(sel→text, endCursorState)` for deterministic cursor.

The context-menu paste path (`useEditorContextMenu`) and `EditorContextMenu` cut/copy share these same helpers so keybinding and menu behavior cannot diverge. Phase 5 adds a CJK IME-composition + paste smoke check (cosmetic [13]). If `addAction` proves to double-fire with the built-in in this Monaco version, fall back to also disabling the built-in action IDs — verified by the single-fire unit test.

## 6. Terminal migration

`useTerminalClipboard.ts` swaps only the two primitives to the async service; `terminalClipboard.logic.ts` untouched (preserves #28/#122); `xterm.paste(text)` newline normalization preserved (xterm owns `\r?\n → \r` + bracketing — do NOT pre-normalize). `handleKeyEvent` unchanged. Copy keeps selection in place. Verify no caller relies on the `onError` callback for control flow before removing it (lens [11]).

## 7. Textarea hook consolidation

`useTextareaClipboard.ts` rebuilt on the service (same public API + `maxLength`). `maxLength` over-limit reject stays a silent product rule (no toast). Silent `catch {}` removed. The 3 inline dupes migrate to the hook: `PromptDialog` (textarea), `FileSystemDialog` (input — hook supports `HTMLInputElement`; extra cursor-position check), `ChatBubble` (textarea). One-shot copies go to the service directly: `MarkdownPreview` Cmd+C, `PreviewContextMenu`, `FilePickerDialog` copy-path, `EditorContextMenu` cut/copy.

## 8. Error handling — transport-error chokepoint

Transport failures (failed `invoke`, main returns `false`) are handled in `TextClipboardService` (retry-once + debounced toast + `logger.error`); call sites never toast/log transport failures. **Clipboard *semantics* (what counts as a no-op) remain per-surface by design** — empty selection on copy/cut, empty clipboard on paste, `maxLength` reject — because each surface owns its own model mutation. This is a transport-error chokepoint, not a semantics chokepoint (v1 overstated this; lens [8]). Read-only surfaces (MarkdownPreview, PreviewContextMenu, FilePickerDialog) expose copy only; cut/paste not wired.

## 9. Native Edit menu — keep as-is

`role: 'cut'|'copy'|'paste'|'selectAll'` are routed by Chromium to the focused editable DOM element at the OS/Chromium layer — they do not go through `navigator.clipboard` and do not throw. Routing the menu through IPC would require manual focus-finding handlers — strictly worse, loses native accelerator/enablement. Phase 5 smoke-tests menu Copy inside Monaco.

## 10. Test plan

Conventions: `*.test.ts`, pure-logic extraction, vitest workspace (renderer/main/preload); window-mock pitfall → `(window as any).api = …`, never `vi.stubGlobal('window')`; testid count-based tests updated if any menu item gains a testid.

New:
- `monacoClipboardCommands.test.ts` (renderer, pure): copy/cut/paste fire exactly once; empty-selection no-op (copy+cut); read-only no-op (cut+paste); cut deletes only on `writeText===true`; paste inserts clipboard text once with correct end cursor. **This covers the primary bug surface** (lens must-fix [2], testability [9]).
- `textClipboard.test.ts` (renderer): write success/failure; read success/failure → `''`; retry-once on transient failure; debounced toast coalesces a burst; `logger.error` on every failure.
- `clipboard-handlers.test.ts` (main): success returns; sender mismatch → safe value + `logger.warn`; Zod reject of non-string/oversize → `false`; electron-`clipboard` throw → `''`/`false` + `logger.error`.
- preload bridge test (preload project): `api.clipboard.readText/writeText` call `ipcRenderer.invoke` with `CLIPBOARD_CHANNELS` names and pass payload through.

Extended / respecified:
- `useEditorContextMenu.test.ts`: assert paste `await`s the **service** (not `navigator.clipboard`); move the read-failure assertion to the service test (hook no longer logs — chokepoint owns it). Do NOT satisfy by mock-swap alone (lens [9]).
- `EditorContextMenu.test.tsx`: copy/cut route via service; cut deletes only on `writeText===true` (lens [12]).
- `terminalClipboard.logic.test.ts`: unchanged — regression guard for #28/#122 (must still pass).
- `useTerminalClipboard.test.ts`: copy routes via `textClipboard.writeText` without clearing selection; paste calls `xterm.paste` exactly once with the unmodified string (lens [11]).
- Per-surface no-toast assertions: empty selection / empty clipboard / over-limit produce no toast (lens [9]).

Coverage target ≥80% for new service + handlers + `monacoClipboardCommands`; no per-file coverage regression on migrated files. Integration checks deferred to E2E (native menu copy, FileSystemDialog cursor position) are **local-only** (e2e disabled in CI per docs/ci.md) — named explicitly so the gap is documented, not silent.

## 11. Migration sequencing (Phase 5)

1. `clipboard-channels.ts` + `clipboard-schema.ts` (channels, Zod, max-length const, `ClipboardBridge` type).
2. `clipboard-handlers.ts` (async `handle`, sender validation, Zod parse) + register in `index.ts` + tests → main serves clipboard.
3. `api.clipboard` in preload (`invoke`) + `index.d.ts` + preload bridge test → bridge live.
4. `textClipboard.ts` + `useTextClipboard.ts` + tests (retry/debounce/toast) → renderer chokepoint live.
5. `monacoClipboardCommands.ts` + tests → migrate `MonacoMarkdownEditor` to `addAction` + `useEditorContextMenu` + `EditorContextMenu`; smoke-test single-fire + IME. (Extract keeps editor file ≤500.)
6. Migrate `useTerminalClipboard` (logic untouched) + verify terminal tests green + add hook tests.
7. Rebuild `useTextareaClipboard` + migrate 3 inline dupes (cursor check on FileSystemDialog).
8. Migrate remaining one-shot copies (MarkdownPreview, PreviewContextMenu, FilePickerDialog).
9. Remove all remaining `navigator.clipboard.*` + silent `catch {}` on in-scope surfaces (grep returns only out-of-scope/test files).
10. `npm run lint && typecheck && test`; `npm run test:e2e` for terminal + editor clipboard flows (local).

## 12. Settled decisions

- **Async `invoke`** bridge + sync-removed service surface: user-confirmed (overrides issue's "synchronous" wording on lens evidence).
- Sender validation on handlers: required (must-fix [1]).
- `writeText` Zod-validated + length cap: required (should-fix [4]).
- Monaco override via `addAction` + pure `monacoClipboardCommands.ts` with single-fire test + read-only/empty-selection guards: required (must-fix [2], should-fix [5]).
- Toast on failure with retry-once + debounce; always log: user-confirmed intent, noise-hardened (should-fix [6]).
- `useTextClipboard()` hook test seam over bare singleton: adopted (should-fix [7]).
- "Transport-error chokepoint" framing (semantics stay per-surface): corrected (should-fix [8]).
- Keep native Edit menu as-is (§9); migrate FileSystemDialog `<input>` to shared hook with cursor check.

## Changelog v1 → v2 (lens-review remediation)

| Finding | Severity | Change |
|---------|----------|--------|
| [1] sender validation | must-fix | handlers validate `event.senderFrame` |
| [2] Monaco double-paste + untestable | must-fix | `addAction` + pure `monacoClipboardCommands.ts` + single-fire tests |
| [3] sync premise refuted | should-fix | async `invoke`/`handle`; removed false `getPlatform` precedent |
| [4] no length cap | should-fix | Zod `z.string().max(N)` + `CLIPBOARD_MAX_TEXT_LENGTH` |
| [5] read-only/empty/cursor | should-fix | guards + `endCursorState` in `monacoClipboardCommands` |
| [6] toast noise | should-fix | retry-once + debounced toast; always log |
| [7] singleton mockability | should-fix | chosen seam is the exported `textClipboard` singleton + module-level `vi.mock` (the `useTextClipboard()` hook was dropped — no consumer used it; all tests mock the service module directly) |
| [8] chokepoint overstated | should-fix | reframed as transport-error chokepoint |
| [9] test gaps | should-fix | Monaco pure tests, respec'd mocks, per-surface no-toast, e2e documented |
| [10] no shared type | nice-to-fix | `clipboard-schema.ts` ships `ClipboardBridge` |
| [11] terminal wiring tests | nice-to-fix | hook-level copy/selection/paste tests; verify `onError` |
| [12] menu cut/copy test | nice-to-fix | `EditorContextMenu.test.tsx` failure path |
| [13] polish (5) | cosmetic | readText untrusted note, sentinel limitation, IME smoke, no latency rationale, testid counts |
