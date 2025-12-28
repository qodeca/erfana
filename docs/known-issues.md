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

**Solution**: Use correct path:
```typescript
import 'dockview/dist/styles/dockview.css'  // ✅ Correct
```

---

## electron-store ES Module Import

**Issue**: electron-store v11+ is an ES Module and cannot be imported with `require()` in CommonJS

**Error**:
```
ERR_REQUIRE_ESM: require() of ES Module not supported
```

**Solution**: Use dynamic `import()` instead:
```typescript
export class SettingsService {
  private store: any
  private storePromise: Promise<any>

  constructor() {
    this.storePromise = import('electron-store').then((module) => {
      const ElectronStore = module.default
      this.store = new ElectronStore<Settings>({
        name: 'erfana-settings'
      })
      return this.store
    })
  }

  private async ensureStore(): Promise<any> {
    if (!this.store) await this.storePromise
    return this.store
  }

  async getLastProjectPath(): Promise<string | null> {
    const store = await this.ensureStore()
    return store.get('lastProjectPath') || null
  }
}
```

**Pattern**: All SettingsService methods must be async to handle dynamic import.

**Files**:
- `src/main/services/SettingsService.ts`
- `src/main/ipc/file-handlers.ts` (must await settingsService calls)

---

## ESLint Peer Dependency Warnings

**Issue**: ESLint 9 vs ESLint 8 peer dependencies

**Impact**: None (warnings only)

**Action**: Ignore warnings; electron-toolkit will update

---

## Panel Close Button CSS Selectors

**Status**: No longer applicable after v0.1.0 architectural refactoring

**Previous Issue**: CSS used `:has()` selector for hiding close buttons on protected panels

**Current State**: New SplitviewReact architecture handles panel visibility through API rather than hiding close buttons. This issue is resolved by the architectural change.

**Browser Support Note**: Electron uses recent Chromium which supports `:has()` if needed elsewhere

---

See: [Architecture](./architecture.md) | [UI Components](./ui-components.md)
