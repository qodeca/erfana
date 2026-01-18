# Architecture decision records (ADRs)

Architectural decisions documented for Erfana project.

## Index

### Implemented features (archived BRS)

#### BRS-001: Unified in-file search ✅
- [ADR-BRS001-001](adr-brs001-001-unified-search.md) - Unified search architecture
- [ADR-BRS001-002](adr-brs001-002-search-selection-population.md) - Search selection population

#### BRS-003: Real-time git status ✅
- [ADR-BRS003-001](adr-brs003-001-git-watcher-architecture.md) - Git watcher architecture
- [ADR-BRS003-002](adr-brs003-002-git-status-logging-strategy.md) - Git status logging strategy
- [ADR-BRS003-003](adr-brs003-003-git-status-architecture-improvements.md) - Architecture improvements

#### BRS-010: Multi-instance ✅
- [ADR-BRS010-001](adr-brs010-001-multi-instance-architecture.md) - Multi-instance architecture

#### BRS-011: UI testing ✅
- [ADR-BRS011-001](adr-brs011-001-ui-test-architecture.md) - UI test compatibility architecture

#### BRS-012: External file drop ✅
- [Code Review](../code-review-drag-drop-2025-01.md) - External file drop architecture review

### Planned features (draft BRS)

#### BRS-009: Media import
- [ADR-BRS009-001](adr-brs009-001-media-import-transcription.md) - Media import with transcription

### Code refactoring
- [ADR-C001](adr-c001-markdown-editor-panel-decomposition.md) - MarkdownEditorPanel decomposition

## ADR format

Each ADR follows this structure:

```markdown
# adr-{id}-{title}
**Date:** YYYY-MM | **Status:** Proposed|Accepted|Deprecated

## Context
[Problem description and background]

## Options
[Alternatives considered with pros/cons]

## Decision
[Chosen approach and rationale]

## Consequences
[Impact of the decision]
```

---

See: [Architecture](../architecture.md) | [BRS Registry](../../specs/business-reqs/registry.json)
