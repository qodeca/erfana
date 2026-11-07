# Test review – spec 025

Reviewer: `erfana:test-reviewer` (independent agent, not an author), 2026-11-04, against `8fd4ed87` (round 2).

Score: 8/10
Counts: critical 0, high 0, medium 1, low 3

I read the sources only. I did not run tests or the trace script, and I did not see the "27 of 83 uncovered" output or the `test:cov` exit code. I took them from the brief.

## Findings

### [medium] The loopback server's confinement code is covered by unit tests only
- `src/main/services/browser/local/LocalFileServers.test.ts:46`: `const itPosix = process.platform === 'win32' ? it.skip : it`
- `src/main/services/browser/page/plainProfileFile.test.ts:32` and `src/main/services/browser/BrowserProfileService.test.ts:32` use the same skip. The pattern is repeated across about ten browser unit files.
- `itPosix` skips the symlink and permission tests on Windows. The comment at `vitest.main.config.ts:170` says the confinement floor is measured on one platform. The Windows unit lane therefore proves none of the real-path confinement.
- Bug it would miss: a Windows-only break in `localConfinedFile.ts`, such as drive-letter or case handling in the real-path prefix check, passes the required unit lane. `Windows checks` is advisory and runs the same skips.
- Fix: add one Windows-specific confinement test. It would use a junction or a case-variant path and be named for 025-FR-005. Or record in `docs/technical-debt.md` that Windows confinement has no automated proof.
- Confidence: medium. I did not read the Windows lane config.

### [low] A trivially true assertion in the focus-lock test is still there
- `e2e/os-focus-lock.e2e.ts:58-59`: `a.release()` followed by `expect(exclusive.settled()).toBe(false)`.
- `release()` runs synchronously and the poll has not ticked, so this passes whatever the code does. Line 56 and the ordering in the second test are the real checks.
- Fix: delete line 59, or poll for a stable false.

### [low] Dead-holder cleanup is only tested for `exclusive.` entries and a dead mutex
- `e2e/os-focus-lock.e2e.ts:84-101` covers a dead `exclusive.` entry and a dead mutex owner.
- A dead `shared.` or `waiting.` entry, and an ownerless old mutex, are untested. The `process.on('exit')` release is also untested.
- Bug it would miss: a stale `waiting.` entry from a crashed run would block every later shared lease. The tests would still pass.
- Fix: add one dead `waiting.` entry test.

### [low] The `exclusive.promise` awaits can hang until the test timeout
- `e2e/os-focus-lock.e2e.ts:61` and `:77`: `await exclusive.promise`.
- A writer-priority bug would show as a bare Playwright timeout with no message about the lock.
- Fix: wrap the awaits in `expect.poll`, or race them against a timeout that names the lock.

## What is strong
- Round-1 medium findings are fixed:
  - The `localConfinedFile.ts` floor is now 98/98/92/98 (`vitest.main.config.ts:172`). The `plainProfileFile.ts` floor is 98 across the board (`:198`). Both have "measured" comments.
  - `e2e/browser-pick-frames.e2e.ts:307` now reads `test.fail(true, 'Owner queue item 24 (025-AC-035): ...')`.
- `localConfinedFile.race.test.ts` stays close to the real file system. Only `lstat`, `realpath` and `open` are wrapped. The assertions check the exact outcome (`{ ok: false, status: 403 }` or `404`) and that the handle is closed (`opens.closed()` equals `[true]`).
  - Tests cover:
    - a file swapped under the name (403);
    - a name removed after the open (404, `calls` equals 2, veto not called);
    - a failing `close` after a failed check;
    - a throwing veto;
    - the success path, which leaves the handle open for the caller.
- `useNavFold.test.ts` (8fd4ed87) checks numbers worked out by hand in comments.
  - The regression test at `:139-147` pre-sets `data-fold="3 4"` while the hook's own count is still 0, and expects 2. Per its comment, reading the stale count would give "fits" and the row would flip every frame.
  - The test uses CSS rules that really take folded parts out of the flow, not a hardcoded result.
  - Edge cases covered: no origin, a null row, a zero-width row, and no canvas.
  - `NavigationRow.test.tsx` mocks only `useNavFold`, because jsdom has no layout. It then checks the `data-fold-step` and `data-fold` attributes and the focus hand-off to More.
- Flakiness and markers:
  - A grep for `waitForTimeout`, `.only` and `test.fixme` in `browser-*` e2e files found none.
  - Every `test.skip` in those files carries a reason string.
  - The renderer tests have no `.skip`, `.todo` or `.only`.
  - Only two `test.fail()` markers exist in `e2e`, both with a reason tied to a recorded owner item or spec gap (`e2e/browser-tab-navigation.e2e.ts:247`, `e2e/browser-pick-frames.e2e.ts:307`).
- The focus-lock tests use a private directory per test, so they cannot hit a real lock. The failure test (`:103-111`) asserts the holder's pid in the message and that no `waiting.` entry is left behind.

## Owner-pending items seen (not scored)
- 025-AC-024 worker `Sec-CH-UA`: `test.fail(true, ...)` at `e2e/browser-tab-navigation.e2e.ts:247`.
- 025-AC-035 covered-by check: `test.fail(true, ...)` at `e2e/browser-pick-frames.e2e.ts:307`.
- The 27 uncovered AC IDs are all manual, packaged, bench, review, all-lane or owner-pending e2e, so I did not score them as gaps.

## Score rationale
This matches anchor 8. There is no critical or high finding. The one medium finding is local, with a clear fix. The three low findings are carry-overs from round 1 in the lock tests. This is not a 9 because the Windows lane has no confinement proof and the lock tests still have a trivially true assertion and a missing dead-holder case.

## Round 2 notes
- The unit suite cannot see the e2e focus-lock and Mac e2e behaviour, because a locked screen blocks that run. I could not check whether the e2e tests pass today.
- I did not read all of the 17426356 test changes line by line. I sampled `localConfinedFile.race.test.ts`, `useNavFold.test.ts` and `NavigationRow.test.tsx`.

## Not verified
- I did not run `npm run test:cov` or `node scripts/check-spec025-trace.mjs`.
- I did not open the Windows lane config.
- I did not read the `plainProfileFile` tests beyond their floors.
