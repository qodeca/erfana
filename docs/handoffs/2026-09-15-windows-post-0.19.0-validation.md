# Handoff to the Windows session – validate Erfana on Windows after v0.19.0

> **Point-in-time document.** Written on the date below and not maintained afterwards. Commit SHAs, test counts and CI states were true on that date and go stale immediately.

**Date**: 2026-09-15
**From**: macOS session (Darwin, arm64)
**Branch**: `develop` @ `2dada797` (`main` was fast-forwarded to the same commit)
**Last release**: `v0.19.0` (tag at `854373be`, shipped 2026-09-04)
**Goal**: prove that everything on `develop` since v0.19.0 works on Windows 11, fix or file what does not, and hand back a dated report.

---

## 1. Why you are running this

Since the v0.19.0 tag, `develop` gained three merged PRs and three doc resyncs. None of it has run on a Windows host:

| Change | What it did | Where to read |
|---|---|---|
| #121 | New e2e coverage (file ops, tabs, saving, toolbar, search, layout) and a fix for "Reload from Disk" crashing the renderer | `git log 93b1509b` |
| #125 | electron-builder 26.15.3 plus `npm audit` fixes | `git log 4f8da0d8` |
| #127 (issue #124) | Multi-page HTML preview: preview no longer drifts over the chrome, same-project iframes, same-tab links with Back/Forward, Open in default browser, keyboard entry into the page, autosave held during the unsaved-changes prompt | [docs/html-preview/README.md](../html-preview/README.md), [docs/design/design-issue-124.md](../design/design-issue-124.md), `docs/CHANGELOG.md` (Unreleased) |
| docs | Full documentation resync | `git log 2dada797` |

Full list: `git log --oneline --first-parent v0.19.0..develop`.

### The advisory Windows CI job is red – start here

The advisory `Windows checks` job was **green** before #127 (`4f8da0d8`) and **red** on the #127 PR head and on `develop` @ `2dada797`:

- Run: https://github.com/qodeca/erfana/actions/runs/35002096449 (job "Main-process tests")
- Result: **6 test files failed, 29 tests failed**, 553 files passed.
- Failing files:
  - `src/main/ipc/preview/navigation-handlers.test.ts` (10 tests)
  - `src/main/services/preview/PreviewViewService.navigation.test.ts`
  - `src/main/services/preview/PreviewViewService.resume.test.ts`
  - `src/main/services/preview/PreviewViewService.pageScope.test.ts`
  - `src/main/services/preview/PreviewViewService.exportName.test.ts`
  - `src/renderer/src/components/Panels/MarkdownEditorPanel.integration.test.tsx` ("Save by id")

All six are #124 same-tab navigation, resume, or save-by-id suites, and all passed on macOS and Linux CI. **Cause not investigated.** A reasonable first guess (inferred, unverified) is POSIX-only path fixtures or path math in those tests or in `previewUrl.ts` / `previewViewNavigation.ts` `toProjectPath`. Rule out a real product bug before "fixing the test": a same-tab move that fails on Windows is a user-facing defect.

The job is advisory, so it blocks no merge. That is why it slipped through.

---

## 2. Environment setup on the Windows host

```
git fetch origin
git checkout develop
git pull
git rev-parse --short HEAD    # expect 2dada797 or newer – say which
npm ci                        # never npm install (it rewrites the lock; CI then fails)
```

- **Node 24** – the version is pinned in `.nvmrc`.
- **Python 3.12 or 3.14.x, not 3.13.** `node-pty` fails to build on 3.13.
- Windows contributor rules: [docs/windows/contributing.md](../windows/contributing.md), including cross-platform path fixtures and platform overrides in tests.

---

## 3. Work plan, in priority order

### Step A – triage the red Windows CI (section 1)

1. Run `npx vitest run -c vitest.main.ts <failing file>` for each main-project file, and `-c vitest.renderer.ts` for the renderer one. Capture the first assertion diff.
2. Classify each failure as a **test-only** path assumption or a **product** bug on win32.
3. Fix on a branch off `develop`. Follow the test-file split policy in `docs/windows/contributing.md`.

### Step B – full local gate on Windows

Run these in order and record pass or fail, with exact output for any failure:

```
npx eslint . --ext .js,.jsx,.cjs,.mjs,.ts,.tsx,.cts,.mts   # `npm run lint` runs --fix; do not use it for a check
npm run lint:css
npm run design -- --check
npm run typecheck
npm run test:ci
npm run test:main
npm run check:headers
npx electron-vite build
```

- `npm run test:cov` **cannot pass on a Windows host** (known; see [docs/windows/known-flakes.md](../windows/known-flakes.md)). Run it anyway and record *which* per-file floors miss. #124 added new floors that have never run on Windows.
- Check every failure against `docs/windows/known-flakes.md` before calling it new.

### Step C – e2e on Windows

`e2e.yml` is disabled, so your local run is the only Windows e2e coverage.

```
npx electron-vite build
npx playwright test --project=electron e2e/html-preview-*.e2e.ts
npm run test:e2e
```

- There are 12 `html-preview-*` specs. The new ones are frames, same-tab, same-tab history, open-in-browser (a test seam, no real browser), keyboard-focus, bounds and drag-freeze.
- **Keep Erfana the foreground window and the screen unlocked.** The native keyboard-focus test and the zoom test need OS focus, and fail with "the OS would not make Erfana the key window" otherwise.
- The frames spec picks the leaf-symlink label by platform.

### Step D – manual checks only a person on Windows can do

