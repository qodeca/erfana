# Circuit Electron MCP Testing Guide

This guide explains how to use Circuit Electron MCP to visually inspect, interact with, and test the Erfana UI. Circuit Electron MCP is already configured in your Claude Code setup and ready to use.

## Overview

Circuit Electron MCP enables Claude Code to:
- Launch and control the Erfana application
- Capture screenshots with AI-optimized compression
- Interact with UI elements (click, type, keyboard shortcuts)
- Inspect accessibility tree
- Execute JavaScript in the app context
- Manage multiple windows
- Read/write files within the app session

## Quick Start

### Launching Erfana

**Option 1: Launch Built Application** (Recommended for testing)

```typescript
// First, build the application
// In terminal: npm run build

// Then launch via Circuit Electron MCP
const session = mcp__circuit-electron__app_launch({
  app: "/Users/marcinobel/Projects/erfana/out/main/index.js",
  compressScreenshots: true,
  screenshotQuality: 70
})
```

**Option 2: Launch from Application Bundle** (macOS)

```typescript
const session = mcp__circuit-electron__app_launch({
  app: "/Applications/Erfana.app",
  compressScreenshots: true,
  screenshotQuality: 70
})
```

**Option 3: Development Mode with Project Path**

```typescript
const session = mcp__circuit-electron__app_launch({
  app: "/Users/marcinobel/Projects/erfana/node_modules/.bin/electron",
  projectPath: "/Users/marcinobel/Projects/erfana",
  startScript: "dev",
  compressScreenshots: true,
  screenshotQuality: 70
})
```

### Taking Screenshots

```typescript
// Capture the current state
mcp__circuit-electron__screenshot({
  sessionId: session.sessionId
})
```

Returns a compressed image optimized for AI vision models.

## Available Tools

### 1. `app_launch`
Launch the Electron application and establish a testing session.

**Parameters:**
- `app` (string, required): Path to Electron executable or .app bundle
- `projectPath` (string, optional): Project root directory for dev mode
- `startScript` (string, optional): npm script name to run (e.g., "dev")
- `compressScreenshots` (boolean, optional): Enable image compression (default: true)
- `screenshotQuality` (number, optional): JPEG quality 0-100 (default: 70)
- `disableDevtools` (boolean, optional): Disable DevTools

**Returns:** Session object with `sessionId`

**Example:**
```typescript
const session = mcp__circuit-electron__app_launch({
  app: "/Users/marcinobel/Projects/erfana/out/main/index.js",
  compressScreenshots: true,
  screenshotQuality: 80
})
// Store session.sessionId for subsequent commands
```

### 2. `screenshot`
Capture a compressed screenshot of the current window.

**Parameters:**
- `sessionId` (string, required): Session ID from app_launch
- `windowId` (string, optional): Specific window to capture

**Returns:** Base64-encoded image data

**Example:**
```typescript
mcp__circuit-electron__screenshot({
  sessionId: "erfana-session-id"
})
```

### 3. `click`
Click on a UI element using various selector strategies.

**Parameters:**
- `sessionId` (string, required)
- `selector` (string, required): CSS selector, text, or role
- `windowId` (string, optional)

**Example:**
```typescript
// Click by CSS selector
mcp__circuit-electron__click({
  sessionId: "erfana-session-id",
  selector: "button.save-btn"
})

// Click by text
mcp__circuit-electron__click({
  sessionId: "erfana-session-id",
  selector: "text=Save"
})

// Click by role
mcp__circuit-electron__click({
  sessionId: "erfana-session-id",
  selector: "role=button[name='Save']"
})
```

### 4. `click_by_text`
Click element containing specific text.

**Parameters:**
- `sessionId` (string, required)
- `text` (string, required): Text to search for
- `exact` (boolean, optional): Exact match vs contains (default: false)

**Example:**
```typescript
mcp__circuit-electron__click_by_text({
  sessionId: "erfana-session-id",
  text: "Project",
  exact: true
})
```

### 5. `click_by_role`
Click element by ARIA role and name.

**Parameters:**
- `sessionId` (string, required)
- `role` (string, required): ARIA role (button, link, textbox, etc.)
- `name` (string, optional): Accessible name

