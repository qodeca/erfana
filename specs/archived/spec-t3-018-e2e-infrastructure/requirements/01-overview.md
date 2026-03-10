# Overview

## Summary

Erfana's E2E test suite uses Playwright with Electron and has grown organically into a 1,176-line helper module (`e2e/utils/helpers.ts`) containing functional helper namespaces (`monaco`, `terminal`, `mermaid`, `keyboard`) alongside standalone utility functions. While functional, this structure has scaling limitations:

1. **Flat helper namespaces** lack encapsulation – all helpers share the same module scope, making it hard to manage per-page state or compose helpers across test scenarios.
2. **`createTestProject()` is a plain function**, not a Playwright fixture – tests must manually manage lifecycle (creation, cleanup) and can't benefit from Playwright's automatic teardown.
3. **13 fixed `waitForTimeout()` calls** introduce non-deterministic waits (1000–1500ms each), slowing tests and causing flakiness on slower CI runners.

This spec defines three workstreams to address these issues.

## Purpose

Transform the E2E helper layer into a maintainable, deterministic, and composable infrastructure that:
- Enables new test authors to write reliable tests quickly via well-encapsulated page objects
- Eliminates time-based waits in favor of condition-based assertions
- Leverages Playwright's fixture system for automatic setup/teardown

## Scope

### In scope
- Migrating existing helper namespaces to Page Object Model (POM) classes
- Promoting `createTestProject()` and related setup functions to Playwright fixtures
- Replacing all `waitForTimeout()` calls with condition-based alternatives
- Creating new composite fixtures (`withSettings`, `withOpenFile`)

### Out of scope
- Adding new test scenarios (covered by individual feature specs)
- Changing the test ID strategy (see Spec #017)
- Visual regression testing setup (see Spec #019)
- Unit test infrastructure changes

## Related specs
- Spec #017 (Test ID coverage and accessibility selectors) – provides new selectors consumed by POM classes
- Spec #019 (Visual regression and CI resilience) – builds on the improved infrastructure
