# Overview

> 📐 **Design context**: historical design exploration lives at [`docs/future/graph-engine/`](../../../docs/future/graph-engine/) — ONNX worker pipelines, embedding architecture, vector search internals. This spec is the authoritative requirement source.

## Summary

Vector Search & Hybrid Retrieval extends the Graph Engine with semantic search capabilities through vector embeddings. This feature enables finding conceptually related content even when exact keywords differ, by computing similarity between document embeddings using the all-MiniLM-L6-v2 model and sqlite-vec extension.

The hybrid search approach combines BM25 keyword scores with vector similarity using configurable weights, providing the best of both lexical and semantic matching. Users can tune the fusion weights through a settings UI to optimize results for their specific use cases.

## Purpose

Traditional keyword search (BM25) excels at finding exact matches but fails when users describe concepts using different terminology. Vector embeddings capture semantic meaning, enabling queries like "user authentication" to find documents about "login flow" or "credential validation."

This feature adds:

1. **Semantic understanding** - Find related content based on meaning, not just keywords
2. **Hybrid ranking** - Combine keyword precision with semantic recall for optimal results
3. **Claude Code integration** - MCP tool `erfana_graph_related` for AI-powered document exploration
4. **Tunable fusion** - Settings UI for weight adjustment based on use case

## Scope

### In scope (Milestone M2)

- sqlite-vec extension integration with better-sqlite3
- ONNX embedding worker with all-MiniLM-L6-v2 model
- Worker pool management (2-4 concurrent workers)
- Text chunking with overlap (256-384 tokens, 10-15% overlap)
- Vector similarity search (L2 distance)
- Hybrid search fusion with configurable weights
- Settings UI for weight tuning
- MCP tool: `erfana_graph_related`

### Out of scope (Future milestones)

- Entity extraction and entity graph (M3)
- Temporal analysis and document linking (M4)
- Cross-project search federation
- Custom embedding models
- GPU acceleration

## Dependencies

- **Spec #004** (Graph Engine Foundation) - Requires database infrastructure, file indexing pipeline, and sections table

## Success criteria

1. **Semantic search works** - Finding related documents when keywords differ but meaning is similar
2. **Performance targets met** - Embedding throughput >100 chunks/sec, search latency <100ms at 100K documents
3. **Hybrid fusion improves relevance** - Combined results outperform keyword-only or vector-only search
4. **Worker stability** - Crash recovery within 5s, no memory leaks under sustained load
5. **MCP integration complete** - `erfana_graph_related` tool available and rate-limited
