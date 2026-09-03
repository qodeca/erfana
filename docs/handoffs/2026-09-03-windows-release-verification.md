# Handoff to the Windows session — verify Erfana before the v0.19.0 release

> **Point-in-time document.** Written for one release and not maintained afterwards. Commit SHAs, test counts and issue states below were true on the date given and go stale immediately.

**Date**: 2026-09-03
**From**: macOS session (Darwin 25.6.0, arm64)
**Branch**: `develop` @ `c82bea2`
**Goal**: confirm the HTML preview works on Windows 11, so we can release.

---

## 1. Why you are running this

Erfana shipped the HTML preview in **v0.18.0** (2026-08-25). Since then
`develop` gained 63 commits that make the preview actually usable:

- **Link navigation** — clicking a link inside a previewed page opens the target
  in a new Erfana tab.
- **Independent preview tabs** — every `.html` gets its own tab; only the 3 most
  recent stay running, the rest freeze to a still picture.
- **Permission band** — a strip along the top of the preview lists every blocked
  remote address with an **Allow** button. It replaced the old pop-up toasts.
- **Origin-based approval** — you approve `scheme + host + port` together, not a
  loose host name.
- **Preview toolbar** — Find, and Export to PDF.
- **A design system** in `design/`, now enforced by CI.

None of it has run on a Windows host yet. That is the gap this session closes.

---

## 2. Everything that already passed on macOS

All of these are green at `c82bea2`. Do **not** re-investigate them unless your
Windows run disagrees.

| Check | Command | Result |
|---|---|---|
| ESLint | `npm run lint` | pass |
| Stylelint | `npm run lint:css` | pass |
| Design sync | `npm run design -- --check` | pass — 9 generated files up to date |
| Typecheck | `npm run typecheck` | pass |
| Unit + integration | `npm run test:ci` | **461 files, 11689 tests, all pass** (18.7 s) |
| Coverage floors | `npm run test:cov` | pass |
| Build | `npx electron-vite build` | pass (13.0 s) |
| E2E electron | `npm run test:e2e:no-build` | **118 pass** (1.6 min) |
| E2E HTML preview | 3 preview spec files | **14 pass** — save-to-visible P95 **122 ms / 124 ms** against a 300 ms budget |
| E2E visual | `npx playwright test --project=visual` | 6 pass |
| gitleaks | `gitleaks detect --log-opts="--all"` | no leaks, 199 commits |
| trufflehog | `trufflehog filesystem . --only-verified` | 0 verified secrets |
| GitHub CI on `develop` | Quality Checks + Secret Scan | both success at `c82bea2` |

**Two things I could not run on macOS:**

- **REUSE license lint** — `pipx` is not installed here. CI covers it and it is
  green on `develop`. You do not need to run it.
- **Windows anything.** That is your job.

**Known and accepted, not a regression:** `npm audit --omit=dev` reports **9 high**
severity findings (`sharp`/`libvips` via `@llamaindex/liteparse`, and `image-size`
via `@turbodocx/html-to-docx`). This is the tracked baseline in issue **#61**. It
is not a release blocker and `npm audit` is not a required check.

---

## 3. Environment setup on the Windows host

```
git fetch origin
git checkout develop
git pull
git rev-parse --short HEAD    # must print c82bea2 (or newer — say which)
npm ci
```

Two gotchas that cost time if missed:

- **Node 24+.** The macOS box ran Node **v22.23.1**, which is below the project's
  stated development floor. If Windows shows a difference the macOS run missed,
  check the Node version first.
- **Python 3.12, not 3.13.** `node-pty` fails to build on 3.13, at install time,
  before anything else runs.

---

## 4. Automated checks to run on Windows

Run in this order. Report the exact output of anything that fails.

```
npm run lint
npm run lint:css
npm run design -- --check
npm run typecheck
npm run test:ci
npm run test:main
npx electron-vite build
npm run test:e2e
npx playwright test --project=visual
```

Notes:

- **`npm run design -- --check` is the one most likely to fail on Windows.**
  Issue **#104** says the design check will fail on a Windows checkout, and
  Windows CI cannot see it. If it fails, that is expected — capture the exact
  error, it is the evidence #104 needs.
- **CI does not run E2E at all.** `e2e.yml` is disabled. Your local run is the
  only E2E coverage this release gets on Windows.
- **E2E flakes on Windows are catalogued** in `docs/windows/known-flakes.md`.
  Check a failure against that register before reporting it as new.
- The `Windows checks` CI job only runs `typecheck` + `test:main`. Everything
  beyond that is manual, here.

---

## 5. Manual test plan — the HTML preview on Windows

This is the part that matters most. Nothing below has ever been exercised on
Windows. Build and launch the app, then work through it.

### 5.1 Paths — the highest-risk area

The preview maps a file path into a custom-protocol URL. That is exactly where
Windows breaks. Test each of these with a real project:

