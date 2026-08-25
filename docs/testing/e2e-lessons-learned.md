# E2E Lessons Learned

Hard-won insights from implementing E2E testing for Electron apps with Playwright.

**Related documentation**:
- [E2E Testing Guide](./e2e-testing.md) - Main E2E documentation
- [E2E Troubleshooting](./e2e-troubleshooting.md) - Common issues and fixes

---

## 1. Understand Electron's event flow

Electron quit is not just "close the window". The flow is:

```
window.close() → main process 'close' event → 'quit:requested' IPC
→ renderer checks blockers → shows dialog → user clicks
→ 'quit:confirmResponse' IPC → app quits
```

**Lesson**: Map out the complete event chain before writing tests. Diagrams help.

---

## 2. Platform behavior differs subtly

`Meta+Q` on macOS goes through the app menu system (triggers `before-quit`), but `window.close()` triggers the window's `close` event directly. These are different code paths.

**Lesson**: Test the actual user flow. Keyboard shortcuts may not exercise the same code as window controls.

---

## 3. Third-party libraries have testing blind spots

xterm.js renders to canvas, not DOM. `toContainText()` returns empty string because there's no text to find - it's all pixels.

**Lesson**: Research how third-party libraries render before writing assertions. Sometimes you can only verify "it didn't crash" rather than "it shows X".

---

## 4. Race conditions need defensive patterns

The quit dialog might appear instantly or after 500ms depending on what blockers exist. A single check isn't enough.

**Pattern that works**:
```typescript
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    await expect(element).toBeVisible({ timeout: 1500 })
    await element.click()
    // Success - but might need another iteration
  } catch {
    // Element not visible - either done or not appearing
    break
  }
}
```

---

## 5. Page invalidation after close is expected

After clicking "Quit" in a dialog, the page becomes invalid. Any subsequent operations throw "Target page, context or browser has been closed".

**Lesson**: Wrap post-close operations in try-catch. This error is success, not failure.

```typescript
try {
  // KNOWN_WAIT: Inter-dialog pause during quit – page may be destroyed
  await page.waitForTimeout(300)
} catch {
  // Page closed - this is expected after quit
  break
}
```

