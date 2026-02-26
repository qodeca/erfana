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
4. Migrate all existing templates (elaborate, improve, rewrite, simplify, mermaid-bug-report)
5. Remove slugify function

**Implementation Files**:
- `src/renderer/src/prompts/schema.ts` - Add `id` field to `PromptFrontmatterSchema`
- `src/renderer/src/prompts/parser.ts` - Use explicit ID
- `src/renderer/src/prompts/registry.ts` - Add uniqueness validation
- Template files in `resources/prompts/*.md` - Add `id` field

**Status**: Architecture review complete, implementation pending.

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

**Note**: docs/future/ (8,604 lines) preserved for future graph-engine implementation.

---

## Resolved Issues

All major issues resolved in recent versions. See [Known Issues](./known-issues.md) for complete history:

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

**Last Updated**: v0.7.2 (February 2026)
