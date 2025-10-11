# Claude Code Testing Quick Start

This is a streamlined guide for Claude Code to quickly test Erfana using Circuit Electron MCP. For comprehensive documentation, see [circuit-electron-testing.md](./circuit-electron-testing.md).

## Prerequisites

```bash
# Build the application first
npm run build

# Verify build succeeded
ls -la out/main/index.js
```

## 1-Minute Test

Launch app and take a screenshot:

```typescript
// Launch
const session = mcp__circuit-electron__app_launch({
  app: "/Users/marcinobel/Projects/erfana/out/main/index.js",
  compressScreenshots: true,
  screenshotQuality: 75
})

// Wait for UI
mcp__circuit-electron__wait_for_selector({
  sessionId: session.sessionId,
  selector: ".app-dock-layout",
  timeout: 5000
})

// Screenshot
mcp__circuit-electron__screenshot({
  sessionId: session.sessionId
})

// Done
mcp__circuit-electron__close({ sessionId: session.sessionId })
```

## Common Test Patterns

### Pattern 1: Launch → Screenshot → Close

```typescript
const s = mcp__circuit-electron__app_launch({
  app: "/Users/marcinobel/Projects/erfana/out/main/index.js",
  compressScreenshots: true
})

mcp__circuit-electron__screenshot({ sessionId: s.sessionId })
mcp__circuit-electron__close({ sessionId: s.sessionId })
```

### Pattern 2: Launch → Interact → Verify

```typescript
// Launch
const s = mcp__circuit-electron__app_launch({ app: "..." })

// Interact
mcp__circuit-electron__click_by_text({ sessionId: s.sessionId, text: "README.md" })
mcp__circuit-electron__wait_for_selector({ sessionId: s.sessionId, selector: ".monaco-editor" })

// Verify
const result = mcp__circuit-electron__evaluate({
  sessionId: s.sessionId,
  expression: "document.querySelector('.monaco-editor') !== null"
})

// Screenshot + Close
mcp__circuit-electron__screenshot({ sessionId: s.sessionId })
mcp__circuit-electron__close({ sessionId: s.sessionId })
```

### Pattern 3: Test Keyboard Shortcut

```typescript
const s = mcp__circuit-electron__app_launch({ app: "..." })

// Before screenshot
mcp__circuit-electron__screenshot({ sessionId: s.sessionId })

// Press shortcut
mcp__circuit-electron__keyboard_press({
  sessionId: s.sessionId,
  key: "b",
  modifiers: ["Meta"]  // Cmd on Mac, Ctrl on Windows
})

// After screenshot
mcp__circuit-electron__screenshot({ sessionId: s.sessionId })
mcp__circuit-electron__close({ sessionId: s.sessionId })
```

## Quick Reference

### Essential Commands

| Action | Command |
|--------|---------|
| Launch app | `app_launch({ app: "path" })` |
| Screenshot | `screenshot({ sessionId })` |
| Click element | `click({ sessionId, selector })` |
| Click by text | `click_by_text({ sessionId, text })` |
| Type text | `keyboard_type({ sessionId, text })` |
| Press key | `keyboard_press({ sessionId, key, modifiers })` |
| Run JavaScript | `evaluate({ sessionId, expression })` |
| Wait for element | `wait_for_selector({ sessionId, selector })` |
| Close session | `close({ sessionId })` |

### Erfana-Specific Selectors

| Element | Selector |
|---------|----------|
| Main layout | `.app-dock-layout` |
| Explorer panel | `[title="Explorer"]` |
| Terminal panel | `[title="Terminal"]` |
| Git panel | `[title="Git"]` |
| File tree | `.file-tree` |
| Monaco editor | `.monaco-editor` |
| Preview pane | `.preview-pane` |
| Toolbar | `.toolbar` |
| Save button | `button.save-btn` |
| Modified indicator | `.modified-indicator` |
| Document stats | `.document-stats` |

### Erfana Keyboard Shortcuts

| Shortcut | Action | Code |
|----------|--------|------|
| Cmd/Ctrl+B | Toggle Explorer | `keyboard_press({ key: "b", modifiers: ["Meta"] })` |
| Cmd/Ctrl+J | Toggle Terminal | `keyboard_press({ key: "j", modifiers: ["Meta"] })` |
| Cmd/Ctrl+Alt+B | Toggle Git | `keyboard_press({ key: "b", modifiers: ["Meta", "Alt"] })` |
| Cmd/Ctrl+S | Save file | `keyboard_press({ key: "s", modifiers: ["Meta"] })` |
| Cmd/Ctrl+W | Close tab | `keyboard_press({ key: "w", modifiers: ["Meta"] })` |

## Debugging Workflow

### 1. Visual Check
```typescript
const s = mcp__circuit-electron__app_launch({ app: "..." })
mcp__circuit-electron__screenshot({ sessionId: s.sessionId })
// Analyze screenshot to understand current state
```

### 2. Inspect State
```typescript
const state = mcp__circuit-electron__evaluate({
  sessionId: s.sessionId,
  expression: `({
    panels: {
      explorer: document.querySelector('[title="Explorer"]') !== null,
      terminal: document.querySelector('[title="Terminal"]') !== null,
      git: document.querySelector('[title="Git"]') !== null
    },
    editor: {
      exists: document.querySelector('.monaco-editor') !== null,
      hasContent: document.querySelector('.monaco-editor')?.innerText.length > 0
    }
  })`
})
```

