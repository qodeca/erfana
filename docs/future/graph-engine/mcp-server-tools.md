# MCP server – overview and tools

> This is part 1 of the MCP server documentation, split for readability.
>
> **Other parts:**
> - [MCP server – implementation and deployment](./mcp-server-implementation.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document explains how ERFANA exposes the Graph Engine to Claude Code via the Model Context Protocol (MCP), enabling Claude Code to query project knowledge for better coding assistance.

---

## Overview

### What is MCP?

**Model Context Protocol (MCP)** is a standard protocol for exposing tools and resources to AI assistants like Claude Code.

**Key concepts:**
- **Server:** Exposes tools (e.g., ERFANA graph engine)
- **Client:** AI assistant that uses tools (e.g., Claude Code)
- **Tools:** Functions that client can invoke (e.g., `erfana_graph_search`)
- **Resources:** Static content that client can read (e.g., docs, schemas)

### Why expose graph engine via MCP?

**Problem:** Claude Code (running in Terminal panel) has no knowledge of your project's documentation.

**Solution:** Expose graph engine as MCP server → Claude Code can query knowledge graph → better code suggestions.

**Example workflow:**

```
User: "Claude, implement a search feature"

Claude Code:
  1. Queries MCP: erfana_graph_search("search implementation")
  2. Finds: docs/search-design.md, docs/hybrid-search.md
  3. Reads context from graph engine
  4. Generates code matching your documented architecture
```

**Value:**
- Claude Code understands your project without manual copying
- Contextual coding assistance based on your docs
- Semantic search across project knowledge

---

## Architecture

### System diagram

```
┌────────────────────────────────────────────────────────────────┐
│                     ERFANA (Electron App)                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                 Main Process (Node.js)                   │  │
│  │                                                           │  │
│  │  ┌───────────────────────────────────────────────────┐  │  │
│  │  │           GraphEngineService                       │  │  │
│  │  │  - Hybrid search (BM25 + vector)                   │  │  │
│  │  │  - Entity management                               │  │  │
│  │  │  - Backlinks & timeline queries                    │  │  │
│  │  └───────────────────┬───────────────────────────────┘  │  │
│  │                      │                                    │  │
│  │                      ▼                                    │  │
│  │  ┌───────────────────────────────────────────────────┐  │  │
│  │  │           MCPServerService                         │  │  │
│  │  │  - Exposes GraphEngineService as MCP tools        │  │  │
│  │  │  - Handles MCP protocol (stdio transport)         │  │  │
│  │  │  - Security & rate limiting                       │  │  │
│  │  └───────────────────┬───────────────────────────────┘  │  │
│  │                      │                                    │  │
│  └──────────────────────┼────────────────────────────────────┘  │
│                         │ stdio (IPC)                           │
└─────────────────────────┼───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│            Claude Code (Running in Terminal Panel)              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    MCP Client                             │  │
│  │  - Connects to ERFANA MCP server (stdio)                 │  │
│  │  - Invokes tools: erfana_graph_search, etc.              │  │
│  │  - Receives results from graph engine                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  User: "Implement a search feature based on our docs"           │
│  Claude Code: [Queries MCP] → [Gets context] → [Generates code]│
└─────────────────────────────────────────────────────────────────┘
```

### Communication flow

```
1. ERFANA starts MCP server (MCPServerService) on stdio
   │
   ▼
2. Claude Code detects ERFANA MCP server (auto-discovery)
   │
   ▼
3. Claude Code sends MCP request:
   {
     "method": "tools/call",
     "params": {
       "name": "erfana_graph_search",
       "arguments": { "query": "search implementation", "k": 10 }
     }
   }
   │
   ▼
4. MCPServerService receives request
   │
   ▼
5. MCPServerService calls GraphEngineService.search(...)
   │
   ▼
6. GraphEngineService returns results
   │
   ▼
7. MCPServerService sends MCP response:
   {
     "result": {
       "results": [
         { "path": "docs/search-design.md", "heading": "...", "text": "..." },
         ...
       ]
     }
   }
   │
   ▼
8. Claude Code processes results → generates code
```

---

## MCP tools

### Tool definitions

ERFANA exposes 5 MCP tools (aligned with [user-guide-features.md](./user-guide-features.md)):

#### 1. `erfana_graph_search`

**Purpose:** Hybrid BM25 + vector search.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Search query" },
    "k": { "type": "number", "description": "Number of results", "default": 10 },
    "filters": {
      "type": "object",
      "properties": {
        "folder": { "type": "string", "description": "Filter by folder path" },
        "afterTimestamp": { "type": "number", "description": "Unix timestamp (ms)" }
      }
    }
  },
  "required": ["query"]
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "section_id": { "type": "number" },
          "path": { "type": "string" },
          "heading": { "type": "string" },
          "text": { "type": "string" },
          "score": { "type": "number" }
        }
      }
    }
  }
}
```

#### 2. `erfana_graph_related`

**Purpose:** Find sections related to a specific section.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "sectionId": { "type": "number", "description": "Section ID" },
    "k": { "type": "number", "description": "Number of results", "default": 10 }
  },
  "required": ["sectionId"]
}
```

**Output:** Same as `erfana_graph_search`.

#### 3. `erfana_graph_entities`

**Purpose:** List entities (with optional filters).

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Filter by name" },
    "type": { "type": "string", "description": "Filter by type" },
    "limit": { "type": "number", "description": "Max results", "default": 50 }
  }
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "entities": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "number" },
          "name": { "type": "string" },
          "type": { "type": "string" }
        }
      }
    }
  }
}
```

#### 4. `erfana_graph_backlinks`

**Purpose:** Get backlinks for an entity.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "entityName": { "type": "string", "description": "Entity name" },
    "limit": { "type": "number", "description": "Max results", "default": 50 }
  },
  "required": ["entityName"]
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "backlinks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "section_id": { "type": "number" },
          "path": { "type": "string" },
          "heading": { "type": "string" },
          "text": { "type": "string" }
        }
      }
    }
  }
}
```

#### 5. `erfana_graph_timeline`

**Purpose:** Get temporal timeline for entity or file.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "entityId": { "type": "number", "description": "Entity ID" },
    "fileId": { "type": "number", "description": "File ID" },
    "asOf": { "type": "number", "description": "Unix timestamp for as-of query" }
  }
}
```

**Output Schema:**
```json
{
  "type": "object",
  "properties": {
    "timeline": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "valid_from": { "type": "number" },
          "valid_to": { "type": "number" },
          "src_entity": { "type": "string" },
          "dst_entity": { "type": "string" },
          "type": { "type": "string" }
        }
      }
    }
  }
}
```

---

## See also

- [MCP server – implementation and deployment](./mcp-server-implementation.md) – server code, client usage, security, deployment
- [User Guide](./user-guide-features.md) – Claude Code integration workflows
- [Architecture](./architecture-overview.md) – MCP server in system design
