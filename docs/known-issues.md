# Known Issues & Workarounds

Current issues and their workarounds. For historical resolved issues, see [archive/resolved-issues.md](./archive/resolved-issues.md).

---

## Windows-specific issues

Phases 0–2 of Windows enablement shipped in **v0.9.3** (merged 2026-04-22). The following gaps remain user-visible until Phases 3–6 ship. See [`docs/windows/implementation-plan.md`](./windows/implementation-plan.md) for the canonical roadmap.

### SmartScreen warning on first launch

**Issue**: First-time launch of the NSIS installer triggers a Windows SmartScreen warning (`Windows protected your PC`) because Erfana is not yet code-signed.

**Workaround**: Right-click the `.exe` → Properties → Unblock; OR click "More info → Run anyway" in the SmartScreen dialog.

**Tracking**: [#166](https://github.com/qodeca/erfana/issues/166) (Phase 5 — code-signing).

---

### `npm run test:cov` exits 1 on Windows

**Issue**: All tests pass but vitest's v8 coverage aggregator hits an `ENOENT` race on Windows NTFS during the `coverage/.tmp` cleanup step. Wrapper exits with code 1 even though the test suite is green.

**Workaround**: Run `npx vitest --run --config vitest.main.ts --coverage` directly (exits 0). On macOS the wrapper exits 0 normally.

**Tracking**: [#158](https://github.com/qodeca/erfana/issues/158) (Phase 6 — switch coverage provider to Istanbul OR reduce parallelism on Windows).

---

### Long paths (>260 chars) require user opt-in

**Issue**: File operations on paths longer than 260 chars fail unless the user enabled the Win32 long-paths group-policy setting. The `isWindowsLongPath` helper that would auto-prefix `\\?\` is dead code.

**Workaround**: Enable Win32 long paths per [`docs/build/windows.md`](./build/windows.md) step 5 + `git config --global core.longpaths true`.

**Tracking**: [#163](https://github.com/qodeca/erfana/issues/163) (decision-deferred to Phase 6 with promotion criteria recorded inline at `PlatformConfig.ts:194-201`).

---

### Local Whisper transcription unavailable on Windows

**Issue**: `WhisperModelManager.getArchSuffix()` throws on `process.platform !== 'darwin'`. Both model download and transcription fail with a clear error.

**Workaround**: Use the OpenAI API transcription backend (Settings → Transcription → Backend → OpenAI API). Cross-platform, requires API key.

**Tracking**: [#165](https://github.com/qodeca/erfana/issues/165) (Phase 4 — port whisper.cpp Windows binaries).

---

### cmd.exe terminals can leak pre-bootstrap text into scrollback after aggressive resizing

**Issue**: On Windows, ConPTY keeps its own screen buffer and re-emits the buffer contents back through the PTY stream on every terminal resize. The Git Bash and PowerShell bootstraps emit a full CSI 2J / CSI 3J / CSI H sequence after the startup marker so ConPTY's buffer is wiped before the interactive shell takes over, leaving nothing for a later reflow to replay. cmd.exe can only clear the visible viewport (`cls` → CSI 2J + CSI H); `CSI 3J` (scrollback clear) isn't available from cmd without spawning a child process. In rare cases, a user who opens a fresh cmd.exe terminal and immediately drags the panel splitter may see faint reflowed pwd / marker text appear in scrollback history (not the visible viewport).

**Workaround**: Set `$env:SHELL` to `pwsh.exe` or Git Bash (`C:\Program Files\Git\usr\bin\bash.exe`) before launching Erfana — both emit the full three-sequence clear and have no scrollback-reflow leak.

**Tracking**: Known limitation; not tracked as a bug. Could be closed by invoking `powershell.exe -NoProfile -Command "[Console]::Write(...)"` from the cmd bootstrap, at the cost of one extra process spawn per terminal creation.

---

### Screenshot capture unavailable on Windows

**Issue**: `ScreenshotService.ts` is gated `process.platform !== 'darwin'`; the entire screenshot button is non-functional on Windows.

**Workaround**: Use the OS-native screenshot tools (Win+Shift+S Snipping Tool); paste image path into the terminal manually.

**Tracking**: [#164](https://github.com/qodeca/erfana/issues/164) (Phase 3 — Electron `desktopCapturer` strategy + area-selection overlay).

---

## Active Issues

### Git Status: Global .gitignore not supported

**Issue**: Files ignored via global gitignore (`~/.gitignore_global` or `~/.config/git/ignore`) may appear as "untracked" in the project tree git status indicators.

**Root cause**: isomorphic-git only reads local `.gitignore` files. Does not support global gitignore. Known library limitation.

**Workaround**: Add patterns to the project's local `.gitignore` file instead of global config.

**Tracking**: https://github.com/isomorphic-git/isomorphic-git/issues/444

---

### Large repositories: EMFILE on repos with 50K+ files

**Issue**: Repos with 50K+ tracked files (e.g., monorepos with Git LFS) can exhaust the system file descriptor limit, causing the directory watcher to hit EMFILE and freeze the app.

**Root cause**: chokidar directory watcher + git watcher + terminal PTY together consume most available FDs. On large repos, this exceeds the system FD limit (~10K on macOS).

**Mitigation (v0.9.0)**: Git status now runs in a worker thread (#147) and uses native `git status --porcelain` for repos with `.git/index` > 5 MB. When FD pressure causes EBADF, the worker returns a transient error instead of cascading. The EMFILE restart cascade was also fixed (#146).

**Remaining**: The directory watcher itself still consumes too many FDs on very large repos. Mitigated by `.erfana/settings.json` ignore patterns.

**Workaround**: Use `.erfana/settings.json` to ignore large subdirectories:
```json
{ "watcher": { "ignoreList": { "mode": "extend", "patterns": ["large-folder"] } } }
```

---

### node-pty Build Failure

**Issue**: Fails to build on Python 3.13 (missing `distutils`)

**Error**:
```
ModuleNotFoundError: No module named 'distutils'
```

**Workaround**:
- Terminal functionality may be limited
- Use external terminal if needed
 

**Solution**:
- Downgrade to Python 3.12, OR
- Wait for node-pty update

**Tracking**: https://github.com/microsoft/node-pty/issues

---

### Template ID System

**Issue**: Template IDs derived from slugified display names is fragile.

**Current Implementation**:
```typescript
// parser.ts
const id = slugify(result.data.name)  // Derives ID from name
```

**Problem**:
- Changing template name breaks all code references
- `name: "Mermaid Bug Report"` → `id: "mermaid-bug-report"`
- Code must look up by derived ID: `PROMPT_REGISTRY['mermaid-bug-report']`
- Fragile coupling between display name and programmatic identifier

**Example Issue:**
```yaml
# Template frontmatter
---
name: Report Mermaid Error  # Slugifies to "report-mermaid-error"
---
```
```typescript
// Code reference
const config = PROMPT_REGISTRY['mermaid-bug-report']  // WRONG ID!
// Returns undefined because actual ID is "report-mermaid-error"
```

**Recommended Solution**:
Add explicit `id` field to frontmatter:
```yaml
---
id: mermaid-bug-report    # Explicit, stable identifier
name: Mermaid Bug Report  # Display name (can change freely)
---
```

**Implementation Steps**:
1. Add `id` field to `PromptFrontmatterSchema` (schema.ts)
2. Update parser to use explicit ID instead of slugify
3. Add uniqueness validation in registry
4. Migrate all existing templates (explain, improve, rewrite, simplify, mermaid-bug-report)
5. Remove slugify function

**Status**: Architecture review complete, implementation pending.

**See**: [Prompt Templates](./prompts/README.md)

---

## Dockview CSS Import Path

**Issue**: Vite cannot resolve `dockview/dist/styles.css`

**Solution**: Use `import 'dockview/dist/styles/dockview.css'` (note the `/styles/` in path).

---

## electron-store ES Module Import

**Issue**: electron-store v11+ is an ES Module and cannot be imported with `require()` in CommonJS.

**Solution**: Use dynamic `import()`. All SettingsService methods are async to handle this.

**Pattern**: `constructor()` calls `import('electron-store')`, stores the promise. All methods await `ensureStore()` before accessing the store.

**Files**: `src/main/services/SettingsService.ts`, `src/main/ipc/file-handlers.ts`

---

## ESLint Peer Dependency Warnings

**Issue**: ESLint 9 vs ESLint 8 peer dependencies. **Impact**: None (warnings only). Ignore.

---

See: [Architecture](./architecture.md) | [UI Components](./ui-components.md)