### 3. Get Accessibility Tree
```typescript
mcp__circuit-electron__snapshot({ sessionId: s.sessionId })
// Returns full accessibility tree with element roles and names
```

### 4. Check Console Errors
```typescript
const errors = mcp__circuit-electron__evaluate({
  sessionId: s.sessionId,
  expression: `(() => {
    const errors = []
    window.addEventListener('error', e => errors.push(e.message))
    return errors
  })()`
})
```

## Testing After Code Changes

**Typical workflow:**

1. **Make code changes**
2. **Build:** `npm run build`
3. **Launch app:** `app_launch({ app: "..." })`
4. **Visual verification:** `screenshot()`
5. **Functional test:** Click, type, verify
6. **Close:** `close()`

**Quick script:**

```typescript
// Build first (run in terminal)
// npm run build

// Then test
const s = mcp__circuit-electron__app_launch({
  app: "/Users/marcinobel/Projects/erfana/out/main/index.js",
  compressScreenshots: true
})

// Test the change
mcp__circuit-electron__screenshot({ sessionId: s.sessionId })

// Test specific feature
mcp__circuit-electron__click_by_text({ sessionId: s.sessionId, text: "Feature Name" })
mcp__circuit-electron__wait_for_selector({ sessionId: s.sessionId, selector: ".expected-element" })
mcp__circuit-electron__screenshot({ sessionId: s.sessionId })

// Verify it worked
const worked = mcp__circuit-electron__evaluate({
  sessionId: s.sessionId,
  expression: "/* check if feature works */"
})

mcp__circuit-electron__close({ sessionId: s.sessionId })
```

## Troubleshooting

### App Won't Launch

**Problem:** `app_launch` fails or times out

**Solutions:**
1. Check app path is correct: `ls -la /Users/marcinobel/Projects/erfana/out/main/index.js`
2. Verify build succeeded: `npm run build`
3. Check if app is already running (close it first)
4. Try absolute path instead of relative

### Can't Find Elements

**Problem:** `click` or `wait_for_selector` fails

**Solutions:**
1. Take screenshot first to see current state
2. Use `snapshot` to get accessibility tree
3. Try different selector strategies:
   - CSS: `.class-name`, `#id`, `button.save-btn`
   - Text: `text=Save` or `click_by_text`
   - Role: `role=button[name='Save']`
4. Add `wait_for_selector` before clicking

### Screenshots Are Blank

**Problem:** Screenshot shows nothing or wrong content

**Solutions:**
1. Wait for UI to load: `wait_for_selector({ selector: ".app-dock-layout" })`
2. Check window list: `get_windows({ sessionId })`
3. Increase timeout in wait commands
4. Verify app actually launched (check for errors)

### Session Lost

**Problem:** "Session not found" error

**Solutions:**
1. Store `sessionId` in a variable
2. Check if app closed unexpectedly
3. Create new session if needed
4. Don't reuse sessions after `close()`

## Next Steps

Once comfortable with basic testing:

1. **Explore full tool documentation:** [circuit-electron-testing.md](./circuit-electron-testing.md)
2. **Try pre-defined scenarios:** [test-scenarios.md](./test-scenarios.md)
3. **Add custom test scenarios** for new features
4. **Integrate testing** into development workflow

## Cheat Sheet

```typescript
// Copy-paste template for quick testing

const session = mcp__circuit-electron__app_launch({
  app: "/Users/marcinobel/Projects/erfana/out/main/index.js",
  compressScreenshots: true,
  screenshotQuality: 75
})

// Wait for app to load
mcp__circuit-electron__wait_for_selector({
  sessionId: session.sessionId,
  selector: ".app-dock-layout",
  timeout: 5000
})

// Take screenshot
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// === YOUR TEST CODE HERE ===

// Example: Click a button
mcp__circuit-electron__click_by_text({
  sessionId: session.sessionId,
  text: "Button Text"
})

// Example: Verify something
const result = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: "document.querySelector('.target-element') !== null"
})

// Example: Keyboard shortcut
mcp__circuit-electron__keyboard_press({
  sessionId: session.sessionId,
  key: "s",
  modifiers: ["Meta"]
})

// === END TEST CODE ===

// Take final screenshot
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// Clean up
mcp__circuit-electron__close({ sessionId: session.sessionId })

// Log result
console.log("Test result:", result)
```

## Tips for Efficient Testing

1. **Always build before testing:** `npm run build`
2. **Save sessionId:** `const s = app_launch(...).sessionId`
3. **Screenshot before & after** key actions
4. **Wait for elements** before interacting
5. **Verify changes** with `evaluate`
6. **Close sessions** when done
7. **Use text selectors** for buttons/labels (more stable than CSS)
8. **Compress screenshots** for faster AI analysis
9. **Test keyboard shortcuts** (they're fast to verify)
10. **Check accessibility tree** if CSS selectors fail

---

**Ready to test?** Start with the 1-minute test above, then explore the [full test scenarios](./test-scenarios.md)!
