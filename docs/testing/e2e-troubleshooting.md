# E2E Troubleshooting

Common issues and solutions for Playwright E2E tests with Electron.

**Related documentation**:
- [E2E Testing Guide](./e2e-testing.md) - Main E2E documentation
- [E2E Lessons Learned](./e2e-lessons-learned.md) - Hard-won insights

---

## Tests timeout on launch

Ensure dev server is running:

```bash
npm run dev &
sleep 5
npm run test:e2e
```

Or increase timeout in `playwright.config.ts`:

```typescript
export default defineConfig({
  timeout: 120000,  // 2 minutes
})
```

---

## Cannot attach debugger

Use test build for debugging:

```bash
ERFANA_TEST_BUILD=true npm run build:mac
```

This enables the `--inspect` flag which is disabled in production builds.

---

## Element not found

1. **Check if element is in a portal** (dialog, menu, toast) - use global query
2. **Use `waitForLoadState('domcontentloaded')`** before querying
3. **Verify testid exists** using `getAllTestIds()` helper
4. **Check element visibility** - element may exist but be hidden

```typescript
// Debug: List all testids on page
const allIds = await getAllTestIds(window)
console.log('Available testids:', allIds)

// Debug: Check if element exists but hidden
const element = window.locator('[data-testid="my-element"]')
const count = await element.count()
console.log('Element count:', count)
const visible = await element.isVisible()
console.log('Element visible:', visible)
```

---

## Monaco editor not responding to keyboard

Monaco needs proper initialization and focus before keyboard input. Use the `monaco` helper which handles this reliably:

```typescript
import { monaco } from './utils/helpers'

// Wait for Monaco to be fully ready (Playwright auto-retry, no fixed timeout)
await monaco.waitForReady(page)

// Focus using force click and verify cursor visibility
await monaco.focus(page)

// Now keyboard input works reliably
await page.keyboard.type('Hello')

// Or use the combined helper
await monaco.setContent(page, '# Hello World')
```

**Why this works**:
- `waitForReady()` uses Playwright's auto-retry to wait for `.monaco-editor` container
- `focus()` clicks with `force: true` to handle Monaco's overlapping DOM layers
- Focus is verified by checking cursor visibility before returning

**Common mistakes**:
- Using fixed `waitForTimeout()` instead of auto-retry assertions
- Clicking without `force: true` (may hit wrong layer)
- Not verifying focus was acquired before typing

---

## Terminal commands not executing

Terminal PTY needs time to initialize:

```typescript
// Wait for terminal ready
await waitForTestId(window, TEST_IDS.TERMINAL_INSTANCE)
await window.waitForTimeout(1000)  // PTY initialization

// Now send command
await sendTerminalInput(window, 'echo test')
```

---

## Dynamic testids not matching

Verify the path used for hash matches exactly:

```typescript
// The path must match EXACTLY what the component uses
const correctTestId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, 'src/main/index.ts')
const wrongTestId = getDynamicTestId(TEST_IDS.PROJECT_TREE_NODE, './src/main/index.ts')
// These produce different hashes!
```

---

## Flaky tests

Common causes and fixes:

| Symptom | Cause | Fix |
|---------|-------|-----|
| Intermittent timeout | Async operation | Add explicit wait |
| Element not visible | Animation | Wait for animation end |
| Wrong element clicked | Multiple matches | Use more specific selector |
| State not reset | Test pollution | Use fresh app instance per test |

```typescript
// Fix: Explicit wait for element state
await expect(element).toBeVisible()
await expect(element).toBeEnabled()
await element.click()

// Fix: Wait for animation
await window.waitForTimeout(300)  // Match animation duration

// Fix: More specific selector
const firstTab = window.locator('[data-testid^="tab-item-"]').first()
```

---

## Platform-specific notes

### Cross-platform testing

Use platform-aware keyboard shortcuts:

```typescript
// Good: Platform-aware modifier key
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
await window.keyboard.press(`${modKey}+A`)  // Select all
await window.keyboard.press(`${modKey}+C`)  // Copy
await window.keyboard.press(`${modKey}+V`)  // Paste

// Bad: Hardcoded to macOS
await window.keyboard.press('Meta+A')  // Fails on Windows/Linux
```

**Common shortcuts**:
- `Cmd` (macOS) / `Ctrl` (Windows/Linux): Use `Meta` or `Control`
- `Option` (macOS) / `Alt` (Windows/Linux): Use `Alt` on all platforms
- `Enter`, `Escape`, `Tab`, `F1`-`F12`: Same on all platforms

### macOS

- Use `Meta` key for keyboard shortcuts (Cmd)
- DMG builds are signed and notarized in production
- Test builds skip notarization for faster iteration

### Windows

- Use `Control` key for keyboard shortcuts
- UAC prompts may appear for certain operations
- File paths use backslashes (but testid hashes normalize paths)

### Linux

- Use `Control` key for keyboard shortcuts
- May need X11/Wayland configuration for headed tests
- Sandbox may require `--no-sandbox` flag in some environments
