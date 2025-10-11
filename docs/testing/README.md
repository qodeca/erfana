# Erfana Testing Documentation

Complete guide for visually inspecting and testing Erfana using Circuit Electron MCP.

## 📚 Documentation Index

### Quick Start
**[quickstart.md](./quickstart.md)** - Get started in 1 minute
- Fast testing patterns
- Common commands cheat sheet
- Copy-paste templates
- Troubleshooting tips

**Perfect for:** First-time testing or quick verification after code changes.

---

### Complete Reference
**[circuit-electron-guide.md](./circuit-electron-guide.md)** - Comprehensive MCP tool reference
- All available Circuit Electron MCP tools
- Parameters and return values
- Best practices for element selection
- Common workflows and examples
- Integration with development process

**Perfect for:** Understanding all testing capabilities and advanced usage.

---

### Test Scenarios

#### UI Verification Tests
**[ui-scenarios.md](./ui-scenarios.md)** - Test scenarios 1-5
- Application launch & UI verification
- File tree navigation
- Markdown formatting toolbar
- View mode switching
- Auto-save functionality

**Perfect for:** Verifying UI loads correctly and visual elements work.

#### Interaction Tests
**[interaction-scenarios.md](./interaction-scenarios.md)** - Test scenarios 6-10
- Keyboard shortcuts
- Context menu operations
- Multi-file tabs
- Document statistics
- Panel protection

**Perfect for:** Testing user interactions and application behavior.

---

## 🚀 Recommended Workflows

### After Making Code Changes
1. Build: `npm run build`
2. Use [quickstart.md](./quickstart.md) for rapid verification
3. Run relevant scenarios from [ui-scenarios.md](./ui-scenarios.md) or [interaction-scenarios.md](./interaction-scenarios.md)

### Comprehensive Testing
1. Review [circuit-electron-guide.md](./circuit-electron-guide.md)
2. Run all scenarios in [ui-scenarios.md](./ui-scenarios.md)
3. Run all scenarios in [interaction-scenarios.md](./interaction-scenarios.md)

### Learning Circuit Electron MCP
1. Start with [quickstart.md](./quickstart.md)
2. Study [circuit-electron-guide.md](./circuit-electron-guide.md)
3. Practice with simple scenarios from [ui-scenarios.md](./ui-scenarios.md)

---

## 🎯 Testing Capabilities

Circuit Electron MCP enables Claude Code to:
- ✅ Launch Erfana and capture screenshots
- ✅ Interact with UI (click, type, keyboard shortcuts)
- ✅ Verify functionality visually and programmatically
- ✅ Test after code changes without manual inspection
- ✅ Run automated test scenarios
- ✅ Debug issues with visual feedback

---

## 📋 Prerequisites

Before testing:
1. Build the application: `npm run build`
2. Verify build output exists: `ls -la out/main/index.js`
3. Circuit Electron MCP configured in `.mcp.json`

---

## 🔗 See Also

- [Development Tasks](../development-tasks.md) - Common development patterns
- [Architecture](../architecture.md) - Application structure
- [UI Components](../ui-components.md) - UI system details

---

## 💡 Quick Example

```typescript
// Launch Erfana and take a screenshot
const session = mcp__circuit-electron__app_launch({
  app: "/Users/marcinobel/Projects/erfana",
  mode: "development",
  compressScreenshots: true
})

mcp__circuit-electron__screenshot({ sessionId: session.sessionId })
mcp__circuit-electron__close({ sessionId: session.sessionId })
```

For more examples, see [quickstart.md](./quickstart.md).
