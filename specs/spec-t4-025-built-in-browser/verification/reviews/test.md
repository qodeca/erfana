# Test review – spec 025

Reviewer: `erfana:test-reviewer` (independent agent, not an author), 2026-11-04, against `873a9e4a`.

Score: 8/10
Counts: critical 0, high 0, medium 2, low 3

The reviewer did not run tests and did not see the trace script output; it read the sources only (e2e suite for `waitForTimeout`, unreasoned skips and `test.fail()`, the OS focus lock and its tests, the trace script, the coverage floors, a sample of unit tests).

## Findings

### [medium] Several security-relevant files have low per-file coverage floors
- `vitest.main.config.ts:163`: `'src/main/services/browser/local/localConfinedFile.ts': { lines: 98, functions: 73, branches: 87, statements: 91 }`
- `vitest.main.config.ts:189`: `'src/main/services/browser/page/plainProfileFile.ts': { lines: 88, functions: 73, branches: 73, statements: 86 }`
- Why it matters: `localConfinedFile.ts` is the real-path confinement for the loopback file server. A confinement branch could stop being tested with no floor failing. The same applies to `plainProfileFile.ts`.
- Fix: add unit tests for the uncovered functions and branches, then raise the floors; check each uncovered branch is not a deny path.

### [medium] The `test.fail()` in `browser-pick-frames.e2e.ts` does not name the owner-queue item
- `e2e/browser-pick-frames.e2e.ts:307`: a bare `test.fail()` with an explanatory comment above it.
- Why it matters: the gap is recorded (owner item 24, 025-AC-035), but nothing at the call links to it.
- Fix: `test.fail(true, 'Owner queue item 24 (025-AC-035): ...')`, as `e2e/browser-tab-navigation.e2e.ts:247` already does.

### [low] Two assertions in the focus-lock tests can pass whatever the code does
- `e2e/os-focus-lock.e2e.ts:59`: `expect(exclusive.settled()).toBe(false)` right after `a.release()` runs synchronously, so it proves nothing; line 56 is the real check.
- `e2e/os-focus-lock.e2e.ts:77`: a writer-priority bug would hang `await exclusive.promise` until the test timeout, with no clear message.
- Fix: delete line 59 or wait one poll interval before asserting; add a timeout message to the line 77 await.

### [low] Dead-holder cleanup is only tested with an `exclusive` entry
- `e2e/os-focus-lock.e2e.ts:84`: a dead `shared.` or `waiting.` entry and an ownerless old mutex (`osFocusLock.ts:136`) are not tested.
- Fix: add one test for a dead `waiting.` entry and one for an ownerless old mutex, aged with `fs.utimesSync`.

### [low] The exit hook that releases the lock is untested
- `osFocusLock.ts:172` (`process.on('exit', ...)`) is not exercised. `os-focus-lock.e2e.ts` launches no app but is classed as the e2e lane (cosmetic).
- Fix: optional child-process test that exits mid-lease.

## What is strong
- No `waitForTimeout` in the browser e2e files; the lock's poll delay carries a `KNOWN_WAIT` justification (`osFocusLock.ts:101`).
- Every `test.skip` in the browser e2e files has a reason; no `.only`/`.skip` in the BrowserPanel renderer tests.
- The focus lock: mutex directory with stale-owner recovery, dead holders cleaned by PID, exit hook, writer priority, bounded wait whose error names the holders, its own fixture timeout (`fixtures/index.ts:300`).
- The lock tests check behaviour, not internals, each in a private directory.
- `focusAppWindow` fails naming the host problem, so a focus failure is not reported as a product bug.
- Trace rules are strict (`scripts/check-spec025-trace.mjs`): title must start with the AC ID; skip/todo/fixme do not count; manual rows must point at files that exist.
- The AC-024 worker gap is handled honestly (`test.fail(true, reason)` with full assertions kept).
- Dense per-file coverage floors, most at 98, with traceable `measured ...` comments.
- Unit tests assert outcomes (e.g. `BrowserTabInput.test.ts:115`).

## Owner-pending items seen (not scored)
- 025-AC-024 worker `Sec-CH-UA` (item 21), `e2e/browser-tab-navigation.e2e.ts:247`.
- 025-AC-035 "covered by" (item 24), `e2e/browser-pick-frames.e2e.ts:307`.

## Score rationale
No critical or high finding, which matches anchor 8: the medium findings are few, local and have a clear fix. Not a 9 because two security-adjacent files have weak floors, one `test.fail()` is not tied to its owner item, and the lock tests have gaps in dead-holder cases and one trivially true assertion.

## Fix record
Filled in by the lead after the review; see the end of `../aaa-review.md`.
