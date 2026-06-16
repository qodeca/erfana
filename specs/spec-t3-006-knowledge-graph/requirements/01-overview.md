# Overview

> 📐 **Design context**: historical design exploration lives at [`docs/future/graph-engine/`](../../../docs/future/graph-engine/) — entity extraction, graph traversal, wireframes. This spec is the authoritative requirement source.

## Summary

Spec #006 delivers a knowledge graph system that extracts entities from markdown content using rule-based pattern matching (wikilinks, tags, mentions, technical terms), builds a graph database with entities, edges, and mentions tables, and enables Obsidian-like backlink navigation for discovering connections between documents.

This feature corresponds to **Milestone 3 (M3)** of the Graph Engine specification and builds upon the database foundation established in Spec #004.

## Purpose

Markdown workspaces often contain implicit connections between documents through mentions of entities (people, concepts, technologies) that users may not be aware of. Without explicit tooling, these relationships remain hidden, making it difficult to:

- Understand what other documents reference a particular concept
- Assess the impact of changing a section that defines a key entity
- Navigate between related documents efficiently

The Knowledge Graph system addresses these challenges by:

1. **Automatically extracting entities** from markdown using recognizable patterns
2. **Building a persistent graph** that tracks entity relationships and mentions
3. **Providing backlink navigation** similar to Obsidian and Roam Research
4. **Enabling impact analysis** to understand dependencies between sections

## Scope

### In Scope

- **Graph schema**: Three tables (`entities`, `edges`, `mentions`) extending Spec #004 database
- **Rule-based entity extraction**: Wikilinks `[[Entity]]`, tags `#tag`, mentions `@user`, technical terms
- **Entity storage**: Upsert logic with deduplication by (name, type) pair
- **Mention linking**: Character position tracking (start_char, end_char) for highlighting
- **Backlinks API**: Query "where else is entity X mentioned?" with recency sorting
- **Impact analysis**: Forward/reverse graph traversal for dependency discovery
- **Knowledge Panel UI**: Sidebar with Entities tab and Backlinks tab
- **MCP tools**: `erfana_graph_entities` and `erfana_graph_backlinks` for Claude Code

### Out of Scope

- Semantic entity matching (covered by Spec #005 vector search)
- Natural language entity extraction (NER) - rule-based patterns only
- Entity relationship types beyond mentions (e.g., "is-a", "part-of" hierarchies)
- Cross-workspace entity linking
- Entity editing or manual graph manipulation

## Dependencies

| Spec | Dependency Type | Description |
|-----|-----------------|-------------|
| Spec #004 | Required | Database layer, sections table, indexing infrastructure |
| Spec #005 | Optional | Enables semantic entity matching via vector similarity |

## Success Criteria

1. **Entity extraction accuracy**: >95% precision for wikilinks, tags, and mentions patterns
2. **Extraction performance**: <50ms per section for entity extraction
3. **Backlinks query performance**: <100ms for retrieving backlinks for any entity
4. **Scalability**: Handle 100,000+ entities without degradation
5. **User adoption**: Knowledge Panel used in >30% of editing sessions (measured via telemetry)
6. **Developer integration**: MCP tools successfully invoked by Claude Code for entity queries
