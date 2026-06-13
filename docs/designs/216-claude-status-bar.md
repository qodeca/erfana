# Design — Issue #216: Per-terminal Claude Code context status bar

> Status: APPROVED — implemented (macOS v1; **Windows added via [#217](https://github.com/qodeca/erfana/issues/217)** — see §10 "Follow-up issue — Windows support"). Architecture design for the managing-issues implement workflow.
> Issue: https://github.com/qodeca/erfana/issues/216 · Branch: `feat/216-terminal-claude-status-bar`

## 1. Summary

A thin (~26px) status bar pinned to the bottom of an individual terminal panel, visible **only** while Claude Code (`claude` CLI) is actively running in **that** panel; hidden otherwise. It shows the friendly model name, a 200k-vs-1M context-window badge, the context-used percentage, and a green/amber/red progress bar; hovering reveals exact token counts (e.g. `84k / 200k`). Always on, display-only. Data is read **non-invasively** from Claude Code's own transcript JSONL; Erfana never modifies the user's Claude Code config/settings. On any detection/parse failure the bar hides gracefully — no error, no stale data.

> **Scope (v1) — macOS only.** Per the QG-4 decision, v1 ships a fully-verified macOS implementation. The per-OS process-detector strategy is preserved, but only `MacClaudeProcessDetector` is implemented; on every non-macOS platform `createProcessDetector` returns a no-op detector (`{running:false}`), so the bar simply never appears (graceful). **Windows is deferred to a follow-up issue** — its cwd→ENC encoding and ConPTY process-chain must be verified against a live Windows host before implementation. The issue's Windows acceptance criterion is moved to that follow-up.

> **§10 (Lens-review remediations) supersedes any conflicting detail in §2–§9.** Read §10 as the authoritative delta.

All filesystem, process-inspection and parsing work lives in the **main process**; the renderer consumes a per-`terminalId` snapshot over IPC and renders display-only UI.

## 2. Research-grounded decisions

- **Token formula (verified against official statusLine docs):** `used = input_tokens + cache_creation_input_tokens + cache_read_input_tokens` of the latest main-session assistant turn (output excluded). `percent = used / windowSize`. Matches Claude Code's own `used_percentage`.
- **Transcript location/encoding (verified empirically against live macOS files):** `~/.claude/projects/<ENC>/<sessionUuid>.jsonl`, where `ENC` replaces every `/` and `.` in the absolute cwd with `-` (e.g. `/Users/x/Projects/erfana` → `-Users-x-Projects-erfana`; `/Users/x/.claude` → `-Users-x--claude`). Active session = most-recently-modified **regular** `*.jsonl` (symlinks/non-regular skipped — see §10) **that is at least as new as the running `claude` process's start time** (a `minMtimeMs` floor with a 2s clock-skew tolerance). The floor is the post-implementation fix for the "context % already filled on a fresh launch" bug: Claude Code only writes a session transcript *after the first turn*, so at launch the dir holds only **prior** sessions; selecting the newest of those mis-reported a previous conversation's tokens until the new session wrote its first turn. Flooring by the process start time (from `ps lstart` — see the cwd-resolution decision below for the sibling `ps`/`lsof` probe) excludes those stale files, so the bar hides until the running session has its own turn; `claude --continue` still resolves because resume appends to the reused file, bumping its mtime above the floor. The start-time probe forces the **C locale** (`LC_ALL=C`/`LC_TIME=C`) so `lstart` is emitted as English ctime regardless of the user's `LC_TIME`; the parser additionally shape-guards the string (4-digit year + `HH:MM:SS`) before `Date.parse`, and an unresolved/non-conforming start time omits the floor (graceful degrade). **The cwd used is Claude's *live* working directory**, not the panel's spawn cwd — see the cwd-resolution decision below.
- **cwd resolution (QG-4 decision — "live cwd from process"):** the panel's spawn-time cwd is unreliable (a user may `cd` before launching `claude`, and TerminalService does not track cwd post-spawn). So the cwd that keys the transcript dir is obtained from the **detected Claude process itself**: macOS `lsof -a -p <claudePid> -d cwd -Fn` (cached, one call per detect). If the live cwd can't be read, fall back to the panel's recorded spawn cwd; if neither resolves to a readable transcript dir, the bar hides. This also sharpens same-folder disambiguation (the matched process's own cwd is authoritative).
- **Latest main turn:** last line where `type === "assistant"` and `isSidechain === false`, with non-null/non-`<synthetic>` `message.model`; subagent turns (`isSidechain:true` or under `<uuid>/subagents/`) are excluded.
- **200k-vs-1M detection (model-capability registry + read-only signals):** the transcript does **not** record the window; the only authoritative signal (`context_window_size`) lives in Claude Code's statusLine stdin payload, which would require writing the user's config (the explicitly rejected approach). Instead we resolve cheap-first (verified June 2026 against code.claude.com/model-config + platform.claude.com): standard window `200_000`, extended `1_000_000`. `windowSize = 1_000_000` IF **(1)** the model is natively 1M — Claude Code auto-upgrades **Opus 4.6+** (`claude-opus-4-6`/`4-7`/`4-8` and future `4-9`/`5-x`) to 1M on Max/Team/Enterprise with no on-disk marker; Opus 4.5/4.1/older stay 200k; Sonnet (incl. the 1M-*capable* `sonnet-4-6`, which is **not** auto-granted) and all Haiku stay 200k — **OR (2)** `used > 200_000` — **OR (3)** `~/.claude/settings.json` `model` resolves to a `[1m]` variant (catches explicit `sonnet[1m]` / `opus-4-5[1m]`); else `200_000`. Predicates (1) and (2) are pure in-memory checks evaluated **before** the settings.json read, so a known-1M model or over-threshold usage returns 1M with no file I/O (PERF-2). Reading settings.json is a READ (allowed); never written. **Un-detectable exception (accepted, rare-enterprise):** a 200k-capped Opus deployment (e.g. Microsoft Foundry Opus 4.8) is *actually* 200k but the registry would over-state it as 1M; we accept this rare over-statement rather than under-warn the common auto-upgraded case.
- **Friendly name:** override table (`claude-opus-4-8`→"Opus 4.8", `claude-opus-4-7`→"Opus 4.7", `claude-sonnet-4-6`→"Sonnet 4.6", `claude-haiku-4-5-20251001`→"Haiku 4.5") + generic derivation (strip `claude-`, title-case family, dotted version), falling back to the raw id.

## 3. Architecture

```
RENDERER (per TerminalPanel)
  TerminalPanel.tsx
    ├─ window.api.terminal.create(...) now returns { terminalId, pid }
    ├─ <ClaudeStatusBar terminalId={terminalId}/>  (sibling AFTER <TerminalStatusContent>)
    └─ useClaudeStatusStore: Map<terminalId, ClaudeStatusSnapshot|null>
          ▲ push (api.claudeStatus.onChanged)     │ subscribe(terminalId)
══════════╪═══════════ preload bridge (api.claudeStatus.*) ═══════════
MAIN
  ipc/claude-status-handlers.ts  (register/dispose, validates sender frame + pid)
  ClaudeStatusService (singleton orchestrator)
    ├─ registerPanel(terminalId, ptyPid, cwd, webContentsId)  ◄ terminal:create
    ├─ unregisterPanel(terminalId)                            ◄ PTY exit / panel unmount
    ├─ refresh(terminalId)  (debounced/coalesced 250ms, serialized execFile)
    │     1. IClaudeProcessDetector.isClaudeRunning(ptyPid)  → per-OS pid-tree walk
    │     2. ClaudeTranscriptLocator.resolve(cwd)            → newest *.jsonl
    │     3. ClaudeTranscriptParser.parse(file)             → {modelId, usedTokens}|null
    │     4. ClaudeWindowDetector.detect(modelId, used)     → 200k | 1M (registry → used>200k → settings.json)
    │     5. friendlyName + thresholds                      → ClaudeStatusSnapshot
    │     6. broadcastToAllWindows('claude-status:changed', {terminalId, snapshot|null})
    ├─ ClaudeTranscriptWatcher (external chokidar on ~/.claude/projects/<ENC>)  [PUSH]
    └─ terminal-activity light re-check (markActivity nudge, debounced)         [light poll]
```

**Push vs poll:** transcript file change = PUSH (chokidar on the active session dir) drives live percent updates; process liveness = light poll on terminal activity (cached, debounced ≥1s) so claude start/stop is detected without a constant `ps` loop.

## 4. File plan (every file ≤500 LOC)

### Shared IPC
- `src/shared/ipc/claude-status-channels.ts` (create, ~35) — channel constants (`claude-status:register/unregister/changed`).
- `src/shared/ipc/claude-status-schema.ts` (create, ~90) — Zod `ClaudeStatusSnapshot {terminalId, modelId, friendlyName, windowSize:200000|1000000, usedTokens, percent, level:'green'|'amber'|'red', tooltip}`, `ClaudeStatusChangePayload {terminalId, snapshot|null}`.

### Main — pure utils
- `src/main/services/claudeStatus/encodeCwd.ts` (create, ~40) — `/`+`.`→`-`.
- `src/main/services/claudeStatus/ClaudeTranscriptLocator.ts` (create, ~120) — resolve `<ENC>` dir, newest `*.jsonl` by mtime, exclude `subagents/`, prefix-guard inside `~/.claude/projects`.
- `src/main/services/claudeStatus/ClaudeTranscriptParser.ts` (create, ~160) — per-line try/catch, tolerate truncated trailing line, backward scan for last valid main assistant turn, compute used (excl. output). Untrusted-data handling.
- `src/main/services/claudeStatus/ClaudeWindowDetector.ts` (create, ~150) — model-capability registry (`modelNativelySupportsExtended`: Opus 4.6+ auto-1M) → `used>200k` → settings.json `[1m]` → default 200k.
- `src/main/services/claudeStatus/friendlyModelName.ts` (create, ~70) — override table + generic derivation + raw fallback.
- `src/main/services/claudeStatus/thresholds.ts` (create, ~35) — `levelFor(percent)` green<30 / amber 30–<60 / red≥60 (1M: 300k/600k tokens; 200k: 60k/120k); clamp ≥100.

### Main — per-OS process detector (strategy)
- `process/types.ts` (~30) — `IClaudeProcessDetector.isClaudeRunning(rootPid): Promise<{running, cwd?}>`.
- `process/MacClaudeProcessDetector.ts` (~150) — `execFile('/bin/ps', ['-axo','pid,ppid,comm'])`, ppid BFS from PTY pid, match `claude`.
- `process/WinClaudeProcessDetector.ts` (~170) — PowerShell `Get-CimInstance Win32_Process` CSV, ppid walk, match `claude`.
- `process/createProcessDetector.ts` (~40) — factory by `process.platform`; unsupported → no-op `{running:false}`.

### Main — watcher + orchestrator
- `ClaudeTranscriptWatcher.ts` (create, ~220) — external chokidar v3 (`disableGlobbing:true, ignoreInitial:true, usePolling:false, followSymlinks:false, depth:0`), 250ms coalesce, session-version stale guard; watches only currently-registered dirs (de-duped).
- `ClaudeStatusService.ts` (create, ~300) — orchestrator: `registerPanel/unregisterPanel/refresh/cleanupForWebContentsId/dispose`, per-terminal debounce, serialized detector calls, broadcast snapshot-or-null.

### Main — IPC handler + wiring
- `src/main/ipc/claude-status-handlers.ts` (create, ~130) — `register`/`unregister` invoke handlers; validate sender frame + numeric pid; no-throw.
- `src/main/index.ts` (modify, +6) — register handlers; `cleanupForWebContentsId` on window close; `dispose()` on shutdown.
- `src/main/services/TerminalService.ts` (modify, +25) — store `ptyProcess.pid`; `getPid(id)`; return `pid` in create; on PTY exit notify status service.
- `src/main/ipc/terminal-handlers.ts` (modify, +20) — include `pid` in create response; register/unregister panel.

### Preload
- `src/preload/index.ts` (modify, +30) — `api.claudeStatus = { register, unregister, onChanged(cb)→unsubscribe }`; `pid` on create result.
- preload types (modify, +20) — `ClaudeStatusBridge` + `pid`.

### Renderer
- `src/renderer/src/stores/useClaudeStatusStore.ts` (create, ~90) — Zustand `byTerminalId` map; single global `onChanged` subscription. Solves the multi-panel gap (existing `useTerminalStore` tracks only one `activeTerminalId`).
- `TerminalPanel/components/ClaudeStatusBar.tsx` (create, ~160) — display-only; renders nothing when snapshot null; name + badge + percent + bar + `title` tooltip. Per UX spec.
- `TerminalPanel/components/ClaudeStatusBar.css` (create, ~90) — ~26px strip, design tokens only, `border-radius:0`.
- `TerminalPanel.tsx` (modify, +15) — render `<ClaudeStatusBar/>` after `<TerminalStatusContent>`; activity nudge.
- `src/renderer/src/constants/testids.ts` (modify, +10) — add bar/badge/fill ids; bump count-asserted test.

### Tests (colocated, ~1,800 LOC total)
encodeCwd, locator, parser, window-detector, friendlyName, thresholds, Mac/Win detectors, watcher, service, ipc handler, schema, store, `ClaudeStatusBar.test.tsx`, testids count bump.

## 5. UX specification (from ux-designer)

- **Placement:** new sibling inside `.terminal-panel` after `<TerminalStatusContent>`. Stack = header (41px) → xterm (flex:1) → ccbar (26px). Hidden by **unmounting** (xterm reclaims height; accepted reflow).
- **Order (single flex row):** model name (primary, `--text-sm`/`--font-medium`/`--color-text-primary`) · window badge chip (`--text-xs`/`--font-semibold`/**`--color-text-primary`** on `--color-bg-tertiary`) · spacer · percentage (primary, `--text-sm`/`--font-semibold`, state-colored) · progress bar (64px track `--color-bg-tertiary`, 4px high).
- **Rail:** `height:26px; box-sizing:border-box`, background `--color-bg-secondary`, top border `1px solid var(--color-border-subtle)`, padding-inline `--space-6`.
- **States:** green `<30%` (fill `--color-success`, % text neutral `--color-text-primary`); amber `30–<60%` (fill+text `--color-warning-bright`); red `≥60%` (fill+text `--color-error-bright`). Track constant. Comparisons `pct>=30`, `pct>=60`. (On 1M these are 300k/600k tokens; on 200k, 60k/120k.) The meter fills the available width between the badge and the percentage.
- **Tooltip:** entire row is hover target (still non-interactive); content `"84k / 200k"` / `"95k / 1M"` mono; anchored above; 400ms open / 0ms close.
- **Edge cases:** 0% green; >100% clamps fill + headline % to 100 but tooltip shows raw used; unknown window defaults 200k silently (if used unknown → hide whole bar); narrow-panel degradation order = drop bar+track first, then badge, then ellipsize name — **percentage never dropped**.
- **A11y (WCAG 2.2 AA):** container `role="status" aria-live="polite"` throttled to band changes only; `aria-label` exposes exact counts without focus (`"Opus 4.8, Claude Code context: 48% used, 84k of 200k tokens"`) since v1 has no keyboard-reachable tooltip trigger; progressbar role with valuenow; color never sole indicator (% text always present). **Badge must use `--color-text-primary`** (not `--color-text-secondary`, which fails 4.5:1). `prefers-reduced-motion` disables the fill width transition. Dark-only product → no `prefers-color-scheme`.
- **Proposed new component tokens:** `--terminal-statusbar-height: 26px`, `--terminal-ccbar-track-width: 64px` (or documented literals).
- **Motion:** instant mount/unmount (no height animation — would fight FitAddon); only the fill-width change uses `--transition-normal`, gated by reduced-motion.

## 6. Implementation sequence (TDD)

1. Pure utils (encodeCwd, thresholds, friendlyModelName) + tests.
2. Parser + locator + window-detector with fixture JSONL (valid/truncated/sidechain/null-model/missing/tie-break) + tests.
3. Per-OS process detectors (mocked execFile) + tests.
4. Shared schema + channels + test.
5. External watcher (mocked chokidar) + test.
6. Orchestrator service (wire all) + test.
7. IPC handler + preload bridge + test.
8. Main wiring (TerminalService pid, terminal-handlers register/unregister, index.ts).
9. Renderer store + test.
10. ClaudeStatusBar component + CSS + test.
11. Wire into TerminalPanel; bump testids + count test.
12. Full battery: `lint && typecheck && test:ci && electron-vite build`; manual smoke (real claude, 200k + 1M).

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| FD/perf of ps/wmic polling | detector only on activity nudge (no loop); per-terminal debounce ≥1s; serialize execFile; short-TTL cache |
| Watching `~/.claude/projects` broadly | watch only active `<ENC>` dirs, de-duped, `depth:0`, FSEvents; close on unregister |
| Reading outside project root | new external watcher bypasses DirectoryWatcherService deliberately; reads hard-restricted to `~/.claude/projects/**` + `~/.claude/settings.json`; resolve+prefix-assert |
| node-pty pid edge | guard undefined → "no claude"; `__ERFANA_TEST_PTY__` mock supplies pid |
| Multi-panel store | dedicated `useClaudeStatusStore` keyed by terminalId; existing store untouched |
| Transcript-format volatility | tolerant parser, fail-closed to null (hides), format assumptions isolated in one file + fixtures |
| Windows process-walk quoting | PowerShell `ConvertTo-Csv`, match name AND command line, dedicated fixtures; unsupported arch → no-op |
| settings.json absent/malformed | window-detector treats read/parse failure as no `[1m]` → `used>200k` else 200k; never throws |

## 8. Security (Phase 7 pre-notes)

- Path traversal: ENC built only from an already-absolute cwd; locator `path.resolve` + assert prefixed child of `~/.claude/projects/` before any read; settings.json is a single fixed path. Never accept renderer-supplied paths.
- execFile injection: pid passed as numeric arg after `Number.isInteger`; `execFile` (no `shell:true`), fixed binary, `{timeout:5000}`.
- Read-only Claude config: only `readFile` under `~/.claude/projects/**` and `~/.claude/settings.json`; **no writes anywhere under `~/.claude`**.
- Untrusted transcript data: coerce tokens via `Number()`+finite-check; render model id as plain text (React auto-escape); ignore unexpected fields.
- IPC: validate `event.senderFrame` (top-level + dev/`file://`), `terminalId` string, `pid` positive integer.
- No error leakage: all failures → `snapshot:null`; sanitized messages; raw paths never sent to renderer.

## 9. Acceptance-criteria coverage

| AC | Covered by |
|---|---|
| Bar shows name/badge/percent/bar while claude runs; hidden otherwise | process detector + parser + ClaudeStatusBar mount gating |
| Green/amber/red + hover exact-token tooltip | thresholds + ClaudeStatusBar + UX spec |
| Two panels same folder → per-panel via process inspection (mac+win) | per-OS detector keyed by PTY pid + per-terminalId snapshot |
| Transcript missing/unparseable → hides gracefully, no config writes | fail-closed parser/locator → snapshot:null; read-only guarantee |
| No regression to terminal behavior; minimal ~26px reflow | additive sibling; unmount-to-hide; existing stores untouched |
| ~~Two panels same folder via process inspection (mac+win)~~ | macOS only in v1 (Windows AC → follow-up); per-panel via PTY-pid process walk + the matched process's live cwd |

## 10. Lens-review remediations (design v2 — authoritative delta)

All adopted from the 5-lens review. Items conflicting with §2–§9 are superseded here.

### Scope & cwd (QG-4 decisions)
- **macOS-only v1.** Implement `MacClaudeProcessDetector`; `createProcessDetector` returns a no-op `{running:false}` detector on all non-macOS platforms. Drop `WinClaudeProcessDetector` from v1 (→ Windows follow-up issue). All PowerShell/ConPTY/Windows-encoding findings move to that follow-up.
- **Live cwd from process.** New `getProcessCwd(pid)` on the macOS detector via `lsof -a -p <pid> -d cwd -Fn` (execFile, numeric pid, `{timeout:5000}`, cached per detect). Transcript dir = `ENC(liveCwd ?? spawnCwd)`. Fixes the cwd-staleness blocker.

### Security (all adopted)
- **realpath guard:** after selecting the newest `*.jsonl`, `fs.realpath` it and assert it is still a prefixed child of the once-resolved `fs.realpath(~/.claude/projects)` root (defeats symlink escape). `lstat` each readdir entry; **skip symlinks and non-regular files**; enforce a size cap before read.
- **No renderer-supplied pid.** `registerPanel`/IPC take **only `terminalId`**; the main process looks up the PTY pid it created via `TerminalService.getPid(terminalId)`. Removes the arbitrary-process-probe primitive and the auth gap. (`pid` is never sent over IPC.)
- **cwd from main-owned terminal record only**, never the renderer; `path.resolve` + reject NUL/newline/control chars before encoding.
- **Untrusted model id:** bound `modelId` length (≤64) and strip control chars/newlines in `friendlyModelName` before it reaches text/`aria-label`/logs (React escaping covers HTML/XSS only).
- **settings.json:** `JSON.parse` inside try/catch only, size-bounded read, never `require`/dynamic-import; parse/read failure → default 200k.
- **Model-capability registry (window detection, design v3 — supersedes §2 "hybrid" wording):** window detection now resolves cheap-first — `modelNativelySupportsExtended(modelId)` (Opus 4.6+ auto-1M; Sonnet/Haiku/older → false; unparseable id → false, safe 200k default) **OR** `used > 200_000` **OR** settings.json `[1m]`. The two in-memory predicates run **before** the settings.json read (PERF-2: no file I/O on the known-1M / over-threshold common path). The registry predicate is defensive (lowercase/trim, regex `^claude-opus-(\d+)-(\d+)`, `maj>4 || (maj===4 && min>=6)`, plus a `claude-mythos-preview` allowlist entry). **Accepted rare-enterprise limitation:** a 200k-capped Opus deployment (Microsoft Foundry Opus 4.8) is over-stated as 1M — we accept the rare over-statement to fix the common auto-upgraded under-statement (the #216 UAT bug).

### Architecture (all adopted)
- **Targeted send, not broadcast.** Push `claude-status:changed` to the owning `webContents` for that `terminalId` only (guarded by `isDestroyed()`), not `broadcastToAllWindows`.
- **Idempotent lifecycle.** Single idempotent `unregisterPanel` (safe to double-call) that closes/decrements the watcher entry, cancels the per-terminal debounce timer, and clears the process cache. `cleanupForWebContentsId` iterates all terminals for that wc (handles window-close/HMR where unmount doesn't fire). Preload `onChanged` returns an unsubscribe that removes the **wrapper** reference (mirror `terminal.onData`).
- **Per-terminal generation guard.** Stamp each `refresh` with a per-terminal monotonically increasing seq captured at start; drop the broadcast if a newer refresh started or the panel re-registered. Stale-guard is a **service-level** invariant, not watcher-only — fixes the push/poll race.
- **Watcher owns the dir set** behind a narrow `watchDir/unwatchDir/onChanged` interface (DIP); de-dup/refcount lives entirely in the watcher.
- **Store selector contract:** `ClaudeStatusBar` selects only its slice — `useClaudeStatusStore(s => s.byTerminalId.get(terminalId) ?? null)`; Map updated immutably per key.
- **Schema:** `pid` is internal-only (not in IPC); `ClaudeStatusSnapshot` unchanged. `terminal:create` response gains nothing renderer-facing for pid.

### Performance (all adopted)
- **Tail/incremental read.** Track `(size, mtime)` per session file; on change, `createReadStream({ start: lastSize })` (or read final N KB) and parse only new lines; cache the last snapshot and recompute from the delta. Size cap with fail-open-to-cached. No whole-file re-read per event.
- **Watch the single active `*.jsonl` file** (re-resolve on session change) rather than the dir, OR add an `ignored` predicate dropping `subagents/` and non-active files — so excluded/sidechain writes never trigger a reparse and FSEvents subtree cost is bounded.
- **Refcount watchers** by `<ENC>` dir with a `Set<terminalId>` (+ `webContentsId`); `close()` only when the set empties (mirror `DirectoryWatcherService`).
- **Single serialized `refresh()` queue per terminal** with in-flight de-dup (queue-latest); both file-change and activity-nudge funnel into it. Defines precedence when both coincide.
- **macOS BFS short-circuits** as soon as a `claude` descendant is found.

### Cross-platform (macOS items adopted; Windows → follow-up)
- **Match on args, not `comm`.** macOS detector uses `ps -axo pid,ppid,command` (or `args`) and matches the full argv for a `claude` token (path ending `/claude`, or `claude` as the CLI arg), so node-launched `claude` is detected and the truncated-`comm` miss is avoided. Fixtures for both `claude` and `node …/claude`.
- **`os.homedir()`** for the `~/.claude` base (never a literal `~`); build all paths with `path.join`; prefix-assert via `path.resolve(child).startsWith(path.resolve(base) + path.sep)`.
- **node-pty pid** guarded `undefined → "no claude"` (fail-closed); logged once in the macOS smoke test.

### UX / accessibility (all adopted)
- **`role="meter"`** (not `progressbar`) with `aria-valuemin/max/now` + `aria-valuetext` ("48% used, 84k of 200k tokens"). The meter element (or its label) stays mounted across **all** narrow-panel breakpoints — only the visual track/badge collapse, never the accessible value.
- **Tooltip 1.4.13.** Bar stays non-interactive/non-focusable per the issue's settled "display-only" stance; the exact-count gap for keyboard/non-SR low-vision users is **documented as a known v1 limitation**, and the visible % + `aria-valuetext` carry the essential data so exact tokens are a convenience. If the tooltip ships, give it a small hoverable close-delay + Escape-dismiss; otherwise rely solely on `aria-valuetext` parity.
- **aria-live hysteresis.** Announce only on band transitions, require ~N ms in the new band before announcing (debounce 69↔70 oscillation), and announce a concise delta ("context now 90% — red") rather than re-emitting the full label. Mount the live region empty and populate after a tick to avoid an unsolicited on-launch announcement.
- **Badge contrast:** badge text uses `--color-text-primary` on `--color-bg-tertiary` (9.54:1); component test asserts contrast against the **chip** surface, not the rail.

### Follow-up issue — Windows support ([#217](https://github.com/qodeca/erfana/issues/217)) — ✅ IMPLEMENTED
- **Original ask:** verify the Windows cwd→ENC encoding (drive letter / backslash) and the ConPTY parent-process chain against a live Windows host; implement `WinClaudeProcessDetector` (`Get-CimInstance Win32_Process` via `powershell.exe -NoProfile -NonInteractive`, pid as a parameter not interpolated, higher cache TTL for PowerShell cold-start) and platform-branched `encodeCwd` + Windows process-cwd best-effort.
- **Final approach as shipped:**
  - `process/WinClaudeProcessDetector.ts` — a **single static** `powershell.exe -NoProfile -NonInteractive` `Get-CimInstance Win32_Process` query returning a JSON snapshot; BFS over the process tree from the panel's PTY pid to find a `claude` descendant; **fail-closed**. **No pid interpolation** — `powershell.exe` is resolved by absolute path off `%SystemRoot%` and spawned with cwd pinned to `System32` (DLL-plant defense). **8s liveness-cache TTL** (vs the macOS detector's per-detect call) absorbs PowerShell cold-start cost.
  - **Start-time floor:** the same snapshot's `CreationDate` is projected to epoch ms (`StartMs`) and used as the transcript `minMtimeMs` floor — same anti-"% already filled on launch" guarantee as macOS, without a second probe.
  - **node-launched `claude` (`node …/cli.js`):** matched via a whole-command-line anchored-suffix fallback (parity with the macOS argv match), so node-hosted launches are detected.
  - `exec.ts` — shared `ExecLike` type extracted from the macOS detector for test injection.
  - `encodeCwd.ts` — platform-branched: Windows replaces `/`, `\`, `:`, `.` with `-` (verified against live `~/.claude/projects`: `C:\Users\x\Projects\erfana` → `C--Users-x-Projects-erfana`).
  - `createProcessDetector.ts` — `win32` → `WinClaudeProcessDetector`; Linux remains a no-op.
- **Known v1 Windows limitations (recorded honestly):**
  - **Live cwd not resolved.** Windows v1 does not read Claude's *live* working directory (no `lsof` analog wired), so it falls back to the panel's **spawn cwd** — the bar hides if the user `cd`s to a different folder before launching `claude`.
  - **Same-folder shared transcript.** Two `claude` sessions in the same folder share the transcript dir (newest-wins selection); per-panel liveness is still independent.
  - **Unusual quoting edge case.** A `node`-launched `cli.js` path with spaces is handled by the anchored-suffix fallback, but an edge case with unusual quoting may still miss (parity with the macOS whitespace-split limitation).
  - **Live-host verification still pending.** The ConPTY parent-chain and two-panel behavior on a real Windows host (the issue's AC-2 / AC-4 "verify on a live host" items) still warrant manual verification; not yet done.

### 10.1 Post-review hardening (lens-review of #217)

A 6-lens review of the #217 code (all findings non-blocking; security posture verified sound) drove a hardening pass. Notable behavioral/structural deltas:

- **Shared detector base.** `AbstractClaudeProcessDetector` now owns the descendant BFS, `isValidPid`, and the liveness cache; `Mac`/`Win` detectors supply only their OS-specific probe + match. Removes the prior near-verbatim duplication (drift risk).
- **Liveness cache correctness.** The cache is now **single-flight** (concurrent callers on one pid share one probe instead of dog-piling the PowerShell/ps spawn), **transient-error-aware** (a spawn/timeout failure is NOT cached for the full TTL — the next call retries; only a completed snapshot's negative is cached), and **bounded** (`forget(pid)` is called on `unregisterPanel`, plus a size-cap sweep). Per-OS TTL divergence (macOS 4s, Windows 8s for cold-start) is intentional and now expressed as a subclass field.
- **Post-compaction display.** Two fixes: (a) the bar shows ~0% after a compaction (existing #217 fix); (b) **sticky 1M window** — once a session is observed at the 1M window, a post-compaction token reset can no longer shrink the badge 1M→200k. The sticky bit was later **scoped to the current model** (`da5637c`): it is a per-terminal bit reset on pid change, a model-id switch, or an explicit standard `/model` override, so a mid-session model switch (Opus 1M → Sonnet 200k → Opus 1M) still re-evaluates the window in both directions while an unchanged model keeps the no-flicker guarantee. Window *detection* still runs on the real pre-compaction token count. The parser also retries a **full read** once when a large compaction summary evicts the relevant turn from the 256 KB tail window, so `justCompacted` degrades only when even the full file has no post-compaction turn.
- **Inferred Windows cwd→ENC encoding.** The win32 `/ \ : . → -` rule is INFERRED from on-disk observation, not a documented Claude Code contract, and is lossy/non-injective. The locator now tries the primary encoding plus a normalized alternate (trailing-separator-stripped) via `candidateProjectDirs`, so a trailing-separator cwd no longer silently hides the bar. All alternates derive from the same cwd (no cross-project mismatch).
- **PowerShell query robustness.** The per-row `StartMs` projection is UTC-explicit (`.ToUniversalTime()`) and wrapped in try/catch so one unparseable `CreationDate` yields a null `StartMs` rather than blanking the whole snapshot. Array shape is guaranteed by `parseWin32Processes` normalization, not the `@(...)` wrapper (5.1 unrolls single-element arrays).
