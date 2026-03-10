# User guide – features and workflows

> This is part 1 of the user guide, split for readability.
>
> **Other parts:**
> - [User guide – UI, Claude Code, and troubleshooting](./user-guide-ui-troubleshooting.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This guide explains what the Erfana Graph Engine is, how to use it, and what value it provides for your markdown documentation workflow.

---

## What is the graph engine?

The Erfana Graph Engine is an **intelligent knowledge system** that automatically indexes your markdown documentation and provides AI-powered search, contextual recommendations, and relationship tracking.

### The problem it solves

When working on large documentation projects, you face challenges:

- **"Where else did I mention this concept?"** → Hard to find related content manually
- **"What's similar to what I'm writing?"** → No way to discover semantically related sections
- **"Who depends on this component?"** → Difficult to track relationships and impact
- **"How has this evolved over time?"** → No timeline of changes to concepts
- **"How can Claude Code understand my project?"** → No structured knowledge for AI assistants

### The solution

The Graph Engine automatically:

1. **Indexes** all markdown files in your project
2. **Understands** semantic meaning using vector embeddings
3. **Tracks** entities, relationships, and temporal changes
4. **Surfaces** relevant information while you write
5. **Exposes** knowledge to Claude Code via MCP server

**Result:** You write better docs faster, with AI-powered research assistance built into your IDE.

---

## Key features

### 1. Related sidebar (research assistant)

**What it does:** Shows sections from your project that are similar to what you're currently editing.

**How it works:**
- Analyzes your current file or selected text
- Uses hybrid search (keyword + semantic similarity)
- Displays top-10 most relevant sections with citations

**Value:**
- Discover related content without manual searching
- Avoid duplicate documentation
- Find inspiration from similar sections
- Insert cross-references easily

**Example:**
```
You're editing: docs/architecture.md (mentions "SQLite", "React")
Related Sidebar shows:
  1. docs/database.md - "Using SQLite for storage" (score: 0.92)
  2. docs/tech-stack.md - "Frontend: React 18" (score: 0.87)
  3. docs/performance.md - "SQLite query optimization" (score: 0.81)
```

### 2. Global search (better than grep)

**What it does:** Hybrid BM25 + vector search that understands meaning, not just keywords.

**How it works:**
- Type query in search box
- System combines keyword matching (BM25) with semantic similarity (vectors)
- Ranks results by relevance (configurable weights)

**Value:**
- Find content even if it uses different wording (synonyms, paraphrases)
- Better ranking than grep or traditional FTS5
- Discover conceptually related content

**Example:**
```
Query: "How do I make search faster?"

Traditional search (grep/FTS5):
  - Matches "search" and "faster" keywords
  - Misses "optimize query performance" (different words)

Hybrid search (Graph Engine):
  - Matches "search faster" keywords
  - ALSO finds "optimize query performance" (semantically similar)
  - Ranks by combined BM25 + vector similarity
```

### 3. Knowledge panel & backlinks (Obsidian-like navigation)

**What it does:** Shows entities mentioned in current section and where else they're referenced.

**How it works:**
- Extracts entities (e.g., `[[SQLite]]`, `#database`, `@username`)
- Tracks mentions across your project
- Displays backlinks (reverse references)

**Value:**
- Navigate your knowledge graph like Obsidian
- Understand impact of changes (what depends on this?)
- Discover connections between concepts

**Example:**
```
Current section mentions:
  - Entity: "SQLite" (database)
  - Entity: "FTS5" (technology)

Backlinks for "SQLite":
  - docs/architecture.md (4 mentions)
  - docs/performance.md (2 mentions)
  - docs/data-model.md (1 mention)
```

### 4. Timeline queries (time-travel for knowledge)

**What it does:** View how entities and relationships evolved over time.

**How it works:**
- Temporal graph tracks when facts became true/false
- "As-of" queries show knowledge at any point in history
- Timeline slider in UI

**Value:**
- Understand how architecture changed
- Audit trail for decisions
- Detect contradictions (e.g., "still using sqlite-vss?" vs "migrated to sqlite-vec")

**Example:**
```
Timeline for "ERFANA" entity:

2023-06-01: uses React
2024-01-01: uses sqlite-vss
2024-10-01: uses sqlite-vec (sqlite-vss closed)

Query "as of 2024-03-01": ERFANA used sqlite-vss
Query "as of 2024-11-01": ERFANA uses sqlite-vec
```

### 5. Claude Code integration (MCP server)

**What it does:** Exposes graph engine to Claude Code (running in Terminal panel) via MCP server.

**How it works:**
- ERFANA runs MCP server in background
- Claude Code connects as MCP client
- Claude can query graph for context

**Value:**
- Claude Code gets project knowledge automatically
- Better code suggestions based on documentation
- Contextual coding assistance

**Example:**
```
You: "Claude, implement a search feature"

Claude Code:
  1. Queries MCP: erfana_graph_search("search implementation")
  2. Finds: docs/search-design.md, docs/performance.md
  3. Reads context from graph engine
  4. Generates code matching your existing architecture
```

---

## Getting started

### Automatic indexing

**Graph engine starts automatically when you open a project:**

1. Open project in ERFANA (File → Open Project)
2. Graph engine detects all `.md` files
3. Indexing starts in background (see status indicator)
4. Wait for completion (usually 1-5 minutes for 10K files)

**Status indicator:**
- **Green dot**: Indexing complete, graph engine ready
- **Yellow dot**: Indexing in progress
- **Red dot**: Error (check logs)

### First-time setup

**No configuration required!** Default settings work for most projects.

**Optional tuning (Settings panel):**
- Adjust hybrid search weights (α for BM25, β for vectors)
- Trigger manual re-index (if files changed externally)
- Enable binary quantization (for >100K documents)

---

## User workflows

### Workflow 1: Research while writing

**Scenario:** You're writing a new section and want to reference existing content.

**Steps:**

1. Open file in editor (e.g., `docs/new-feature.md`)
2. Start writing about a topic (e.g., "SQLite integration")
3. **Related Sidebar automatically updates** with similar sections
4. Click result to open in new tab
5. Copy relevant snippet or insert cross-reference link

**Result:** You write comprehensive docs without leaving your flow.

### Workflow 2: Semantic search

**Scenario:** You remember writing about "performance" but forgot the exact file.

**Steps:**

1. Open Global Search (Cmd+Shift+F)
2. Type query: "optimize database queries"
3. Graph engine searches hybrid (BM25 + vectors)
4. Results show:
   - Exact matches ("optimize", "database", "queries")
   - Semantic matches ("improve SQLite performance", "tune FTS5")
5. Click result to jump to file

**Result:** You find content even if you use different words.

### Workflow 3: Backlink navigation

**Scenario:** You're editing `docs/sqlite.md` and want to know what depends on it.

**Steps:**

1. Open Knowledge Panel (right sidebar)
2. See entities: `[[SQLite]]`, `[[FTS5]]`, `[[WAL mode]]`
3. Click `[[SQLite]]`
4. Knowledge Panel shows backlinks:
   - `docs/architecture.md` (uses SQLite)
   - `docs/performance.md` (SQLite benchmarks)
   - `docs/data-model.md` (SQLite schema)
5. Click backlink to navigate

**Result:** You understand the full context of what you're editing.

### Workflow 4: Coding with Claude Code

**Scenario:** You want Claude Code to implement a feature based on your docs.

**Steps:**

1. Open Terminal panel (Cmd+J)
2. Start Claude Code session
3. Ask: "Implement a search service based on our architecture docs"
4. **Claude Code uses MCP to query graph engine:**
   - `erfana_graph_search("search architecture")`
   - Finds: `docs/search-design.md`, `docs/hybrid-search.md`
5. Claude generates code matching your documented patterns

**Result:** Claude Code understands your project without you copying docs manually.

### Workflow 5: Timeline review

**Scenario:** You want to audit how your tech stack changed over time.

**Steps:**

1. Open Timeline UI (Settings → Timeline)
2. Select entity: "ERFANA"
3. View timeline:
   - 2023-06: Started using React
   - 2024-01: Added sqlite-vss
   - 2024-10: Migrated to sqlite-vec
4. Use slider to query "as of 2024-03-01"
5. See: ERFANA used sqlite-vss (before migration)

**Result:** You have a complete audit trail of architectural decisions.

---

## See also

- [User guide – UI, Claude Code, and troubleshooting](./user-guide-ui-troubleshooting.md) – UI components, Claude Code integration details, best practices, troubleshooting
- [Data Ingestion](./data-ingestion-discovery.md) – How files are indexed
- [MCP Server](./mcp-server-tools.md) – Technical details on Claude Code integration
- [Implementation Guide](./implementation-guide.md) – For developers building the system
