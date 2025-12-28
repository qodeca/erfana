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

## 3. User constraints override technical elegance

When told "E2E tests MUST work with the UI as-is and click modal dialogs", don't propose workarounds that bypass the UI. The constraint is the requirement.

**Lesson**: Listen to constraints carefully. They often encode important product decisions.

---

## 4. Third-party libraries have testing blind spots

xterm.js renders to canvas, not DOM. `toContainText()` returns empty string because there's no text to find - it's all pixels.

**Lesson**: Research how third-party libraries render before writing assertions. Sometimes you can only verify "it didn't crash" rather than "it shows X".

---

## 5. Race conditions need defensive patterns

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

## 6. Page invalidation after close is expected

After clicking "Quit" in a dialog, the page becomes invalid. Any subsequent operations throw "Target page, context or browser has been closed".

**Lesson**: Wrap post-close operations in try-catch. This error is success, not failure.

```typescript
try {
  await page.waitForTimeout(300)
} catch {
  // Page closed - this is expected after quit
  break
}
```

---

## 7. E2E tests reveal integration issues

Unit tests mock everything. E2E tests expose real integration problems: IPC timing, dialog sequences, state management across processes.

**Lesson**: E2E failures often indicate real bugs users would encounter. Don't dismiss them as "flaky".

---

## 8. Test infrastructure is production code

Test helpers like `closeApp()`, `openProject()`, and `waitForAppReady()` are code that needs the same rigor as production code. They'll be used across dozens of tests.

**Lesson**: Review and test your test utilities. A bug in `closeApp()` breaks every test that uses it.

---

## 9. Delete stale documentation

The old `dismissDialogIfPresent()` function was documented but broken - it checked for dialogs before they could exist. The fix wasn't just code; it was removing misleading comments.

**Lesson**: When fixing bugs, audit related documentation. Wrong docs are worse than no docs.

---

## 10. Incremental debugging wins

The fix evolved through multiple iterations:
1. `Meta+Q` → didn't trigger right events
2. `electronApp.close()` → dialog appeared after check
3. `window.close()` → worked but page invalidated
4. Add try-catch → handled expected errors
5. Add retry loop → handled race conditions

**Lesson**: Each iteration taught something. Don't expect to get it right the first time with complex async flows.
