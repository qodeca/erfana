# MCP Server Integration

> ⚠️ **WORK IN PROGRESS - NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document explains how ERFANA exposes the Graph Engine to Claude Code via the Model Context Protocol (MCP), enabling Claude Code to query project knowledge for better coding assistance.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [MCP Tools](#mcp-tools)
4. [Server Implementation](#server-implementation)
5. [Client Usage (Claude Code)](#client-usage-claude-code)
6. [Security & Rate Limiting](#security--rate-limiting)
7. [Deployment](#deployment)

---

## Overview

### What is MCP?

**Model Context Protocol (MCP)** is a standard protocol for exposing tools and resources to AI assistants like Claude Code.

**Key concepts:**
- **Server:** Exposes tools (e.g., ERFANA graph engine)
- **Client:** AI assistant that uses tools (e.g., Claude Code)
- **Tools:** Functions that client can invoke (e.g., `erfana_graph_search`)
- **Resources:** Static content that client can read (e.g., docs, schemas)

### Why Expose Graph Engine via MCP?

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

### System Diagram

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

### Communication Flow

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

## MCP Tools

### Tool Definitions

ERFANA exposes 5 MCP tools (aligned with [user-guide.md](./user-guide.md)):

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

## Server Implementation

### MCPServerService

**File:** `src/main/services/MCPServerService.ts`

```typescript
import { MCPServer } from '@modelcontextprotocol/sdk';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/transports';

export class MCPServerService {
  private server: MCPServer;
  private transport: StdioServerTransport;

  constructor(
    private graphEngine: GraphEngineService,
    private rateLimiter: RateLimiter
  ) {
    this.setupServer();
  }

  private setupServer(): void {
    // Create MCP server
    this.server = new MCPServer({
      name: 'erfana-graph-engine',
      version: '1.0.0'
    });

    // Register tools
    this.registerTools();

    // Setup stdio transport
    this.transport = new StdioServerTransport();
    this.server.connect(this.transport);

    console.log('[MCP] Server started on stdio');
  }

  private registerTools(): void {
    // Tool 1: Search
    this.server.addTool({
      name: 'erfana_graph_search',
      description: 'Hybrid BM25 + vector search across project documentation',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          k: { type: 'number', description: 'Number of results', default: 10 },
          filters: { type: 'object' }
        },
        required: ['query']
      }
    }, async (params) => {
      // Rate limiting
      if (!this.rateLimiter.allow('search')) {
        throw new Error('Rate limit exceeded');
      }

      // Call graph engine
      const results = await this.graphEngine.search({
        q: params.query,
        k: params.k || 10,
        filters: params.filters
      });

      return { results };
    });

    // Tool 2: Related
    this.server.addTool({
      name: 'erfana_graph_related',
      description: 'Find sections related to a specific section',
      inputSchema: {
        type: 'object',
        properties: {
          sectionId: { type: 'number' },
          k: { type: 'number', default: 10 }
        },
        required: ['sectionId']
      }
    }, async (params) => {
      if (!this.rateLimiter.allow('related')) {
        throw new Error('Rate limit exceeded');
      }

      const results = await this.graphEngine.related({
        sectionId: params.sectionId,
        k: params.k || 10
      });

      return { results };
    });

    // Tool 3: Entities
    this.server.addTool({
      name: 'erfana_graph_entities',
      description: 'List entities (concepts, technologies, people)',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          type: { type: 'string' },
          limit: { type: 'number', default: 50 }
        }
      }
    }, async (params) => {
      if (!this.rateLimiter.allow('entities')) {
        throw new Error('Rate limit exceeded');
      }

      const entities = await this.graphEngine.entities.find({
        q: params.query,
        type: params.type,
        limit: params.limit || 50
      });

      return { entities };
    });

    // Tool 4: Backlinks
    this.server.addTool({
      name: 'erfana_graph_backlinks',
      description: 'Get backlinks (reverse references) for an entity',
      inputSchema: {
        type: 'object',
        properties: {
          entityName: { type: 'string' },
          limit: { type: 'number', default: 50 }
        },
        required: ['entityName']
      }
    }, async (params) => {
      if (!this.rateLimiter.allow('backlinks')) {
        throw new Error('Rate limit exceeded');
      }

      const backlinks = await this.graphEngine.backlinks(params.entityName, params.limit || 50);

      return { backlinks };
    });

    // Tool 5: Timeline
    this.server.addTool({
      name: 'erfana_graph_timeline',
      description: 'Get temporal timeline for entity or file',
      inputSchema: {
        type: 'object',
        properties: {
          entityId: { type: 'number' },
          fileId: { type: 'number' },
          asOf: { type: 'number' }
        }
      }
    }, async (params) => {
      if (!this.rateLimiter.allow('timeline')) {
        throw new Error('Rate limit exceeded');
      }

      const timeline = await this.graphEngine.timeline({
        entityId: params.entityId,
        fileId: params.fileId,
        asOf: params.asOf
      });

      return { timeline };
    });
  }

  async shutdown(): Promise<void> {
    await this.server.close();
    console.log('[MCP] Server stopped');
  }
}
```

### Auto-Start on ERFANA Launch

**File:** `src/main/index.ts`

```typescript
import { MCPServerService } from './services/MCPServerService';

let mcpServer: MCPServerService;

app.whenReady().then(() => {
  // ... existing initialization ...

  // Start MCP server
  mcpServer = new MCPServerService(graphEngineService, rateLimiter);
  console.log('[Main] MCP server started');
});

app.on('quit', async () => {
  await mcpServer.shutdown();
});
```

---

## Client Usage (Claude Code)

### Auto-Discovery

Claude Code automatically discovers MCP servers running on stdio.

**How it works:**

1. ERFANA starts → MCP server starts on stdio
2. Claude Code detects ERFANA process
3. Claude Code connects to MCP server
4. Tools become available in Claude Code context

**No manual configuration required!**

### Example: Claude Code Workflow

**User prompt:** "Implement a search feature based on our architecture docs"

**Claude Code internal workflow:**

```typescript
// 1. Query graph engine for search-related docs
const searchDocs = await useMcpTool('erfana_graph_search', {
  query: 'search architecture implementation',
  k: 5
});

// searchDocs.results:
// [
//   { path: 'docs/search-design.md', heading: 'Hybrid Search', text: '...' },
//   { path: 'docs/architecture.md', heading: 'SearchService', text: '...' },
//   ...
// ]

// 2. Extract entities mentioned in docs
const entities = await useMcpTool('erfana_graph_entities', {
  query: 'search',
  limit: 10
});

// entities.entities:
// [
//   { name: 'BM25', type: 'algorithm' },
//   { name: 'sqlite-vec', type: 'library' },
//   { name: 'hybrid search', type: 'concept' }
// ]

// 3. Get backlinks for key entity
const backlinks = await useMcpTool('erfana_graph_backlinks', {
  entityName: 'hybrid search',
  limit: 10
});

// backlinks.backlinks:
// [
//   { path: 'docs/performance.md', heading: 'Search Benchmarks', text: '...' },
//   ...
// ]

// 4. Synthesize code based on context
const code = generateSearchService({
  docs: searchDocs,
  entities: entities,
  related: backlinks
});

// Output to user:
"I've implemented a SearchService based on your architecture:

```typescript
export class SearchService {
  constructor(
    private db: GraphDatabaseService,
    private embedder: EmbedderService
  ) {}

  async search(query: string, k: number = 10): Promise<SearchResult[]> {
    // Based on docs/search-design.md: Use hybrid BM25 + vector
    const bm25Results = await this.bm25Search(query, k);
    const vectorResults = await this.vectorSearch(query, k);
    return this.fuseResults(bm25Results, vectorResults);
  }

  // ... implementation ...
}
```

This matches your documented architecture using BM25 (FTS5) and sqlite-vec."
```

### Manual Testing (MCP Inspector)

**For development/debugging:**

```bash
# Install MCP inspector
npm install -g @modelcontextprotocol/inspector

# Test ERFANA MCP server
mcp-inspector erfana
```

**Interface:** Opens web UI showing available tools, schemas, and allows manual tool invocation.

---

## Security & Rate Limiting

### Security Considerations

**Threat model:**
- Claude Code is **trusted** (runs in user's Terminal, same security boundary as ERFANA)
- No external network access (stdio transport only)
- No authentication required (single-user, local-only)

**Mitigations:**

1. **Input validation:** Validate all tool parameters (schema enforcement)
2. **Rate limiting:** Prevent abuse (e.g., 100 queries/minute)
3. **Sandboxing:** Graph engine only reads data (no file writes via MCP)

### Rate Limiter

**File:** `src/main/services/RateLimiter.ts`

```typescript
export class RateLimiter {
  private counters = new Map<string, { count: number; resetAt: number }>();

  private limits = {
    search: { max: 100, window: 60000 }, // 100 queries per minute
    related: { max: 100, window: 60000 },
    entities: { max: 50, window: 60000 },
    backlinks: { max: 50, window: 60000 },
    timeline: { max: 20, window: 60000 }
  };

  allow(tool: string): boolean {
    const limit = this.limits[tool];
    if (!limit) return true; // No limit configured

    const now = Date.now();
    const counter = this.counters.get(tool);

    if (!counter || counter.resetAt < now) {
      // Reset counter
      this.counters.set(tool, { count: 1, resetAt: now + limit.window });
      return true;
    }

    if (counter.count >= limit.max) {
      return false; // Rate limit exceeded
    }

    counter.count++;
    return true;
  }
}
```

**Usage:** Reject MCP request if rate limit exceeded.

---

## Deployment

### M1 Checklist

- [ ] MCPServerService implemented
- [ ] 5 MCP tools registered (search, related, entities, backlinks, timeline)
- [ ] Auto-start on ERFANA launch
- [ ] Claude Code auto-discovery working
- [ ] Rate limiting configured
- [ ] Error handling (graceful failures, don't crash app)

### Testing

**Manual test:**

1. Start ERFANA
2. Open Terminal panel (Cmd+J)
3. Start Claude Code session
4. Ask: "What entities are in my project?"
5. Claude Code should query `erfana_graph_entities` → list entities

**Expected output:**
```
"Your project contains the following entities:
- SQLite (database)
- React (library)
- FTS5 (technology)
- ... (10 total entities shown)"
```

---

**Related:**
- [User Guide](./user-guide.md) - Claude Code integration workflows
- [Architecture](./architecture.md) - MCP server in system design
- [Implementation Guide](./implementation-guide.md) - M1 MCP server tasks
