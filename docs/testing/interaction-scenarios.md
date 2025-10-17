# Erfana Interaction Test Scenarios

Pre-defined test scenarios for validating Erfana user interaction functionality using Circuit Electron MCP. These scenarios focus on user interactions, keyboard shortcuts, and application behavior.

## Prerequisites

Before running scenarios:
1. Build the application: `npm run build`
2. Verify build output exists: `ls -la out/main/index.js`
3. Ensure Circuit Electron MCP is configured

## Scenario Template

Each scenario includes:
- **Goal**: What we're testing
- **Steps**: MCP commands to execute
- **Expected Results**: What should happen
- **Verification**: How to validate success
- **Screenshots**: When to capture

---

## Scenario 6: Keyboard Shortcuts

**Goal:** Test all global keyboard shortcuts work correctly.

**Steps:**

```typescript
// 1. Launch app
const session = mcp__circuit-electron__app_launch({ ... })
mcp__circuit-electron__wait_for_selector({ sessionId: session.sessionId, selector: ".app-dock-layout" })
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 2. Test Cmd+B (Toggle left sidebar)
mcp__circuit-electron__keyboard_press({
  sessionId: session.sessionId,
  key: "b",
  modifiers: ["Meta"]
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

const leftSidebarHidden = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `!document.querySelector('[title="Project"]')?.parentElement.offsetParent`
})

// 3. Press Cmd+B again to restore
mcp__circuit-electron__keyboard_press({
  sessionId: session.sessionId,
  key: "b",
  modifiers: ["Meta"]
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 4. Test Cmd+J (Toggle bottom panel)
mcp__circuit-electron__keyboard_press({
  sessionId: session.sessionId,
  key: "j",
  modifiers: ["Meta"]
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

const bottomPanelHidden = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `!document.querySelector('[title="Terminal"]')?.parentElement.offsetParent`
})

// 5. Test Cmd+Alt+B (Toggle right sidebar)
mcp__circuit-electron__keyboard_press({
  sessionId: session.sessionId,
  key: "b",
  modifiers: ["Meta", "Alt"]
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

const rightSidebarHidden = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `!document.querySelector('[title="Git"]')?.parentElement.offsetParent`
})

// 6. Open a file and test Cmd+S (Save)
mcp__circuit-electron__click_by_text({ sessionId: session.sessionId, text: "README.md" })
mcp__circuit-electron__wait_for_selector({ sessionId: session.sessionId, selector: ".monaco-editor" })
mcp__circuit-electron__keyboard_type({ sessionId: session.sessionId, text: "test" })
mcp__circuit-electron__keyboard_press({
  sessionId: session.sessionId,
  key: "s",
  modifiers: ["Meta"]
})

// Wait and verify save happened
await new Promise(resolve => setTimeout(resolve, 500))
const saveWorked = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `document.querySelector('.modified-indicator') === null`
})

mcp__circuit-electron__close({ sessionId: session.sessionId })
```

**Expected Results:**
- Cmd+B toggles Project panel visibility
- Cmd+J toggles Terminal panel visibility
— Cmd/Ctrl+J toggles Terminal panel visibility
- Cmd+S saves file and clears modified indicator
- Panel sizes are preserved when toggled

**Verification:**
- `leftSidebarHidden === true` after first Cmd+B
- `bottomPanelHidden === true` after Cmd+J
- `rightSidebarHidden === true` after Cmd+Alt+B
- `saveWorked === true` after Cmd+S

---

## Scenario 7: File Context Menu Operations

**Goal:** Test right-click context menu in project tree.

**Steps:**

```typescript
// 1. Launch app
const session = mcp__circuit-electron__app_launch({ ... })
mcp__circuit-electron__wait_for_selector({ sessionId: session.sessionId, selector: ".project-tree" })

// 2. Right-click on a folder
mcp__circuit-electron__click({
  sessionId: session.sessionId,
  selector: ".project-tree-node[data-type='directory']",
  button: "right"  // Right-click
})

// 3. Wait for context menu
mcp__circuit-electron__wait_for_selector({
  sessionId: session.sessionId,
  selector: ".context-menu",
  timeout: 2000
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 4. Verify menu items
const menuItems = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `Array.from(document.querySelectorAll('.context-menu-item')).map(el => el.textContent)`
})

// 5. Click "New File"
mcp__circuit-electron__click_by_text({
  sessionId: session.sessionId,
  text: "New File"
})

// 6. Wait for dialog
mcp__circuit-electron__wait_for_selector({
  sessionId: session.sessionId,
  selector: "input[type='text']",
  timeout: 2000
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 7. Cancel dialog
mcp__circuit-electron__keyboard_press({
  sessionId: session.sessionId,
  key: "Escape"
})

mcp__circuit-electron__close({ sessionId: session.sessionId })
```

**Expected Results:**
- Right-click opens context menu
- Menu shows: New File, New Folder, Rename, Delete
- Clicking item triggers action
- Dialog appears for name input
- Escape cancels dialog

**Verification:**
- Context menu appears within 2 seconds
- `menuItems` includes ["New File", "New Folder", "Rename", "Delete"]
- Dialog input field is visible

---

## Scenario 8: Multi-File Tabs

**Goal:** Test opening multiple files in separate tabs.

**Steps:**