Setup: build a test project from `e2e/fixtures/html-preview-corpus/` (see its `README.md`) and open it in `npm run dev`. The win32-only code paths are listed in [known-flakes.md § audit candidates](../windows/known-flakes.md) under "Multi-page HTML preview (#124)".

| ID | Check | Expected |
|---|---|---|
| W1 | Splitter drags, scroll-then-drag, window-edge drags (edges, corner, Aero snap, maximize and restore), fast drag into the preview. Watch the log for `no-settled-push` and `Preview drag freeze` lines. | The page is hidden during the drag and returns in place on release. It never draws over the tab strip, toolbar, tree or terminal. No `no-settled-push` line per resize. |
| W2 | Same-tab mode: overview → pricing → about. With focus in the page, press Alt+Left, Alt+Left, Alt+Right. Repeat with focus on the toolbar. | Back, Back, Forward. The auto-hidden menu bar does not appear. Monaco and the terminal keep their own Alt+arrow behaviour. |
| W3 | With Edge as the default browser, use Open in default browser from the tree item and from the toolbar after a same-tab move. | Edge opens the right page from its real path, and the busy look clears. |
| W4 | Make a launch fail, e.g. the default browser program was removed. | An error toast "Could not open in browser" that names "Reveal in Explorer". A browser that starts and then quits reports nothing, by design, but the busy look clears. |
| W5 | Put the corpus on a second drive (`D:\…`), on a UNC share (`\\server\share\…`), and in a non-ASCII folder with a non-ASCII page name. In each: preview, same-tab link, open in browser. | Works every time. |
| W6 | `mklink /D C:\uat\corpus-link C:\uat\corpus`, open the link as the project, then open `design-set/index.html`. | The first page shows, not a 404. |
| W7 | `mklink frames\escape.html C:\uat\outside.html`, then open `frames/refused.html` and its failure badge. | `/frames/escape.html` is listed under "Frame escaped the project". On macOS it is "Missing local file". Never run on Windows. |
| W8 | Walk `design-set/` end to end: open, move in both link modes, Back/Forward, Find, PDF export, open in browser. | Same as macOS. |
| W9 | From `cmd` in `design-set\`, write an NTFS stream on `index.html` (`index.html:stream`). Use Open in default browser on that name, then on plain `index.html`. | The stream name is refused with the ".html and .htm only" toast and no browser starts. Plain `index.html` opens. |
| W10 | Keyboard: Tab to the preview placeholder, press Enter, type in an in-page input, press Escape. | Keys reach the page after Enter. After Escape, focus is back on the band chip and keys go to Erfana, not the hidden page. |
| W11 | Make an editor tab of `B.html` dirty. From the preview, follow a same-tab link to `B.html`. Answer the unsaved-changes prompt with the keyboard only, and wait more than 2 s before answering "Don't save". | The keys act on the dialog. "Don't save" leaves the file on disk unchanged. |

### Step E – regression sweep of pre-#124 areas

Re-run the §4 and §5 checks of the v0.19.0 Windows handoff, [2026-09-03-windows-release-verification.md](2026-09-03-windows-release-verification.md), and compare against its result, [2026-09-04-windows-verification-report.md](2026-09-04-windows-verification-report.md). Pay most attention to what #121 and #125 touched:

- "Reload from Disk";
- saving and tabs;
- the installer build with electron-builder 26.15.3 (`npm run build:win`; compare with the v0.19.0 installer – local builds are unsigned, signing runs only in the release pipeline, see `docs/build/release.md`).

---

## 4. Rules for this session

- **Branching:** fixes go on `feature/<name>` off `develop`, with a PR into `develop`. Never commit straight to `main`. Conventional Commits.
- **Issues:** follow [docs/claude-code/github-issues-protocol.md](../claude-code/github-issues-protocol.md). The user must initiate every issue create, edit or close. Security findings go to private advisory reporting, never a public issue.
- **Windows status snapshot:** do **not** bump `docs/windows/implementation-plan.md` unless a release is being cut.
- **Known debt:** Windows-relevant items live in [docs/technical-debt.md](../technical-debt.md) entries 47–63 – check before filing a duplicate.
- **Local tool folders:** never commit local tool state or keys. If an untracked tool folder appears, add it to `.git/info/exclude`.
- **Secret scan:** 32-hex preview root tokens in tests are fixtures. `.gitleaksignore` explains the pattern. New fixture tokens need an inline `gitleaks:allow`.

---

## 5. What to send back

Write `docs/handoffs/<date>-windows-post-0.19.0-report.md`, mirroring the 2026-09-04 report:

1. A summary: ready or not ready for the next release.
2. Step A: the root cause per failing file, test-only or product, and the fix PR numbers.
3. Step B and Step C: pass or fail per command, exact output for failures, and the `test:cov` floors that miss.
4. Step D: a tick list W1–W11, marking anything that differs from macOS.
5. Step E: the regression tick list.
6. The host: Windows version and build, Node, Python, display scaling, default browser.
7. Anything new that is not in `known-flakes.md` or `technical-debt.md`.

---

## Suggested skills

- **`erfana:managing-issues`** – to implement a fix for each real defect found in Step A or D (`implement #<n>`), or to draft a new issue. Only when the user asks.
- **`erfana:doc-update`** – after fixes land, to resync `docs/windows/known-flakes.md`, `docs/testing/README.md` (the Windows skip count) and the HTML preview docs.
- **`handoff`** – to hand the report back to the macOS session if work remains.
- **`releasing-erfana`** – only if the user decides to cut the next release after this validation. It owns the Windows status-snapshot bump.
