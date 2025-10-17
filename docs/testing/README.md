# Erfana Testing Documentation

Complete guide for testing Erfana. This covers both automated tests (Vitest/Playwright) and visual/manual testing using Circuit Electron MCP.

## 📚 Documentation Index

### Automated Tests (Unit/Integration)
- Runner: Vitest workspace (`main`, `preload`, `renderer`)
- Commands:
  - `npm run test` — run all projects once
  - `npm run test:renderer` — renderer tests
  - `npm run test:main` — main process tests
  - `npm run test:preload` — preload tests

See [Automated Testing Plan](./automated-testing-plan.md) for the phased rollout and setup details.

---

### E2E/UI (Playwright Electron)
- Use `@playwright/test` to launch Electron and assert UI flows.
- Suggested: add smoke spec + critical flows (project open/change, file open/save).
- Configure trace/screenshots on failure for debugging.

### Coverage
- Generate per-project coverage reports: `npm run test:cov`
- Reports written under `coverage/<project>/` (lcov + HTML)
- Build outputs (`out/`) are excluded from coverage to keep signal clean
- Initial thresholds are low (10%) to avoid blocking early adoption

---

### Visual/MCP Test Scenarios

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
1. Unit tests: `npm run test:ci`
2. Run relevant scenarios from [ui-scenarios.md](./ui-scenarios.md) or [interaction-scenarios.md](./interaction-scenarios.md)
3. Optionally: build `npm run build` for full-package checks

### Comprehensive Testing
1. Run unit/integration tests (Vitest)
2. Run all scenarios in [ui-scenarios.md](./ui-scenarios.md)
3. Run all scenarios in [interaction-scenarios.md](./interaction-scenarios.md)

### Learning Circuit Electron MCP
1. Start with simple flows from [ui-scenarios.md](./ui-scenarios.md)
2. Practice interaction flows from [interaction-scenarios.md](./interaction-scenarios.md)
3. Use screenshots to debug visually

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

For unit/integration:
1. Install dev deps: `npm i -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom`
2. Run tests: `npm run test`

For MCP visual testing:
1. Build: `npm run build`
2. Circuit Electron MCP configured in `.mcp.json`

---

## 🔗 See Also

- [Development Tasks](../development-tasks.md) - Common development patterns
- [Architecture](../architecture.md) - Application structure
- [UI Components](../ui-components.md) - UI system details

---

## 💡 Examples
- Unit: see renderer tests under `src/renderer/src/**/*.test.tsx`
- Visual/MCP: follow flows in [ui-scenarios.md](./ui-scenarios.md) and [interaction-scenarios.md](./interaction-scenarios.md)
