# Testing Third-Party Components

Strategies for testing third-party libraries whose internal DOM is not accessible.

**Related documentation**:
- [E2E Testing Guide](./e2e-testing.md) - Main E2E documentation
- [E2E Selectors](./e2e-selectors.md) - Complete testid catalog
- Spec #011 (archived) – Specification

---

## Monaco Editor

Monaco's internal DOM is not accessible for direct testid injection. Use wrapper-based testing:

```typescript
// DO: Query the wrapper
const editor = window.locator('[data-testid="editor-monaco"]')
await expect(editor).toBeVisible()

// DO: Focus through the helper, then insert text in one input event
await monaco.focus(window)
await window.keyboard.insertText('# Hello World')

// DO: Use Monaco's command palette
await window.keyboard.press('F1')
await window.keyboard.type('Format Document')
await window.keyboard.press('Enter')

// DON'T: Try to access Monaco's internal elements
// window.locator('.monaco-editor .view-line') // Fragile!
```

### Monaco initialization and focus

Monaco requires special handling for reliable E2E tests:

1. **Wait for ready state** - Use `monaco.waitForReady()` which waits for the internal textarea (keyboard input target) to be attached, not just the `.monaco-editor` container
2. **Force click for focus** - Use `monaco.focus()` which clicks with `force: true` to handle Monaco's overlapping layers
3. **Verify focus acquired** - `focus()` retries the click until the editor carries Monaco's `focused` class (the blinking cursor is not a stable signal)
4. **Use `insertText()` for content** - `keyboard.type()` sends individual keystrokes which Monaco can drop during re-layout; `keyboard.insertText()` dispatches full text as a single input event

```typescript
import { monaco } from './utils/helpers'

// Wait for Monaco to be fully initialized (waits for internal textarea)
await monaco.waitForReady(page)

// Focus editor (handles overlapping layers, verifies Monaco's focused class)
await monaco.focus(page)

// Use insertText for reliable multi-line content (not keyboard.type)
await page.keyboard.insertText('# Hello World\n\nContent here')
```

### Monaco testing patterns

