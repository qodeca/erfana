# Known Issues & Workarounds

Current issues and their workarounds. For historical resolved issues, see [archive/resolved-issues.md](./archive/resolved-issues.md).

---

## Active Issues

### Git Status: Global .gitignore Not Supported

**Issue**: Files ignored via global gitignore (`~/.gitignore_global` or `~/.config/git/ignore`) may appear as "untracked" in the Project Tree git status indicators.

**Root Cause**: isomorphic-git only reads local `.gitignore` files. It does not support global gitignore configuration. This is a known limitation of the library.

**Impact**: Low. Most ignore patterns are in the local `.gitignore`. Only users with global patterns will see unexpected "untracked" badges.

**Workaround**: Add patterns to the project's local `.gitignore` file instead of global config.

**Tracking**: https://github.com/isomorphic-git/isomorphic-git/issues/444

**Files**: `src/main/services/GitStatusService.ts`

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
4. Migrate all existing templates (elaborate, improve, rewrite, simplify, mermaid-bug-report)
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