- [ ] A project on **`C:\`**, opening a `.html` file with relative `.css`, `.js`
      and an image. All three must load.
- [ ] A project on a **second drive letter** (`D:\`) if you have one.
- [ ] A path containing **spaces** — `C:\Users\me\My Projects\site\index.html`.
- [ ] A path containing **Polish characters** — `C:\Projekty\Ćwiczenia\strona.html`.
- [ ] A **deeply nested** path over 260 characters, if you can make one.
- [ ] A **UNC / network path** (`\\server\share\...`) if one is available.
- [ ] An `.html` file that references a subresource **one folder up** (`../assets/x.css`)
      — it must load if still inside the project, and be refused if outside.

### 5.2 Link navigation

- [ ] Click a link to another `.html` in the project → opens a **new tab**, running.
- [ ] Click the same link again → **reuses** the tab, does not open a second one.
- [ ] Click a link to a `.md` file → opens in the Markdown panel.
- [ ] Click a link to an image → opens in the image viewer.
- [ ] Click a `#anchor` on the same page → **scrolls**, no new tab.
- [ ] Click a link pointing **outside the project** → refused, listed in the
      failure badge, nothing opens.
- [ ] Click a link into `node_modules\` or `dist\` → opens as **source**, does not run.
- [ ] Click an `https://` link → Erfana shows the destination and **asks** before
      handing it to the default Windows browser. Confirm it opens the right browser.
- [ ] Click a `javascript:` link → nothing happens, nothing opens.

### 5.3 The permission band and the allowlist

- [ ] Open a page that loads a script or font from a **remote CDN**. It must be
      **blocked**, and the band along the top must list the origin.
- [ ] Press **Allow**. The page reloads and **the resource actually loads**.
      (Issue **#111** says nothing automated proves this end to end — so prove it
      by hand, and say clearly whether it worked.)
- [ ] Close the project, reopen it. The approval must still be there.
- [ ] Check `.erfana\settings.json` inside the project — the origin is written
      there. Confirm the file is valid JSON and not corrupted. Windows renames
      during atomic writes are a known sore spot (`EPERM` retries).
- [ ] A page referencing `http://` (not https) → allowable, and the confirm step
      must warn the connection is not encrypted.
- [ ] A page referencing an **IPv6 literal** → the row has **no** Allow button and
      says why.
- [ ] A page referencing **two different** hosts → both get their own row, and
      approving one must **not** remove the other.

### 5.4 Preview lifecycle and windows

- [ ] Open **4 or more** `.html` files. Only 3 stay live; the 4th freezes to a
      still picture. Click the frozen tab → it wakes up and runs again.
- [ ] The still picture must show the page's own colours, **not a black panel**.
      (Black panel was a real bug fixed on macOS — verify it on Windows.)
- [ ] Change the Windows **display scaling** to 125% and 150%, reopen a preview.
      The view must be sized correctly, with no black band and no offset.
- [ ] Open a preview, then close the whole window. No orphaned process should
      remain (check Task Manager).
- [ ] Edit the `.html` file in an external editor and save → the preview refreshes
      within about a second.
- [ ] Delete the `.html` file while previewing → handled, no crash.

### 5.5 Toolbar

- [ ] **Find** — `Ctrl+F` (not `Cmd+F`). Type a term, confirm matches highlight and
      next/previous work.
- [ ] **Export to PDF** — the Windows save dialog opens, the file is written where
      you chose, and the PDF opens correctly.
- [ ] **Zoom** — `Ctrl` + `+` / `-` changes the previewed page's zoom.

### 5.6 File watching

Issue **#112** says the preview watch pool can strand chokidar handles.

- [ ] Open and close previews repeatedly (10+ times). Watch memory in Task Manager
      — it should not climb without bound.
- [ ] Close a preview while its file is **open in another program** — no `EBUSY`
      crash, no locked file left behind.

---

## 6. Known open bugs — do not chase these

They came out of the review of PR #79 and are already filed. If you hit one,
confirm it and move on; do not fix it in this session.

| Issue | What it is | Blocks release? |
|---|---|---|
| **#115** | A broken project allowlist looks the same as an empty one — the badge only reaches the log | **Yes, fix before release** — user-visible |
| **#116** | Docs describe the old preview behaviour in ten places | **Yes, fix before release** — cheap |
| #111 | Nothing automated proves that Allow really loads the resource | No — cover it manually per §5.3 |
| #112 | Preview watch pool can strand chokidar handles | No — not user-visible today |
| #113 | Eight preview tests pass regardless of the code they name | No — test quality |
| #104 | `design --check` fails on a Windows checkout | No — but capture the error |
| #109 | No gate typechecks test files; 388 type errors hide behind that | No |
| #61 | 9 high npm-audit findings in production deps | No — tracked baseline |

---

## 7. Before the release tag

Once the Windows verification passes:

1. Fix **#115** and **#116** on a branch off `develop`.
2. **Re-anchor the Windows status snapshot.** `docs/windows/implementation-plan.md`
   currently says *"Last updated 2026-08-25, anchored on v0.18.0"*. The
   `release-quality-runner` agent checks this and will block the release if it is
   stale. Bump the date and the version anchor to the version you are shipping.
3. Merge `develop` into `main`.
4. Use the **`releasing-erfana`** skill. It handles the version bump, the two-tier
   release notes, the signed tag, the CI pipeline poll and artifact verification.
   Do not hand-roll the tag.

---

## 8. What to send back

- Pass or fail for every command in §4, with exact output for any failure.
- A tick list for §5, marking anything that behaves differently from the macOS
  description above.
- Windows version, Node version, Python version, display scaling used.
- Anything surprising that is not already an open issue.