```typescript
// 1. Launch app
const session = mcp__circuit-electron__app_launch({ ... })

// 2. Open first file
mcp__circuit-electron__click_by_text({ sessionId: session.sessionId, text: "README.md" })
mcp__circuit-electron__wait_for_selector({ sessionId: session.sessionId, selector: ".markdown-editor-panel" })
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 3. Check tab count
const oneTab = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `document.querySelectorAll('.dv-default-tab').length`
})

// 4. Open second file
mcp__circuit-electron__click_by_text({ sessionId: session.sessionId, text: "CLAUDE.md" })
mcp__circuit-electron__wait_for_selector({ sessionId: session.sessionId, selector: ".markdown-editor-panel" })
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 5. Check tab count increased
const twoTabs = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `document.querySelectorAll('.dv-default-tab').length`
})

// 6. Verify active tab
const activeTab = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `document.querySelector('[data-active="true"] .dv-default-tab-content')?.textContent`
})

// 7. Click first tab to switch
mcp__circuit-electron__click_by_text({
  sessionId: session.sessionId,
  text: "README.md"
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 8. Verify tab switch
const newActiveTab = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `document.querySelector('[data-active="true"] .dv-default-tab-content')?.textContent`
})

mcp__circuit-electron__close({ sessionId: session.sessionId })
```

**Expected Results:**
- Each file opens in separate tab
- Tab shows filename
- Active tab is highlighted
- Clicking tab switches content
- Each tab maintains independent state

**Verification:**
- `oneTab >= 1`
- `twoTabs > oneTab`
- `activeTab === "CLAUDE.md"`
- `newActiveTab === "README.md"`

---

## Scenario 9: Document Statistics Display

**Goal:** Verify document statistics are calculated and displayed correctly.

**Steps:**

```typescript
// 1. Launch and open file
const session = mcp__circuit-electron__app_launch({ ... })
mcp__circuit-electron__click_by_text({ sessionId: session.sessionId, text: "README.md" })
mcp__circuit-electron__wait_for_selector({ sessionId: session.sessionId, selector: ".document-stats" })

// 2. Get statistics display
const stats = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `({
    words: document.querySelector('.stat-item:has(.stat-label:contains("Words")) .stat-value')?.textContent,
    characters: document.querySelector('.stat-item:has(.stat-label:contains("Characters")) .stat-value')?.textContent,
    lines: document.querySelector('.stat-item:has(.stat-label:contains("Lines")) .stat-value')?.textContent,
    readingTime: document.querySelector('.stat-item:has(.stat-label:contains("Reading time")) .stat-value')?.textContent
  })`
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 3. Make an edit to change stats
mcp__circuit-electron__click({ sessionId: session.sessionId, selector: ".monaco-editor" })
mcp__circuit-electron__keyboard_type({
  sessionId: session.sessionId,
  text: "\n\nThis is a test sentence with exactly ten words here."
})

// 4. Get updated statistics
await new Promise(resolve => setTimeout(resolve, 500))
const updatedStats = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `({
    words: document.querySelector('.stat-item:has(.stat-label:contains("Words")) .stat-value')?.textContent,
    characters: document.querySelector('.stat-item:has(.stat-label:contains("Characters")) .stat-value')?.textContent
  })`
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

mcp__circuit-electron__close({ sessionId: session.sessionId })
```

**Expected Results:**
- Statistics bar visible at bottom
- Shows: words, characters, lines, reading time
- Statistics update in real-time as user types
- Numbers are formatted (e.g., "1,234")

**Verification:**
- All stat fields have numeric values
- Updated stats are different from initial stats
- Word count increases by approximately 10

---

## Scenario 10: Panel Protection (Cannot Close System Panels)

**Goal:** Verify that system panels (Project, Terminal, Git) cannot be closed via close button.

**Steps:**

```typescript
// 1. Launch app
const session = mcp__circuit-electron__app_launch({ ... })
mcp__circuit-electron__wait_for_selector({ sessionId: session.sessionId, selector: ".app-dock-layout" })

// 2. Try to find and click Project close button
const projectCloseAttempt = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `(() => {
    const projectTab = Array.from(document.querySelectorAll('.dv-default-tab')).find(
      tab => tab.querySelector('.dv-default-tab-content')?.textContent === 'Project'
    )
    const closeButton = projectTab?.querySelector('.dv-default-tab-action')
    if (closeButton) {
      closeButton.click()
      return { clicked: true, stillExists: true }
    }
    return { clicked: false }
  })()`
})

// 3. Verify Project still exists
await new Promise(resolve => setTimeout(resolve, 500))
const projectPanelExists = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `document.querySelector('[title="Project"]') !== null`
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 4. Try same for Terminal and Git
const terminalExists = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `document.querySelector('[title="Terminal"]') !== null`
})
const gitExists = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `document.querySelector('[title="Git"]') !== null`
})

mcp__circuit-electron__close({ sessionId: session.sessionId })
```

**Expected Results:**
- Close buttons on system panels are blocked
- Panels remain visible after close attempt
- No error messages appear
- User-created tabs can still be closed

**Verification:**
- `projectPanelExists === true` after close attempt
- `terminalExists === true`
- `gitExists === true`

---

## Running Interaction Scenarios

### Manual Execution
Copy scenario code and run each step sequentially, verifying results at each checkpoint.

### Batch Testing
Run multiple scenarios in sequence to perform regression testing.

### CI/CD Integration
Scenarios can be adapted for automated testing pipelines.

## Tips for Running Interaction Scenarios

1. **Always wait for elements** before interacting
2. **Take screenshots** before and after key actions
3. **Verify state changes** using `evaluate`
4. **Clean up sessions** with `close`
5. **Use meaningful variable names** for clarity
6. **Document expected results** clearly
7. **Include failure cases** when applicable

## See Also

- [UI Test Scenarios](./ui-scenarios.md) - UI verification tests
- See [Testing README](./README.md) for automated tests and visual testing tips
- [Testing Index](./README.md) - All testing documentation