**Example:**
```typescript
mcp__circuit-electron__click_by_role({
  sessionId: "erfana-session-id",
  role: "button",
  name: "Toggle Sidebar"
})
```

### 6. `keyboard_type`
Type text into the focused element.

**Parameters:**
- `sessionId` (string, required)
- `text` (string, required): Text to type
- `delay` (number, optional): Milliseconds between keystrokes

**Example:**
```typescript
mcp__circuit-electron__keyboard_type({
  sessionId: "erfana-session-id",
  text: "# Hello World\n\nThis is a test.",
  delay: 50
})
```

### 7. `keyboard_press`
Press keyboard keys with modifiers.

**Parameters:**
- `sessionId` (string, required)
- `key` (string, required): Key name (e.g., "Enter", "Escape", "b")
- `modifiers` (array, optional): ["Control", "Shift", "Alt", "Meta"]

**Example:**
```typescript
// Press Cmd+S (save)
mcp__circuit-electron__keyboard_press({
  sessionId: "erfana-session-id",
  key: "s",
  modifiers: ["Meta"]
})

// Press Cmd+B (toggle sidebar)
mcp__circuit-electron__keyboard_press({
  sessionId: "erfana-session-id",
  key: "b",
  modifiers: ["Meta"]
})
```

### 8. `evaluate`
Execute JavaScript in the application context.

**Parameters:**
- `sessionId` (string, required)
- `expression` (string, required): JavaScript code to evaluate

**Returns:** Evaluation result

**Example:**
```typescript
// Get editor content
mcp__circuit-electron__evaluate({
  sessionId: "erfana-session-id",
  expression: "document.querySelector('.monaco-editor')?.innerText"
})

// Check if file is modified
mcp__circuit-electron__evaluate({
  sessionId: "erfana-session-id",
  expression: "document.querySelector('.modified-indicator') !== null"
})
```

### 9. `snapshot`
Get accessibility tree snapshot.

**Parameters:**
- `sessionId` (string, required)

**Returns:** Accessibility tree structure with roles, names, and element references

**Example:**
```typescript
mcp__circuit-electron__snapshot({
  sessionId: "erfana-session-id"
})
```

### 10. `get_windows`
List all application windows.

**Parameters:**
- `sessionId` (string, required)

**Returns:** Array of window objects with IDs and types

**Example:**
```typescript
mcp__circuit-electron__get_windows({
  sessionId: "erfana-session-id"
})
```

### 11. `wait_for_selector`
Wait for an element to appear.

**Parameters:**
- `sessionId` (string, required)
- `selector` (string, required)
- `timeout` (number, optional): Milliseconds (default: 30000)

**Example:**
```typescript
mcp__circuit-electron__wait_for_selector({
  sessionId: "erfana-session-id",
  selector: ".markdown-editor-panel",
  timeout: 5000
})
```

### 12. `close`
Close the application session.

**Parameters:**
- `sessionId` (string, required)

**Example:**
```typescript
mcp__circuit-electron__close({
  sessionId: "erfana-session-id"
})
```

## Best Practices

### 1. Screenshot Optimization
- Use `compressScreenshots: true` for AI vision models
- Quality 60-80 balances size and detail
- Quality 80+ for detailed UI inspection
- Quality 40-60 for quick checks

### 2. Element Selection Strategy
**Priority order:**
1. **ARIA roles** - Most reliable (`role=button[name='Save']`)
2. **Text content** - Good for buttons/links (`text=Save`)
3. **CSS selectors** - When unique (`.save-btn`, `#project`)
4. **Data attributes** - If available (`[data-testid='save-button']`)

### 3. Session Management
- Store `sessionId` for reuse across multiple operations
- Always close sessions when done
- One session per test scenario

### 4. Wait Strategies
- Use `wait_for_selector` before interactions
- Wait for load state after navigation
- Allow time for animations/transitions

### 5. Verification
- Take screenshots before and after actions
- Use `evaluate` to check application state
- Verify via accessibility tree when possible

## Common Workflows

### Verify UI Loads Correctly