> **Do not copy that `waitForTimeout` into a test.** The project rule is condition-based waits only – use a POM wait, `waitForIpcComplete`, or an auto-retrying `expect`. This snippet is the documented exception, quoted from the quit loop in `closeApp()` (`e2e/utils/helpers.ts`): it is a teardown path with no assertion, and the thing it waits on is the next dialog on a page that may already be destroyed, so there is no observable state left to poll. The exception mechanism is defined in [E2E Testing § Condition-based waits](./e2e-testing.md#condition-based-waits) – a genuinely necessary timeout carries a `// KNOWN_WAIT: <reason>` annotation, as it does in the source.

---

## 6. Playwright assertions beat manual state checks

The `element.isVisible()` method returns a boolean immediately - it doesn't wait.
During CSS animations, an element can have `display: block` (isVisible = true)
but zero dimensions (not actually visible to user).

**Anti-pattern**:
```typescript
if (await element.isVisible()) { return }  // Race condition!
```

**Correct pattern**:
```typescript
await expect(element).toBeVisible({ timeout: 2000 })  // Auto-retry until REALLY visible
```

**Lesson**: Use Playwright's assertion methods (`toBeVisible`, `toContainText`)
instead of state query methods (`isVisible()`, `textContent()`) for waiting logic.

---

## 7. Isolate browser state with `--user-data-dir`

Electron apps with Zustand persist middleware store state to localStorage. This causes test pollution - state from previous test runs bleeds into subsequent runs.

**Anti-pattern**:
```typescript
// localStorage.removeItem() happens AFTER Zustand already hydrated
await page.evaluate(() => localStorage.removeItem('erfana-activity-bar-state'))
await page.reload()  // Too late - state was already loaded
```

**Correct pattern**:
```typescript
// Worker-scoped fixture creates isolated user data directory
const userDataDir = await fs.promises.mkdtemp(path.join(e2eTempDir, `worker-${workerInfo.workerIndex}-`))

// Pass to Electron launch - fresh localStorage before any code runs
const app = await electron.launch({
  args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`],
})
```

**Lesson**: Process-level isolation (`--user-data-dir`) is more robust than runtime cleanup. Each Playwright worker gets a fresh Chromium profile with empty localStorage.

---

## 8. Guard webContents against destroyed state

During E2E teardown, `closeApp()` triggers `window.close()` which fires the BrowserWindow `close` event. If `webContents` is already destroyed (race with Playwright cleanup), calling `webContents.send()` throws an uncaught "Object has been destroyed" exception that shows a native error dialog and blocks the process.

**Fix**: Add `if (mainWindow.webContents.isDestroyed()) return` guard before any `webContents.send()` in the close handler.

**Lesson**: Always check `webContents.isDestroyed()` before sending IPC in lifecycle handlers. Electron's close/destroy sequence has race conditions that E2E tests expose.

---

## 9. Use `insertText()` instead of `keyboard.type()` for Monaco

`keyboard.type()` sends individual key-down/key-up events. Monaco Editor drops characters during re-layout cycles – especially after newline characters cause line breaks. Adding delays between keystrokes makes it *worse*, not better.

**Anti-pattern**:
```typescript
await page.keyboard.type('# Hello\n\nWorld')  // Drops chars: "keyoard" instead of "keyboard"
await page.keyboard.type('text', { delay: 30 })  // Even worse: 80% failure rate
```

**Correct pattern**:
```typescript
await page.keyboard.insertText('# Hello\n\nWorld')  // Single input event, like paste
```

**Lesson**: `insertText()` dispatches the entire text as a single input event (equivalent to a paste operation). This bypasses Monaco's per-keystroke re-layout and is 100% reliable.

---

## 10. Determinism beats masking; observable state beats side effects

Two convergent patterns that surfaced while stabilizing a visual-regression flake and a `userEvent.type()` flake (post-Phase-2 hygiene, 2026-04-21):

**10a. Prefer deterministic fixture data over masking ephemeral content.**

The `visualTestProject` fixture originally did `mkdtemp(path.join(tmp, 'visual-project-'))`, producing paths like `.e2e-temp/visual-project-kb339w`. The random suffix leaked into the project tree label, terminal title, and toast path — causing ~2 % pixel drift in the `(b) editor-loaded` snapshot.

Fix: split into outer random parent + fixed inner leaf.

```ts
const tmpParent = await fs.promises.mkdtemp(path.join(e2eTempDir, 'visual-'))
const projectPath = path.join(tmpParent, 'visual-project')   // deterministic leaf
```

Isolation preserved (outer parent unique per worker); visible labels stable. Masking the ephemeral regions would have worked too, but every future UI element placed in those regions would be untested. Prefer determinism at the source.

**10b. Gate `userEvent.type()` on observable state, not side-effect ordering.**

`userEvent.type(input, 'test')` can drop the first keystroke under CPU contention if React hasn't finished settling the initial render. Two fixes compared:

```ts
// Side-effect gate — works but fragile; depends on click dispatching focus
await user.click(input)
await user.type(input, 'test')

// Observable-state gate — deterministic; waits for the actual signal
await waitFor(() => expect(document.activeElement).toBe(input))
await user.type(input, 'test')
```

The observable-state gate is strictly more robust: it waits for the specific DOM state the next line depends on, instead of relying on a side-effect chain. Same pattern applies to `toHaveFocus()` and any other "is the UI ready?" check.

**Related**: mask specificity matters — pick the narrowest element that covers ephemeral content. In this codebase, `(b) editor-loaded` and `(c) terminal-open` now both mask `TERMINAL_INSTANCE` (xterm canvas only), not the full `TERMINAL_PANEL`, so panel-chrome regressions still register.

**Lesson**: flakes are usually a signal that the test is expressing *timing* instead of *causality*. Find the observable signal the test actually depends on and wait for that; remove ephemeral content at the source rather than papering over it with masks.
