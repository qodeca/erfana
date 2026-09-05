# E2E Troubleshooting

Common issues and solutions for Playwright E2E tests with Electron.

**Related documentation**:
- [E2E Testing Guide](./e2e-testing.md) - Main E2E documentation
- [E2E Lessons Learned](./e2e-lessons-learned.md) - Hard-won insights

---

## Tests timeout on launch

No dev server is involved: `npm run test:e2e` is `electron-vite build && playwright test --project=electron`, so it builds `out/` first and launches the built app. If a launch times out, make sure the build step succeeded (run `npx electron-vite build` on its own and read its output), and that no stale `out/` from a different branch is being launched – `npm run test:e2e:no-build` skips the build and is only safe right after a fresh one:

```bash
npx electron-vite build
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
import { terminal } from '../utils/helpers'

// Opens the panel and waits for the prompt (xterm textarea present + PTY delay)
await terminal.open(page)

// Now send the command and wait for its output
await terminal.sendCommand(page, 'echo test')
await terminal.waitForOutput(page, 'test')
```

`terminal.*` in `e2e/utils/helpers.ts` delegates to `TerminalPage` (`e2e/pages/terminal.page.ts`); there is no `waitForTerminal()` / `sendTerminalInput()` helper. `TerminalPage.waitForPrompt()` (called by `open()`) polls for the xterm textarea and then applies `PTY_INIT_DELAY_MS = 1500`. This is still a blind sleep, not a real readiness probe — on a dev machine with a heavy `.zshrc`, zsh's `source ~/.zshrc` can take longer than 1500 ms and the typed command sits in the kernel PTY buffer without ever being read by the shell. The kernel TTY line discipline echoes each character back to xterm (giving the impression that input is being processed), but no command executes and the shell prompt never appears.

If a terminal-driven test fails consistently on your machine while passing on CI, time your shell init (e.g. `time zsh -i -c exit`) before suspecting a code regression. See [known issues § E2E terminal-driven tests sensitive to user's shell init speed](../known-issues.md#e2e-terminal-driven-tests-sensitive-to-users-shell-init-speed) for the full root-cause analysis and the two candidate fixes.

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

// Fix: Wait for the animated element to settle – a condition, not a sleep
await expect(window.locator('[data-testid="settings-overlay"]')).toBeVisible()
// If a sleep is truly unavoidable, annotate it: // KNOWN_WAIT: <reason>

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
