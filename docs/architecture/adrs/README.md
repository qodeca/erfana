# Architecture decision records (ADRs)

Architectural decisions documented for Erfana project.

## Index

### Implemented features (archived specs)

#### Spec #001: Unified in-file search ✅
- [ADR-Spec001-001](adr-spec-001-001-unified-search.md) - Unified search architecture
- [ADR-Spec001-002](adr-spec-001-002-search-selection-population.md) - Search selection population

#### Spec #003: Real-time git status ✅
- [ADR-Spec003-001](adr-spec-003-001-git-watcher-architecture.md) - Git watcher architecture
- [ADR-Spec003-002](adr-spec-003-002-git-status-logging-strategy.md) - Git status logging strategy
- [ADR-Spec003-003](adr-spec-003-003-git-status-architecture-improvements.md) - Architecture improvements

#### Spec #010: Multi-instance ✅
- [ADR-Spec010-001](adr-spec-010-001-multi-instance-architecture.md) - Multi-instance architecture

#### Spec #011: UI testing ✅
- [ADR-Spec011-001](adr-spec-011-001-ui-test-architecture.md) - UI test compatibility architecture

#### Spec #012: External file drop ✅
- [Code Review](../code-review-drag-drop-2025-01.md) - External file drop architecture review

#### Spec #014: Camera capture ✅
- [ADR-Spec014-001](adr-spec-014-001-camera-capture.md) - Camera photo capture architecture

### Planned features (draft specs)

#### Spec #009: Media import
- [ADR-Spec009-001](adr-spec-009-001-media-import-transcription.md) - Media import with transcription

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

See: [Architecture](../architecture.md) | [Spec registry](../../specs/registry.json)