| Action | Method |
|--------|--------|
| Wait for ready | `monaco.waitForReady(page)` |
| Focus editor | `monaco.focus(page)` |
| Set content | `keyboard.selectAll()` + `keyboard.insertText()` |
| Get content | `monaco.getContent(page)` – reads the Monaco model through the e2e test hook. `MonacoPage.visibleText()` reads the rendered lines instead; see [e2e-testing.md § Reading editor content](./e2e-testing.md#reading-editor-content-getcontent-vs-visibletext) |
| Insert text | `page.keyboard.insertText(text)` (preferred over `type()`) |
| Select all | `Cmd/Ctrl+A` |
| Copy | `Cmd/Ctrl+C` |
| Paste | `Cmd/Ctrl+V` |
| Undo | `Cmd/Ctrl+Z` |
| Find | `Cmd/Ctrl+F` (uses Erfana's SearchBar) |
| Format | `F1` then "Format Document" |
| Find next / previous | `Cmd/Ctrl+G` / `Cmd/Ctrl+Shift+G` (overridden to drive Erfana's SearchBar) |

### Example: Setting editor content

```typescript
import { monaco } from './utils/helpers'

test('set editor content', async ({ window }) => {
  // Wait for Monaco to be ready and set content
  await monaco.waitForReady(window)
  await monaco.setContent(window, '# New Document\n\nHello, world!')

  // Verify via preview (if in split mode)
  const preview = window.locator('[data-testid="editor-preview"]')
  await expect(preview).toContainText('New Document')
})
```

### Example: Using search

```typescript
test('search in editor', async ({ window }) => {
  const editor = window.locator('[data-testid="editor-monaco"]')
  await editor.click()

  // Open Erfana's search bar (overrides Monaco's native find)
  const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'
  await window.keyboard.press(`${modKey}+F`)

  // Search bar should appear
  const searchBar = window.locator('[data-testid="search-bar"]')
  await expect(searchBar).toBeVisible()

  // Type search query
  const searchInput = window.locator('[data-testid="search-bar-input"]')
  await searchInput.fill('hello')

  // Check match count
  const matchCount = window.locator('[data-testid="search-bar-count"]')
  await expect(matchCount).toContainText(/\d+ of \d+/)
})
```

---

## xterm.js Terminal

xterm.js draws its text with the WebGL renderer, so the DOM holds no text to assert on. Use the wrapper for presence and `TerminalPage` (or the `terminal` adapter in `e2e/utils/helpers.ts`) for input and output – it reads xterm's buffer through the app's e2e test hook (`window.__erfanaTest`):

```typescript
// Query terminal wrapper
const terminal = window.locator('[data-testid="terminal-instance"]')
await expect(terminal).toBeVisible()

// Send input and wait for output through TerminalPage
await terminalPage.waitForPrompt()
await terminalPage.sendCommand('echo "Hello"')
await terminalPage.waitForOutput('Hello')

// Use terminal control buttons
await window.locator('[data-testid="terminal-btn-scroll"]').click()
await window.locator('[data-testid="terminal-btn-restart"]').click()
```

### Terminal testing patterns

| Action | Method |
|--------|--------|
| Send command | `terminalPage.sendCommand(command)` |
| Wait for output | `terminalPage.waitForOutput(text)` (or `waitForOutputLine(line)` for a whole output line) |
| Scroll to bottom | Click `terminal-btn-scroll` |
| Restart | Click `terminal-btn-restart` |
| Copy | `Cmd/Ctrl+C` (when text selected) |
| Paste | `Cmd/Ctrl+V` |
| Clear | Type `clear` + Enter |
| Interrupt | `Ctrl+C` (send SIGINT) |

### Example: Run command and verify output

```typescript
test('run terminal command', async ({ window }) => {
  // Open terminal panel
  await window.locator('[data-testid="activity-bar-btn-terminal"]').click()

  const terminal = window.locator('[data-testid="terminal-instance"]')
  await expect(terminal).toBeVisible()

  // Wait for the prompt – a condition, never a fixed sleep
  await terminalPage.waitForPrompt()

  // Send command and wait for output (read from xterm's buffer)
  await terminalPage.sendCommand('pwd')
  await terminalPage.waitForOutput('/')
})
```

### Example: Test terminal restart

```typescript
test('restart terminal', async ({ window }) => {
  await window.locator('[data-testid="activity-bar-btn-terminal"]').click()

  const terminal = window.locator('[data-testid="terminal-instance"]')
  const restartBtn = window.locator('[data-testid="terminal-btn-restart"]')

  // Click restart
  await restartBtn.click()

  // Terminal should reinitialize
  await expect(terminal).toBeVisible()
})
```

### Canvas rendering limitation

xterm.js renders with the WebGL addon, not DOM text. `toContainText()` on the terminal wrapper finds nothing to match – it is all pixels. Read the screen with `TerminalPage.readScreen()` (or the `waitForOutput*` waits built on it), which reads xterm's buffer through the e2e test hook and throws rather than returning an empty screen when it cannot read one.

---

## Mermaid diagrams

Mermaid renders SVG inside a wrapper. Test via wrapper and toolbar:

```typescript
// Query Mermaid toolbar (appears when hovering diagram)
const toolbar = window.locator('[data-testid="mermaid-toolbar"]')
await expect(toolbar).toBeVisible()

// Change diagram direction
await window.locator('[data-testid="mermaid-direction-btn-LR"]').click()

// Expand to fullscreen
await window.locator('[data-testid="mermaid-btn-expand"]').click()

// In fullscreen viewer
const viewer = window.locator('[data-testid="diagram-viewer"]')
await expect(viewer).toBeVisible()

// Zoom controls
await window.locator('[data-testid="chat-btn-zoom-in"]').click()
await window.locator('[data-testid="chat-btn-zoom-out"]').click()
await window.locator('[data-testid="chat-btn-fit"]').click()
await window.locator('[data-testid="chat-btn-reset"]').click()

// Close viewer
await window.locator('[data-testid="diagram-viewer-btn-close"]').click()
```

### Mermaid testing patterns

| Action | Method |
|--------|--------|
| Hover to show toolbar | `locator.hover()` on diagram container |
| Change direction | Click `mermaid-direction-btn-{TB/BT/LR/RL}` |
| Open fullscreen | Click `mermaid-btn-expand` |
| Zoom in/out | Click `chat-btn-zoom-in` / `chat-btn-zoom-out` |
| Fit to screen | Click `chat-btn-fit` |
| Reset zoom | Click `chat-btn-reset` |
| Close viewer | Click `diagram-viewer-btn-close` |

### Example: Test diagram viewer

```typescript
test('mermaid diagram viewer', async ({ window }) => {
  // Assuming a file with Mermaid diagram is open
  const preview = window.locator('[data-testid="editor-preview"]')
  await expect(preview).toBeVisible()

  // Hover over diagram to show toolbar
  const diagramContainer = preview.locator('.mermaid').first()
  await diagramContainer.hover()

  // Toolbar should appear
  const toolbar = window.locator('[data-testid="mermaid-toolbar"]')
  await expect(toolbar).toBeVisible()

  // Click expand
  await window.locator('[data-testid="mermaid-btn-expand"]').click()

  // Viewer should open
  const viewer = window.locator('[data-testid="diagram-viewer"]')
  await expect(viewer).toBeVisible()

  // Close viewer with Escape
  await window.keyboard.press('Escape')
  await expect(viewer).not.toBeVisible()
})
```
