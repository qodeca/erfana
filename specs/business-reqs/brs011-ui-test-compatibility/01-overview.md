# Overview

## Summary

Enable automated UI testing for Erfana by systematically adding `data-testid` attributes to all interactive elements across 88 React components, establishing selector conventions, and documenting testing patterns for Playwright - the recommended E2E testing tool for Electron applications.

## Purpose

Currently, Erfana has 5306 unit tests providing excellent code coverage, but lacks infrastructure for automated end-to-end UI testing. This creates several challenges:

1. **Regression risk**: UI changes cannot be automatically verified against user workflows
2. **Manual testing burden**: QA relies on manual verification of visual and interactive behavior
3. **Claude Code integration gap**: Automated testing agents cannot reliably interact with UI elements due to missing stable selectors
4. **Refactoring friction**: Developers hesitate to refactor UI code without E2E safety net

By adding systematic `data-testid` attributes and documenting testing patterns, Erfana becomes compatible with modern E2E testing tools, enabling both human testers and AI agents (like Claude Code) to write and maintain automated UI tests.

## Scope

### In scope

- **Selector infrastructure**: Add `data-testid` to ALL interactive elements (buttons, inputs, links, menus, tree nodes, tabs)
- **Naming conventions**: Establish consistent testid naming patterns (kebab-case, hierarchical)
- **Documentation**: Create Claude Code-readable testing guide with selector catalog
- **Tool recommendation**: Document Playwright as primary E2E tool with Electron configuration
- **Special handling**: Document patterns for Monaco Editor, xterm.js, Mermaid diagrams
- **Test utilities**: Create helper functions for common test patterns (waiting, assertions)

### Out of scope

- CI/CD pipeline integration (future work)
- Writing comprehensive E2E test suites (this BRS enables testing, not implements tests)
- Performance/load testing infrastructure
- Visual regression testing setup
- Cross-browser testing (Electron is Chromium-only)

## Success criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| Interactive element coverage | 100% | All buttons, inputs, links, menus have testid |
| Naming consistency | 100% | All testids follow documented convention |
| Documentation completeness | Complete | Selector catalog covers all components |
| Playwright compatibility | Verified | Sample test demonstrates working setup |
| Claude Code usability | Validated | AI can write tests using documentation |

## Target audience

- **Developers**: Need testids for E2E test development
- **QA engineers**: Need reliable selectors for automation
- **Claude Code**: Needs documented patterns for AI-assisted test writing
- **Future maintainers**: Need consistent conventions to extend

## Key constraints

1. **No visual changes**: Adding testids must not affect UI appearance
2. **Performance neutral**: Testid attributes have zero runtime overhead
3. **Backward compatible**: Existing unit tests must continue passing
4. **Third-party components**: Monaco, xterm, Mermaid require wrapper-based testids
