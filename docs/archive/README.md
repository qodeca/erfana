# Documentation Archive

This directory contains historical or future specification documents that are not part of active development.

## Contents

### graph-engine-spec-2025/
**Archived**: December 2025
**Status**: Draft specification (October 2025)
**Reason**: Speculative future feature marked as "NOT READY FOR DEVELOPMENT"

Complete specification for a local-first knowledge graph system with hybrid search capabilities (BM25 + vector similarity). Includes:
- Architecture and data model
- Embedding pipeline and vector search
- MCP server integration
- Production readiness checklist
- Implementation guide (M1-M5 milestones)

**Total**: ~7,330 lines of detailed technical specifications

**Why Archived**:
- Marked as work-in-progress with no development timeline
- Consumed 33% of documentation tokens without immediate value
- Full specifications preserved in git history
- Can be restored if/when feature development begins

## Restoring Archived Documentation

To restore archived documentation to active docs:
```bash
# Example: Restore graph-engine specs
mv docs/archive/graph-engine-spec-2025 docs/future/graph-engine
```

## Git History

All archived documents remain in git history. Use `git log` to view changes:
```bash
git log --all -- docs/archive/graph-engine-spec-2025/
```
