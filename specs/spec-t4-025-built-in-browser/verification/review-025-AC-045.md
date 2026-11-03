# Review record: 025-AC-045 (release note on terminal links)

Reviewed 2026-11-03 on branch `feature/built-in-browser` at `b95ca4fc`, plus the wording fix described below. Requirement: 025-FR-045 – the release notes of the release that ships the browser state that a plain click on a terminal link now opens an Erfana browser tab and that Ctrl/Cmd-click opens the OS browser. The acceptance text is in `specs/spec-t4-025-built-in-browser/requirements/04-acceptance.md` (section "025-AC-045: Release note"): "Given the release notes of the shipping release, then they state the plain-click and Ctrl/Cmd-click behaviour of terminal links."

**Result: not yet met.** The wording is ready in the changelog fragment, but the release notes of the shipping release do not exist yet, and nothing in the release process copies the fragment into them. For that reason this record has no row in the table of `manual-evidence.md`.

## What was checked

| Check | Result | Evidence |
|---|---|---|
| A changelog fragment states the change | The `### Changed` bullet reads: "A plain click on a web link in the terminal now opens it in an Erfana browser tab. Cmd-click (Ctrl-click on Windows and Linux) opens it in your system's default browser, as a plain click did before." | `changelog.d/feature-built-in-browser.md:16-17` |
| The fragment follows the fragment rules | Under an allowed group, bullets only, named for the branch | `changelog.d/README.md:3-16` |
| The wording matches the code | A plain click on an `http` or `https` link opens a browser tab; Cmd on macOS, Ctrl elsewhere, opens the system browser | `src/renderer/src/components/Panels/TerminalPanel/terminalLinks.ts:45-47`, `:66-69` |
| The user guide says the same | | `docs/user-guide/reference/terminal.md:40`; `docs/user-guide/reference/built-in-browser.md:29` |
| The fragment reaches the shipping release's notes | **No.** At release, every fragment is folded into `docs/CHANGELOG.md` (`changelog.d/README.md:22-25`). The published GitHub release body is a different file, `docs/release-notes/v<version>.md` (`.github/workflows/release.yml:84`, `:158`). The release skill builds that file from 3–5 bullets the operator types and from `git cliff` commit subjects (`.claude/skills/releasing-erfana/SKILL.md:306-345`); it does not read `changelog.d/` or `docs/CHANGELOG.md`. The commit subject that brought the change (`b25c655f`, "open terminal links in a browser tab") names the plain click but not Ctrl/Cmd-click | review read, 2026-11-03 |

## Wording fix made in this review

At `b95ca4fc` the bullet read "Cmd-click (Ctrl-click on Windows)", which leaves Linux out; the code uses Ctrl on every platform but macOS (`terminalLinks.ts:45-47`). It now reads "Ctrl-click on Windows and Linux". The two other shortcuts in the same fragment ("Cmd+T, Ctrl+T on Windows" at line 5 and "Cmd+E, Ctrl+E on Windows" at line 8) have the same gap; they are not part of this criterion and were left as they are.

## What would close it

At the release that ships spec 025, the operator's user-facing bullets for `docs/release-notes/v<version>.md` carry the fragment's sentence (plain click opens an Erfana browser tab; Cmd-click on macOS, Ctrl-click on Windows and Linux, opens the system browser). A reviewer then reads that file, and a row for 025-AC-045 is added citing it.
