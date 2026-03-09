# Acceptance criteria

## POM migration

**018-AC-001: POM class instantiation**
Given an E2E test using the `terminalPage` fixture, when the test destructures `{ terminalPage }` from the fixture, then `terminalPage` is an instance of `TerminalPage` with all methods available (`open()`, `sendCommand()`, `waitForOutput()`, etc.).

**018-AC-002: Backward compatibility**
Given existing E2E tests importing from `e2e/utils/helpers.ts`, when running `npm run test:e2e` without modifying any test file, then all tests pass with the same results as before migration.

**018-AC-003: POM file structure**
Given the `e2e/pages/` directory, when listing its contents, then the following files exist: `terminal.page.ts`, `monaco.page.ts`, `mermaid.page.ts`, `project-tree.page.ts`, `keyboard.helper.ts`, `index.ts`.

## Fixture promotion

**018-AC-004: testProject fixture lifecycle**
Given a test using the `testProject` fixture, when the test accesses `testProject.path`, then a temporary directory exists containing seed files (`test.md` at minimum). When the worker completes, the temporary directory is deleted.

**018-AC-005: withSettings fixture**
Given a test using `withSettings({ editor: { wordWrap: 'on' } })`, when the test opens the settings overlay, then word wrap is shown as enabled. When the test completes, the original settings file is restored.

**018-AC-006: withOpenFile fixture**
Given a test using `withOpenFile('test.md')`, when the test begins, then the Monaco editor is ready with `test.md` content loaded and the editor textarea is focused.

## Condition-based waits

**018-AC-007: Shell prompt detection**
Given a test that opens the terminal, when `terminalPage.waitForPrompt()` is called, then the method resolves only after a prompt character (`$`, `%`, `#`, or `>`) appears in the terminal output. The method must not use any fixed `setTimeout` or `waitForTimeout` internally.

**018-AC-008: No residual fixed waits**
Given the full E2E codebase after migration, when searching for `waitForTimeout` in assertion paths, then zero occurrences are found. Any remaining `waitForTimeout` calls are in setup-only paths and annotated with `// KNOWN_WAIT:` comments explaining the necessity.

## Definition of done

- [ ] All POM classes implemented in `e2e/pages/`
- [ ] All existing E2E tests pass without modification
- [ ] `testProject`, `withSettings`, `withOpenFile` fixtures implemented
- [ ] All `waitForTimeout()` in assertion paths replaced with condition-based waits
- [ ] `e2e/utils/helpers.ts` re-exports POM classes for backward compatibility
- [ ] E2E helper documentation (`docs/testing/e2e-helpers.md`) updated to reflect POM pattern