```typescript
// 1. Launch app
const session = mcp__circuit-electron__app_launch({
  app: "/Users/marcinobel/Projects/erfana/out/main/index.js",
  compressScreenshots: true
})

// 2. Wait for main UI
mcp__circuit-electron__wait_for_selector({
  sessionId: session.sessionId,
  selector: ".app-dock-layout"
})

// 3. Take screenshot
mcp__circuit-electron__screenshot({
  sessionId: session.sessionId
})

// 4. Verify panels exist
const hasProject = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: "document.querySelector('[title=\"Project\"]') !== null"
})

// 5. Close
mcp__circuit-electron__close({ sessionId: session.sessionId })
```

### Test File Operations

```typescript
// 1. Launch and screenshot initial state
const session = mcp__circuit-electron__app_launch({ ... })
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 2. Click on file tree item
mcp__circuit-electron__click({
  sessionId: session.sessionId,
  selector: "text=README.md"
})

// 3. Wait for editor
mcp__circuit-electron__wait_for_selector({
  sessionId: session.sessionId,
  selector: ".monaco-editor"
})

// 4. Screenshot editor opened
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 5. Verify content loaded
const content = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: "document.querySelector('.monaco-editor').innerText.length > 0"
})
```

### Test Keyboard Shortcuts

```typescript
const session = mcp__circuit-electron__app_launch({ ... })

// Test Cmd+B (toggle sidebar)
mcp__circuit-electron__keyboard_press({
  sessionId: session.sessionId,
  key: "b",
  modifiers: ["Meta"]
})

// Screenshot after toggle
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// Verify sidebar hidden
const sidebarVisible = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: "document.querySelector('#project')?.parentElement.style.display !== 'none'"
})
```

## Troubleshooting

### App Won't Launch
- Verify app path is correct
- Check if app is already running
- Try building first: `npm run build`
- Check Console for error messages

### Can't Find Elements
- Take screenshot to verify UI state
- Use `snapshot` to see accessibility tree
- Check selector syntax (CSS vs text vs role)
- Wait for elements with `wait_for_selector`

### Screenshots Are Blank
- Wait for UI to fully load
- Check if correct window is focused
- Verify `windowId` parameter if multiple windows

### Session Lost
- Sessions end when app closes
- Store `sessionId` in variables
- Create new session if needed

## Keyboard Shortcuts Reference

For testing Erfana's keyboard shortcuts:

```typescript
// Cmd/Ctrl+B - Toggle Project panel
keyboard_press({ key: "b", modifiers: ["Meta"] })

// Cmd/Ctrl+J - Toggle Terminal panel
keyboard_press({ key: "j", modifiers: ["Meta"] })

// Cmd/Ctrl+Alt+B - Toggle Git panel
keyboard_press({ key: "b", modifiers: ["Meta", "Alt"] })

// Cmd/Ctrl+S - Save file
keyboard_press({ key: "s", modifiers: ["Meta"] })

// Cmd/Ctrl+W - Close tab
keyboard_press({ key: "w", modifiers: ["Meta"] })
```

## Integration with Development Workflow

### During Feature Development
1. Write code changes
2. Build app: `npm run build`
3. Launch via Circuit Electron
4. Visually verify changes
5. Test interactions
6. Screenshot results

### For Bug Investigation
1. Describe bug behavior to Claude Code
2. Claude launches app
3. Reproduces steps
4. Takes screenshots at each step
5. Inspects state via `evaluate`
6. Identifies issue

### For Regression Testing
1. Define test scenarios (see test-scenarios.md)
2. Run through each scenario
3. Compare screenshots against expected
4. Verify functionality via assertions

## Security Note

Circuit Electron MCP runs in your local environment with access to:
- File system operations
- Application control
- Screenshot capture
- JavaScript execution

Sessions are isolated and require explicit `sessionId` for all operations.

## See Also

- [Test Scenarios Library](./test-scenarios.md) - Pre-defined test cases
- [Quick Start Guide](./claude-code-testing-quickstart.md) - Fast setup
- [Development Tasks](./development-tasks.md) - Common workflows
- [Circuit Electron MCP Documentation](https://github.com/snowfort-ai/circuit-mcp)
