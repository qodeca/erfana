# Handoff to the Windows session – Wave 1 checkpoint for v0.22.0

> **Point-in-time document.** Written on the date below and not maintained afterwards.

**Date**: 2026-10-19
**From**: macOS session
**Repository**: the **private** fork `qodeca/erfana-ghsa-9h7p-fwhq-5qmm` (from a draft security advisory). **Never push any of these branches to `qodeca/erfana`.** The owner publishes them on release day.
**Branch to test**: `integration-022` = `develop` (`5171f009`) + the eight Wave 1 branches below
**Goal**: prove the Wave 1 fixes work on Windows 11 before Wave 2 starts. Report only – fix nothing on the shared branches. If something is red, write it down with the exact error and stop that item (§ 6).

---

## 0. Why these fixes are private

One fix closes a security bug in the released app (v0.16.1 – v0.20.1). Until v0.22.0 ships, keep these rules:

- Use this fork only.
- Do not open public issues or PRs.
- Do not write security wording in commit messages.
- Do not paste details into public chats.

---

## 1. Setup

```powershell
gh auth status                                   # must be signed in as an account with access to the fork
gh repo clone qodeca/erfana-ghsa-9h7p-fwhq-5qmm erfana-022
cd erfana-022
git checkout integration-022
git rev-parse --short HEAD                        # report this SHA
npm ci                                            # never npm install
```

Python 3.12 is needed for node-pty if a native rebuild runs.

## 2. What changed (Wave 1)

| Branch | What | Windows risk |
|---|---|---|
| `fix/status-spawn-isolation` | git runs from `%TEMP%` with `-C <project>`, an allow-listed env, `-c` overrides for every config key that can start a program, `GIT_NO_LAZY_FETCH=1`, `GIT_ALLOW_PROTOCOL=none`, `windowsHide`, the null device `\\.\nul` for hooks and includes, and `where.exe` with `PATHEXT`. System `core.autocrlf` / `core.eol` / `core.safecrlf` are read once and passed back. The HTML preview's gitignore check skips the rule when the project folder itself is ignored | **High** – nothing has run on real Git for Windows yet |
| `fix/atomic-text-write` | saves write a temp file `.erfana-tmp-<uuid>`, then rename it over the target; on persistent EPERM / EBUSY / EACCES the save falls back to an in-place write; old temp files are swept at project open | **High** – rename over a file another app holds open |
| `fix/session-permissions-preload` | default-session permission handler (camera video only); preload exposes only `shell.openExternal`; API key uses `safeStorage.encryptStringAsync` with a sync fallback; lock HMAC secret file `~/.erfana/lock-hmac-secret.enc` | **High** – DPAPI behaviour, upgrade of a stored key |
| `fix/external-link-routing` | every outside link goes through one check; UNC (`\\host\share`), `file:` and `ftp:` are refused | Medium |
| `fix/pdf-export-window` | PDF export window in its own session, CSP, time limits | Medium |
| `fix/startup-and-logging` | start-up survives init errors (non-blocking message), `crash.log`, log size and rate caps, control-character escaping | Low |
| `fix/confirm-dialog-focus` | Enter follows the focused button; delete / discard / quit prompts open on Cancel | Low |
| `chore/hooks-lint-and-e2e-home` | react-hooks lint; each e2e worker gets its own sandbox `HOME` / `USERPROFILE` / `APPDATA`; temp folders removed with retries (#134) | Medium – teardown on Windows |

## 3. Automated gate (one sequential run)

```powershell
npm run lint; npm run lint:css; npm run design -- --check; npm run typecheck
npm run test:cov
npx electron-vite build
npx playwright test
```

Report each exit code and the pass / fail / skip counts. After the e2e run, list what is left in `.e2e-temp\`. It should be empty – that is #134.

## 4. Windows-only checks

Run each check. Record the command and the output.

**Git (hardened)**
- G1: `git -c include.path=\\.\nul config --get core.bare` inside any repo. Git must accept the value (exit 0 or 1, **not** 128). If it exits 128, every native status falls back to the slow reader – report the exact error.
- G2: open a large real repo in the built app. Check that git badges appear, and that `%USERPROFILE%\.erfana\logs\main.log` does not say native git fell back. No console window may flash up during refreshes (`windowsHide`).
- G3: in a repo with `core.autocrlf=true` set **only** in the system config (the Git for Windows default), open a CRLF text file in Erfana, save it without changes, and wait for a refresh. The file must **not** show as modified.
- G4: the unit test `git-status.worker.isolation-integration.test.ts` is skipped on Windows (its marker scripts are `sh`). Note that in the report; nothing to do.

**Saves**
- S1: hold a file open without delete sharing:
  ```powershell
  $f = [System.IO.File]::Open("$PWD\locked.md", 'Open', 'Read', 'Read')
  ```
  Edit and save `locked.md` in Erfana. The save must succeed, and `main.log` must show one warning about the in-place fallback with **no file path in it**. Then run `$f.Close()`.
- S2: save a file 20 times quickly (autosave on). No `.erfana-tmp-*` file may stay in the folder, and none may show in the tree.
- S3: make a file read-only (`attrib +r file.md`) and try to save it. It must fail with the "Save failed" toast. Erfana must not overwrite it silently.

**Keys and locks**
- K1, upgrade: with **v0.20.1** installed, store an OpenAI key in Settings and quit. Run the integration build with the same `%USERPROFILE%\.erfana`. The key must still work (Settings shows it as stored, and a transcription request does not say "no key"). This proves DPAPI data from the old sync API reads with the new async path.
- K2: open the same project in two instances of the integration build. The second instance must see the first one's lock.
- K3: start two instances at the same moment (two shortcuts, one double-click). Check that `lock-hmac-secret.enc` exists once and both instances still see each other's locks.

**Links and PDF**
- L1: in a Markdown file, click and middle-click links to `\\localhost\c$`, `file://localhost/c:/windows`, `ftp://example.com` and `https://example.com`. Only the https link may open (in the browser). The others must do nothing.
- P1: export a Markdown file with a Mermaid diagram and an `https://` image to PDF. Both must appear in the PDF.

**Known Windows bugs (reproduce only)**
- W1, #208: a silent exit when a very large project changes constantly. Use the repro in the issue on `integration-022`. Report whether it still happens. Do not fix it here.
- W2, #214: a V8 fatal error while quitting. Quit 20 times with a project and a terminal open. Report any crash and attach the crash dump path.

## 5. Report

1. Write `docs/handoffs/2026-10-19-windows-wave1-report.md` in the fork. Use the same sections as this file: SHA, gate results table, each check marked pass / fail with its evidence, and open questions.
2. Commit it on a new branch `report/windows-wave1`.
3. Push it **to the fork only**: `git push origin report/windows-wave1`. Here `origin` is the fork, because you cloned the fork.

## 6. If something is red

- Do not change the eight fix branches.
- Record the exact error, the steps, and the log lines (with paths redacted).
- Carry on with the other checks, then report.
