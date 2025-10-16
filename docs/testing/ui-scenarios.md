# Erfana UI Test Scenarios

Pre-defined test scenarios for validating Erfana UI functionality using Circuit Electron MCP. These scenarios focus on UI verification and visual elements.

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

## Scenario 1: Application Launch & Initial UI Verification

**Goal:** Verify that Erfana launches successfully and displays all core UI panels.

**Steps:**

```typescript
// 1. Launch the application
const session = mcp__circuit-electron__app_launch({
  app: "/Users/marcinobel/Projects/erfana/out/main/index.js",
  compressScreenshots: true,
  screenshotQuality: 75
})

// 2. Wait for main layout to load
mcp__circuit-electron__wait_for_selector({
  sessionId: session.sessionId,
  selector: ".app-dock-layout",
  timeout: 5000
})

// 3. Take initial screenshot
mcp__circuit-electron__screenshot({
  sessionId: session.sessionId
})

// 4. Verify all panels exist
const verification = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `({
    hasProject: document.querySelector('[title="Project"]') !== null,
    hasTerminal: document.querySelector('[title="Terminal"]') !== null,
    hasGit: document.querySelector('[title="Git"]') !== null,
    hasToolbar: document.querySelector('.toolbar') !== null,
    hasDockview: document.querySelector('.dockview-theme-dark') !== null
  })`
})

// 5. Get accessibility snapshot
mcp__circuit-electron__snapshot({
  sessionId: session.sessionId
})

// 6. Clean up
mcp__circuit-electron__close({ sessionId: session.sessionId })
```

**Expected Results:**
- Application window opens
- Project panel visible on left
- Terminal panel visible at bottom
— Right sidebar shows Terminal or Copilot panel as selected
- Toolbar visible at top
- No error dialogs or blank screens

**Verification:**
- `verification.hasProject === true`
- `verification.hasTerminal === true`
- `verification.hasGit === true`
- `verification.hasToolbar === true`
- Screenshot shows complete UI

---

## Scenario 2: File Tree Navigation & File Opening

**Goal:** Test file tree interaction and markdown file opening.

**Steps:**

```typescript
// 1. Launch app
const session = mcp__circuit-electron__app_launch({
  app: "/Users/marcinobel/Projects/erfana/out/main/index.js",
  compressScreenshots: true
})

// 2. Wait for project tree to load
mcp__circuit-electron__wait_for_selector({
  sessionId: session.sessionId,
  selector: ".project-tree",
  timeout: 5000
})

// 3. Screenshot before action
mcp__circuit-electron__screenshot({
  sessionId: session.sessionId
})

// 4. Click on README.md (or any .md file in tree)
mcp__circuit-electron__click_by_text({
  sessionId: session.sessionId,
  text: "README.md"
})

// 5. Wait for editor to open
mcp__circuit-electron__wait_for_selector({
  sessionId: session.sessionId,
  selector: ".markdown-editor-panel",
  timeout: 3000
})

// 6. Screenshot with editor open
mcp__circuit-electron__screenshot({
  sessionId: session.sessionId
})

// 7. Verify editor loaded
const editorState = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `({
    editorExists: document.querySelector('.monaco-editor') !== null,
    previewExists: document.querySelector('.preview-pane') !== null,
    hasContent: document.querySelector('.monaco-editor')?.innerText.length > 0,
    editorVisible: window.getComputedStyle(document.querySelector('.monaco-editor')).display !== 'none'
  })`
})

mcp__circuit-electron__close({ sessionId: session.sessionId })
```

**Expected Results:**
- Project tree displays project files
- Clicking README.md opens editor panel
- Monaco editor loads with content
- Preview pane displays rendered markdown
- Split view is active

**Verification:**
- `editorState.editorExists === true`
- `editorState.previewExists === true`
- `editorState.hasContent === true`
- Screenshot shows both editor and preview

---

## Scenario 3: Markdown Formatting Toolbar

**Goal:** Test all markdown formatting toolbar buttons.

**Steps:**

```typescript
// 1. Launch and open a file
const session = mcp__circuit-electron__app_launch({ ... })
mcp__circuit-electron__click_by_text({ sessionId: session.sessionId, text: "README.md" })
mcp__circuit-electron__wait_for_selector({ sessionId: session.sessionId, selector: ".monaco-editor" })

// 2. Click in editor to focus
mcp__circuit-electron__click({
  sessionId: session.sessionId,
  selector: ".monaco-editor"
})

// 3. Select some text (Cmd+A to select all)
mcp__circuit-electron__keyboard_press({
  sessionId: session.sessionId,
  key: "a",
  modifiers: ["Meta"]
})

// 4. Screenshot before formatting
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 5. Test Bold button
mcp__circuit-electron__click({
  sessionId: session.sessionId,
  selector: "button[title*='Bold']"
})

// 6. Screenshot after bold
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 7. Verify bold formatting applied
const hasBold = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: "document.querySelector('.monaco-editor').innerText.includes('**')"
})

// 8. Test other formatting buttons
const buttons = ["Italic", "Code", "Link", "Heading 1", "Bullet List"]
for (const button of buttons) {
  mcp__circuit-electron__click({
    sessionId: session.sessionId,
    selector: `button[title*='${button}']`
  })
  mcp__circuit-electron__screenshot({ sessionId: session.sessionId })
}

mcp__circuit-electron__close({ sessionId: session.sessionId })
```

**Expected Results:**
- Toolbar buttons are visible and clickable
- Bold button wraps text in `**bold**`
- Italic button wraps text in `*italic*`
- Code button wraps text in backticks
- Heading buttons add `#` prefix
- List buttons add `-` or `1.` prefix

