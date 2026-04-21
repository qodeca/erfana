# Technical Debt

Concise summary of unresolved technical issues and improvement opportunities in Erfana.

## Active Issues

### 1. node-pty Build Failure on Python 3.13

**Severity**: Medium
**Impact**: Terminal functionality unavailable on Python 3.13+

**Problem**: node-pty dependency requires `distutils` module, removed in Python 3.13.

**Workaround**: Downgrade to Python 3.12 or earlier.

**Solution**: Wait for upstream node-pty update or contribute fix.

**Tracking**: https://github.com/microsoft/node-pty/issues

---

### 2. Template ID System Fragility

**Severity**: Low
**Impact**: Template name changes break code references

**Problem**: Template IDs are derived from slugified display names:

```typescript
// parser.ts
const id = slugify(result.data.name)  // "Mermaid Bug Report" → "mermaid-bug-report"
```

**Issues**:
- Changing template name breaks all code references
- Fragile coupling between display name and programmatic identifier
- No compile-time safety for ID references

**Example**:
```yaml
# Template frontmatter
---
name: Report Mermaid Error  # Slugifies to "report-mermaid-error"
---
```
```typescript
// Code reference
const config = PROMPT_REGISTRY['mermaid-bug-report']  // Returns undefined!
```

**Recommended Solution**:
1. Add explicit `id` field to frontmatter schema
2. Update parser to use explicit ID instead of slugify
3. Add uniqueness validation in registry
4. Migrate all existing templates (explain, improve, rewrite, simplify, mermaid-bug-report)
5. Remove slugify function

**Implementation Files**:
- `src/renderer/src/prompts/schema.ts` - Add `id` field to `PromptFrontmatterSchema`
- `src/renderer/src/prompts/parser.ts` - Use explicit ID
- `src/renderer/src/prompts/registry.ts` - Add uniqueness validation
- Template files in `resources/prompts/*.md` - Add `id` field

**Status**: Architecture review complete, implementation pending.

---

### 3. BaseDialog lacks Tab-cycling focus trap

**Severity**: Low
**Impact**: Only TranscriptionDialog has proper Tab cycling; all other dialogs allow Tab to escape the dialog.

**Problem**: BaseDialog's comment says "Focus trap" but the code only auto-focuses the first element – it does NOT cycle Tab/Shift+Tab within the dialog. TranscriptionDialog implements its own `handleFocusTrap` to work around this.

**Recommended Solution**: Move TranscriptionDialog's Tab-cycling logic into BaseDialog so all dialogs benefit.

**Files**: `src/renderer/src/components/Dialog/BaseDialog.tsx`, `src/renderer/src/components/Transcription/TranscriptionDialog.tsx`

---

### 4. LanguageSelect missing `id` for label association

**Severity**: Low
**Impact**: `htmlFor="transcription-lang"` on the label references a non-existent `id` on `<select>`. Label click doesn't focus the select.

**Fix**: Add `id="transcription-lang"` to `<select>` in `LanguageSelect.tsx`.

---

## Code Quality Improvements

### Documentation Token Efficiency

Ongoing effort to keep `docs/` concise and high-value for Claude Code.

**Completed**:
- Archive outdated architectural-review/ ✅
- Condense logging.md (525 → 239 lines) ✅
- Condense terminal/README.md (code examples → tables) ✅
- Condense CHANGELOG.md (old versions compressed) ✅

**Remaining**:
- Consolidate troubleshooting files (troubleshooting.md + troubleshooting-advanced.md)
- Reduce code example verbosity across remaining files
- Evaluate inlining of small editor stubs — `docs/editor/{toolbar.md, scroll-sync.md, monaco-configuration.md}` (40/53/60 lines). Deferred from Sprint 3: external inbound refs to `scroll-sync.md` from `docs/archive/resolved-issues.md:70` and `docs/rendering/README.md:42` would require anchor repointing; benefit (single file) vs cost (README bloat + link-break risk) currently balanced. Promotion criteria: when touching editor docs for any other reason (Phase 3+ UI work), re-evaluate the consolidation cost.

**Note**: docs/future/ (8,604 lines) preserved for future graph-engine implementation.

---

## Resolved Issues

- ✅ Worker thread statusCache crash (v0.9.2) – persistent isomorphic-git cache caused V8 cppgc assertion after ~42 min; replaced with per-call cache
- ✅ Git status main-thread blocking (v0.9.0, #147) – offloaded to worker_threads with native git fallback
- ✅ EMFILE cascade in DirectoryWatcherService (v0.9.0, #146) – restart logic + RateLimitedLogger
- ✅ Terminal Scroll Jump (v0.3.1)
- ✅ Terminal Flickering (v0.3.2)
- ✅ EPIPE Errors (v0.4.0)
- ✅ Panel Resizing (v0.1.0)
- ✅ Monaco Editor CDN Loading
- ✅ Scroll Synchronization (v0.3.0)
- ✅ Plain Code Block Rendering (v0.3.0)

---

## Future Enhancements

### Graph Engine (Planned)

**Status**: Research complete, implementation pending

**Overview**: SQLite-based knowledge graph with hybrid search for markdown documents.

**Documentation**: See [docs/future/graph-engine.md](./future/graph-engine.md) for complete design.

**Key Features**:
- Full-text search with FTS5
- Vector embeddings for semantic search
- Graph relationships between documents
- Tag and metadata indexing

**Priority**: High (killer feature for future version)

---

## Related Documentation

- [Known Issues](./known-issues.md) - Complete issue history with solutions
- [Troubleshooting](./troubleshooting.md) - Common problems and fixes
- [Architecture](./architecture.md) - System design and patterns
- [Testing](./testing/README.md) - Test coverage and strategies

---

**Last Updated**: v0.9.0 (April 2026)
