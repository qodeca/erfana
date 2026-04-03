# Known Issues & Workarounds

Current issues and their workarounds. For historical resolved issues, see [archive/resolved-issues.md](./archive/resolved-issues.md).

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