**Verification:**
- Formatting syntax appears in editor
- Preview pane shows formatted result
- Modified indicator (●) appears in tab

---

## Scenario 4: View Mode Switching

**Goal:** Test editor view mode toggle buttons (editor/split/preview).

**Steps:**

```typescript
// 1. Launch and open file
const session = mcp__circuit-electron__app_launch({ ... })
mcp__circuit-electron__click_by_text({ sessionId: session.sessionId, text: "README.md" })
mcp__circuit-electron__wait_for_selector({ sessionId: session.sessionId, selector: ".editor-content" })

// 2. Initial state (split view)
const initialState = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `({
    editorVisible: document.querySelector('.editor-pane') !== null,
    previewVisible: document.querySelector('.preview-pane') !== null
  })`
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 3. Click "Editor Only" button
mcp__circuit-electron__click({
  sessionId: session.sessionId,
  selector: "button[title='Editor Only']"
})

// 4. Verify editor-only mode
const editorOnlyState = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `({
    editorVisible: document.querySelector('.editor-pane') !== null,
    previewVisible: document.querySelector('.preview-pane') === null,
    viewMode: document.querySelector('.editor-content').classList.contains('view-mode-editor')
  })`
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 5. Click "Preview Only" button
mcp__circuit-electron__click({
  sessionId: session.sessionId,
  selector: "button[title='Preview Only']"
})

// 6. Verify preview-only mode
const previewOnlyState = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `({
    editorVisible: document.querySelector('.editor-pane') === null,
    previewVisible: document.querySelector('.preview-pane') !== null,
    viewMode: document.querySelector('.editor-content').classList.contains('view-mode-preview')
  })`
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 7. Click "Split View" button to restore
mcp__circuit-electron__click({
  sessionId: session.sessionId,
  selector: "button[title='Split View']"
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

mcp__circuit-electron__close({ sessionId: session.sessionId })
```

**Expected Results:**
- Split view shows both editor and preview
- Editor only hides preview pane
- Preview only hides editor pane
- Active button has visual highlight
- Transitions are smooth

**Verification:**
- `initialState`: both visible
- `editorOnlyState.viewMode === true`, preview hidden
- `previewOnlyState.viewMode === true`, editor hidden
- Final state restores split view

---

## Scenario 5: Auto-Save Functionality

**Goal:** Verify auto-save indicator appears and file saves automatically.

**Steps:**

```typescript
// 1. Launch and open file
const session = mcp__circuit-electron__app_launch({ ... })
mcp__circuit-electron__click_by_text({ sessionId: session.sessionId, text: "test.md" })
mcp__circuit-electron__wait_for_selector({ sessionId: session.sessionId, selector: ".monaco-editor" })

// 2. Check initial state (no modifications)
const initialState = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `({
    hasModifiedIndicator: document.querySelector('.modified-indicator') !== null,
    tabTitle: document.querySelector('[data-active="true"] .dv-default-tab-content')?.textContent
  })`
})

// 3. Make an edit
mcp__circuit-electron__click({ sessionId: session.sessionId, selector: ".monaco-editor" })
mcp__circuit-electron__keyboard_type({
  sessionId: session.sessionId,
  text: "\n\n## New Section\n\nThis is a test edit.",
  delay: 30
})

// 4. Screenshot immediately after edit
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 5. Check modified state
const modifiedState = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `({
    hasModifiedIndicator: document.querySelector('.modified-indicator') !== null,
    tabTitle: document.querySelector('[data-active="true"] .dv-default-tab-content')?.textContent
  })`
})

// 6. Wait for auto-save (2 second debounce)
await new Promise(resolve => setTimeout(resolve, 2500))

// 7. Check for auto-save indicator
const autoSavingState = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `({
    isAutoSaving: document.querySelector('.auto-save-indicator')?.textContent.includes('Auto-saving'),
    hasModifiedIndicator: document.querySelector('.modified-indicator') !== null
  })`
})
mcp__circuit-electron__screenshot({ sessionId: session.sessionId })

// 8. Wait for save to complete
await new Promise(resolve => setTimeout(resolve, 1500))

// 9. Verify saved state
const savedState = mcp__circuit-electron__evaluate({
  sessionId: session.sessionId,
  expression: `({
    hasModifiedIndicator: document.querySelector('.modified-indicator') !== null,
    tabTitle: document.querySelector('[data-active="true"] .dv-default-tab-content')?.textContent
  })`
})

mcp__circuit-electron__close({ sessionId: session.sessionId })
```

**Expected Results:**
- Before edit: no modified indicator, clean tab title
- After edit: modified indicator (●) appears, tab shows "● filename"
- Auto-save triggers after 2 seconds
- Auto-save indicator appears briefly
- Modified indicator disappears after save

**Verification:**
- `initialState.hasModifiedIndicator === false`
- `modifiedState.hasModifiedIndicator === true`
- `modifiedState.tabTitle.startsWith('●')`
- `savedState.hasModifiedIndicator === false`

---

## Tips for Running UI Scenarios

1. **Always wait for elements** before interacting
2. **Take screenshots** before and after key actions
3. **Verify state changes** using `evaluate`
4. **Clean up sessions** with `close`
5. **Document expected results** clearly

## See Also

- [Interaction Test Scenarios](./interaction-scenarios.md) - User interaction tests
- [Circuit Electron Guide](./circuit-electron-guide.md) - Complete tool reference
- [Quick Start](./quickstart.md) - Fast testing patterns
- [Testing Index](./README.md) - All testing documentation
