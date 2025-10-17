# Embedding Pipeline

> ⚠️ **WORK IN PROGRESS - NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

This document covers the end-to-end embedding pipeline: from raw markdown text to normalized vectors stored in SQLite, including ONNX Runtime integration, worker thread patterns, and stability considerations.

---

## Table of Contents

1. [Pipeline Overview](#pipeline-overview)
2. [Text Preprocessing](#text-preprocessing)
3. [Tokenization](#tokenization)
4. [Chunking Strategy](#chunking-strategy)
5. [ONNX Runtime Integration](#onnx-runtime-integration)
6. [Worker Thread Architecture](#worker-thread-architecture)
7. [Batch Processing](#batch-processing)
8. [Vector Normalization](#vector-normalization)
9. [Error Handling & Recovery](#error-handling--recovery)
10. [Model Selection](#model-selection)

---

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          EMBEDDING PIPELINE                          │
└─────────────────────────────────────────────────────────────────────┘

1. Raw Markdown
   └─▶ "# Introduction

This is **bold** text with [link](url)."

2. Text Preprocessing
   └─▶ Strip markdown syntax, preserve meaning
   └─▶ "Introduction

This is bold text with link."

3. Tokenization
   └─▶ ["introduction", "this", "is", "bold", "text", "with", "link"]
   └─▶ Token IDs: [101, 4003, 2023, 2003, 8398, 3793, 2007, 4957, 102]

4. Chunking (256-384 tokens, 10-15% overlap)
   └─▶ Chunk 1: tokens[0:256]
   └─▶ Chunk 2: tokens[230:486] (26 token overlap)

5. Batching (32-128 chunks per batch)
   └─▶ Batch 1: [chunk1, chunk2, ..., chunk32]

6. ONNX Embedding (EmbedderWorker thread)
   └─▶ Input: token_ids (int64), attention_mask (int64)
   └─▶ Output: embeddings (float32) [batch_size, seq_len, hidden_dim]
   └─▶ Mean pooling: [batch_size, hidden_dim]

7. L2 Normalization
   └─▶ vec' = vec / ||vec||₂
   └─▶ Norm = 1.0 (unit vector)

8. Storage
   └─▶ INSERT INTO embeddings (...) RETURNING id
   └─▶ INSERT INTO vss_sections (rowid, embedding) VALUES (?, ?)
```

---

## Text Preprocessing

### Goals

1. **Preserve Meaning:** Keep semantic content (links, emphasis become plain text)
2. **Remove Noise:** Strip markdown syntax, code fences, HTML
3. **Normalize Whitespace:** Collapse multiple spaces/newlines

### Implementation

**File:** `src/main/services/TextPreprocessor.ts`

```typescript
export class TextPreprocessor {
  /**
   * Strip markdown syntax while preserving semantic meaning
   */
  static normalize(markdown: string): string {
    let text = markdown;

    // Remove YAML frontmatter
    text = text.replace(/^---
[\s\S]*?
---
/, '');

    // Remove code blocks (preserve inline code as text)
    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/`([^`]+)`/g, '$1'); // Inline code → plain text

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Remove images: ![alt](url) → alt
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

    // Remove links: [text](url) → text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Remove emphasis: **bold**, *italic* → text
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/\*([^*]+)\*/g, '$1');
    text = text.replace(/__([^_]+)__/g, '$1');
    text = text.replace(/_([^_]+)_/g, '$1');

    // Remove headings: ## Heading → Heading
    text = text.replace(/^#{1,6}\s+/gm, '');

    // Remove list markers: - item → item
    text = text.replace(/^\s*[-*+]\s+/gm, '');
    text = text.replace(/^\s*\d+\.\s+/gm, '');

    // Remove blockquotes: > quote → quote
    text = text.replace(/^\s*>\s+/gm, '');

    // Normalize whitespace
    text = text.replace(/
{3,}/g, '

'); // Max 2 consecutive newlines
    text = text.replace(/[ 	]+/g, ' '); // Collapse spaces
    text = text.trim();

    return text;
  }

  /**
   * Compute SHA-256 hash of normalized text (for deduplication)
   */
  static hash(text: string): string {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  }
}
```

### Example

**Input:**
```markdown
## Introduction

This is **bold** text with a [link](https://example.com).

- Item 1
- Item 2

> Quoted text

```js
console.log('code');
```
```

**Output:**
```
Introduction

This is bold text with a link.

Item 1
Item 2

Quoted text
```

---

## Tokenization

### Why Exact Tokenization Matters

Embedding models are trained with specific tokenizers. Using a different tokenizer breaks alignment between tokens and learned representations → poor quality embeddings.

**Example:** BERT-based models use WordPiece; GPT models use BPE. Mixing tokenizers causes:
- Token count mismatches (chunking breaks)
- Subword splits differ (semantic loss)
- Special tokens wrong (`[CLS]`, `[SEP]` positions)

### Tokenizer Setup

**Install:**

```bash
npm install @huggingface/tokenizers
```

**File:** `src/main/services/TokenizerService.ts`

```typescript
import { AutoTokenizer } from '@huggingface/tokenizers';

export class TokenizerService {
  private tokenizer: any;
  private maxLength: number;

  async initialize(modelId: string, maxLength: number = 512): Promise<void> {
    // Download tokenizer from Hugging Face Hub
    this.tokenizer = await AutoTokenizer.from_pretrained(modelId);
    this.maxLength = maxLength;
    console.log(`Tokenizer loaded: ${modelId}`);
  }

  /**
   * Tokenize text and return token IDs + count
   */
  tokenize(text: string): { ids: number[]; count: number } {
    const encoded = this.tokenizer.encode(text);
    return {
      ids: encoded.ids,
      count: encoded.ids.length
    };
  }

  /**
   * Batch tokenize (for embedding worker)
   */
  batchTokenize(texts: string[]): {
    input_ids: number[][];
    attention_mask: number[][];
  } {
    const encoded = this.tokenizer.batch_encode_plus(texts, {
      padding: true,
      truncation: true,
      max_length: this.maxLength
    });

    return {
      input_ids: encoded.input_ids,
      attention_mask: encoded.attention_mask
    };
  }
}
```

### Token Count Estimation

**Use exact tokenizer, not approximations:**

```typescript
// ❌ BAD: Approximate (unreliable)
const approxTokens = text.split(/\s+/).length * 1.3;

// ✅ GOOD: Exact tokenization
const { count } = tokenizerService.tokenize(text);
```

---

## Chunking Strategy

### Goals

1. **Fixed Size:** 256-384 tokens per chunk (fits model context window)
2. **Overlap:** 10-15% to preserve context across boundaries
3. **Semantic Boundaries:** Prefer splitting at sentence/paragraph breaks

### Implementation

**File:** `src/main/services/ChunkingService.ts`

```typescript
interface ChunkOptions {
  chunkSize: number; // e.g., 256
  overlapPercent: number; // e.g., 10 (= 10%)
}

export class ChunkingService {
  constructor(
    private tokenizerService: TokenizerService,
    private options: ChunkOptions
  ) {}

  /**
   * Split text into overlapping chunks
   */
  chunkText(text: string): Chunk[] {
    const { ids } = this.tokenizerService.tokenize(text);
    const { chunkSize, overlapPercent } = this.options;

    const overlapTokens = Math.floor(chunkSize * (overlapPercent / 100));
    const stride = chunkSize - overlapTokens;

    const chunks: Chunk[] = [];
    let start = 0;

    while (start < ids.length) {
      const end = Math.min(start + chunkSize, ids.length);
      const chunkIds = ids.slice(start, end);

      // Decode tokens back to text (for storage)
      const chunkText = this.tokenizerService.tokenizer.decode(chunkIds);

      chunks.push({
        text: chunkText,
        tokenIds: chunkIds,
        tokenCount: chunkIds.length,
        startToken: start,
        endToken: end
      });

      start += stride;
    }

    return chunks;
  }
}

interface Chunk {
  text: string;
  tokenIds: number[];
  tokenCount: number;
  startToken: number;
  endToken: number;
}
```

### Overlap Rationale

**Without overlap:**
```
Chunk 1: [0:256]    "...machine learning is used for"
Chunk 2: [256:512]  "pattern recognition and..."
                     ^ Context lost: "what" is used for pattern recognition?
```

**With 10% overlap (26 tokens):**
```
Chunk 1: [0:256]    "...machine learning is used for"
Chunk 2: [230:486]  "machine learning is used for pattern recognition and..."
                     ^ Context preserved
```

**Trade-off:** More overlap = better context but slower indexing (more chunks).

---

## ONNX Runtime Integration

### Why ONNX?

- **Local Execution:** No API calls, fully offline
- **Performance:** Native C++ inference (~10-20ms per 1K tokens)
- **Portability:** Same model runs on macOS/Linux/Windows
- **Flexibility:** Swap models without code changes

### Model Download

**Steps:**

1. Download ONNX model from Hugging Face Hub
2. Place in `resources/models/` folder
3. Load in worker thread

**Example (all-MiniLM-L6-v2):**

```bash
# Download from Hugging Face
wget https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx \
  -O resources/models/all-MiniLM-L6-v2.onnx

# Also download tokenizer files
wget https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json \
  -O resources/models/all-MiniLM-L6-v2-tokenizer.json
```

### ONNX Runtime Setup

**Install:**

```bash
npm install onnxruntime-node
```

**⚠️ Known Issue:** onnxruntime-node has stability issues with multiple concurrent workers (crashes randomly). **Limit to 2-4 workers max.**

**File:** `src/main/workers/embedder.worker.ts`

```typescript
import { parentPort, workerData } from 'worker_threads';
import * as ort from 'onnxruntime-node';
import { AutoTokenizer } from '@huggingface/tokenizers';

interface WorkerConfig {
  modelPath: string;
  tokenizerPath: string;
  maxLength: number;
}

class EmbedderWorker {
  private session: ort.InferenceSession;
  private tokenizer: any;

  async initialize(config: WorkerConfig): Promise<void> {
    // Load ONNX model
    this.session = await ort.InferenceSession.create(config.modelPath, {
      executionProviders: ['cpu'], // CPU-only (no GPU in Electron)
      graphOptimizationLevel: 'all'
    });

    // Load tokenizer
    this.tokenizer = await AutoTokenizer.from_pretrained(config.tokenizerPath);

    console.log(`[Worker ${workerData.workerId}] Model loaded`);
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    // Tokenize
    const encoded = this.tokenizer.batch_encode_plus(texts, {
      padding: true,
      truncation: true,
      max_length: 512
    });

    // Prepare ONNX inputs
    const inputIds = new ort.Tensor('int64',
      Int64Array.from(encoded.input_ids.flat()),
      [encoded.input_ids.length, encoded.input_ids[0].length]
    );

    const attentionMask = new ort.Tensor('int64',
      Int64Array.from(encoded.attention_mask.flat()),
      [encoded.attention_mask.length, encoded.attention_mask[0].length]
    );

    // Run inference
    const outputs = await this.session.run({
      input_ids: inputIds,
      attention_mask: attentionMask
    });

    // Extract embeddings (mean pooling)
    const embeddings = this.meanPooling(
      outputs.last_hidden_state.data as Float32Array,
      encoded.attention_mask,
      texts.length
    );

    return embeddings;
  }

  /**
   * Mean pooling: average token embeddings (weighted by attention mask)
   */
  private meanPooling(
    hiddenStates: Float32Array,
    attentionMask: number[][],
    batchSize: number
  ): Float32Array[] {
    const seqLen = attentionMask[0].length;
    const hiddenDim = hiddenStates.length / (batchSize * seqLen);

    const pooled: Float32Array[] = [];

    for (let i = 0; i < batchSize; i++) {
      const embedding = new Float32Array(hiddenDim);
      let tokenCount = 0;

      for (let j = 0; j < seqLen; j++) {
        if (attentionMask[i][j] === 1) {
          const offset = (i * seqLen + j) * hiddenDim;
          for (let k = 0; k < hiddenDim; k++) {
            embedding[k] += hiddenStates[offset + k];
          }
          tokenCount++;
        }
      }

      // Average
      for (let k = 0; k < hiddenDim; k++) {
        embedding[k] /= tokenCount;
      }

      pooled.push(embedding);
    }

    return pooled;
  }
}

// Worker message loop
const worker = new EmbedderWorker();

parentPort?.on('message', async (msg: any) => {
  try {
    switch (msg.type) {
      case 'initialize':
        await worker.initialize(msg.config);
        parentPort?.postMessage({ type: 'ready', workerId: workerData.workerId });
        break;

      case 'embed':
        const embeddings = await worker.embed(msg.texts);
        parentPort?.postMessage({
          type: 'result',
          requestId: msg.requestId,
          embeddings
        });
        break;

      case 'shutdown':
        process.exit(0);
        break;
    }
  } catch (error) {
    parentPort?.postMessage({
      type: 'error',
      requestId: msg.requestId,
      error: error.message
    });
  }
});
```

---

## Worker Thread Architecture

### Why Worker Threads?

- **Non-Blocking:** Keep main thread responsive (UI doesn't freeze)
- **Parallelism:** Batch process chunks concurrently
- **Isolation:** Crash in worker doesn't kill main process

### Worker Pool Management

**File:** `src/main/services/EmbedderWorkerPool.ts`

```typescript
import { Worker } from 'worker_threads';
import path from 'path';

interface EmbedRequest {
  requestId: string;
  texts: string[];
  resolve: (embeddings: Float32Array[]) => void;
  reject: (error: Error) => void;
}

export class EmbedderWorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private queue: EmbedRequest[] = [];
  private pendingRequests = new Map<string, EmbedRequest>();

  constructor(
    private workerCount: number = 2, // ⚠️ Limit to 2-4 due to onnxruntime-node crashes
    private modelPath: string,
    private tokenizerPath: string
  ) {}

  async initialize(): Promise<void> {
    const workerPath = path.join(__dirname, '../workers/embedder.worker.js');

    for (let i = 0; i < this.workerCount; i++) {
      const worker = new Worker(workerPath, {
        workerData: { workerId: i }
      });

      // Handle worker messages
      worker.on('message', (msg) => this.handleWorkerMessage(worker, msg));
      worker.on('error', (err) => this.handleWorkerError(worker, err));
      worker.on('exit', (code) => this.handleWorkerExit(worker, code));

      // Initialize worker
      worker.postMessage({
        type: 'initialize',
        config: {
          modelPath: this.modelPath,
          tokenizerPath: this.tokenizerPath,
          maxLength: 512
        }
      });

      this.workers.push(worker);
    }

    // Wait for all workers to be ready
    await this.waitForReady();
  }

  /**
   * Embed batch of texts (queues if no workers available)
   */
  embed(texts: string[]): Promise<Float32Array[]> {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const request: EmbedRequest = { requestId, texts, resolve, reject };

      if (this.availableWorkers.length > 0) {
        this.processRequest(request);
      } else {
        this.queue.push(request);
      }
    });
  }

  private processRequest(request: EmbedRequest): void {
    const worker = this.availableWorkers.pop()!;
    this.pendingRequests.set(request.requestId, request);

    worker.postMessage({
      type: 'embed',
      requestId: request.requestId,
      texts: request.texts
    });
  }

  private handleWorkerMessage(worker: Worker, msg: any): void {
    switch (msg.type) {
      case 'ready':
        this.availableWorkers.push(worker);
        console.log(`Worker ${msg.workerId} ready`);
        break;

      case 'result':
        const request = this.pendingRequests.get(msg.requestId);
        if (request) {
          request.resolve(msg.embeddings);
          this.pendingRequests.delete(msg.requestId);
          this.availableWorkers.push(worker);

          // Process queued requests
          if (this.queue.length > 0) {
            this.processRequest(this.queue.shift()!);
          }
        }
        break;

      case 'error':
        const errorRequest = this.pendingRequests.get(msg.requestId);
        if (errorRequest) {
          errorRequest.reject(new Error(msg.error));
          this.pendingRequests.delete(msg.requestId);
          this.availableWorkers.push(worker);
        }
        break;
    }
  }

  private handleWorkerError(worker: Worker, error: Error): void {
    console.error('Worker error:', error);
    // TODO: Restart worker, retry pending requests
  }

  private handleWorkerExit(worker: Worker, code: number): void {
    console.warn(`Worker exited with code ${code}`);
    // TODO: Restart worker if unexpected exit
  }

  async shutdown(): Promise<void> {
    for (const worker of this.workers) {
      worker.postMessage({ type: 'shutdown' });
    }
    this.workers = [];
    this.availableWorkers = [];
  }

  private async waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      const checkReady = () => {
        if (this.availableWorkers.length === this.workerCount) {
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    });
  }
}
```

### Concurrency Limits

**⚠️ CRITICAL:** onnxruntime-node crashes with >4 concurrent workers (GitHub issue #18790, March 2024).

**Recommended:**
- **Development:** 2 workers
- **Production:** 2-4 workers (monitor crash logs)
- **Alternative:** Consider `transformers.js` (wraps onnxruntime, better stability)

---

## Batch Processing

### Why Batching?

- **Throughput:** Process 32-128 chunks in one ONNX call (~50ms) vs 32-128 calls (~1.5s)
- **GPU Efficiency:** (if available) GPUs prefer larger batches

### Optimal Batch Size

| Model | Batch Size | Throughput (chunks/sec) | Memory |
|-------|-----------|-------------------------|--------|
| all-MiniLM-L6-v2 | 1 | 65 | 50MB |
| all-MiniLM-L6-v2 | 16 | 600 | 150MB |
| all-MiniLM-L6-v2 | 32 | 900 | 250MB |
| all-MiniLM-L6-v2 | 64 | 1100 | 450MB |
| all-MiniLM-L6-v2 | 128 | 1200 | 850MB |

**Recommendation:** Batch size 32-64 (diminishing returns beyond 64).

### Batching Implementation

**File:** `src/main/services/EmbeddingService.ts`

```typescript
export class EmbeddingService {
  constructor(
    private workerPool: EmbedderWorkerPool,
    private db: Database.Database,
    private batchSize: number = 32
  ) {}

  /**
   * Embed all chunks for a file (batched)
   */
  async embedFile(fileId: number, chunks: Chunk[]): Promise<void> {
    // Process in batches
    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch = chunks.slice(i, i + this.batchSize);
      const texts = batch.map(c => c.text);

      // Embed batch (parallel across workers)
      const embeddings = await this.workerPool.embed(texts);

      // Normalize + store
      const normalized = embeddings.map(e => this.normalize(e));

      this.storeBatch(fileId, batch, normalized);
    }
  }

  private storeBatch(
    fileId: number,
    chunks: Chunk[],
    embeddings: Float32Array[]
  ): void {
    const tx = this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        // Insert section
        const sectionResult = this.db.prepare(`
          INSERT INTO sections (file_id, text, text_hash, token_count, updated_at)
          VALUES (?, ?, ?, ?, ?)
          RETURNING id
        `).get(
          fileId,
          chunks[i].text,
          crypto.createHash('sha256').update(chunks[i].text).digest('hex'),
          chunks[i].tokenCount,
          Date.now()
        );

        const sectionId = sectionResult.id;

        // Insert embedding metadata
        const embeddingResult = this.db.prepare(`
          INSERT INTO embeddings (section_id, embedder_id, dim, created_at)
          VALUES (?, ?, ?, ?)
          RETURNING id
        `).get(sectionId, 'all-MiniLM-L6-v2:v1.0', 384, Date.now());

        // Insert vector
        const vectorBlob = Buffer.from(embeddings[i].buffer);
        this.db.prepare(`
          INSERT INTO vss_sections (rowid, embedding)
          VALUES (?, ?)
        `).run(embeddingResult.id, vectorBlob);
      }
    });

    tx();
  }
}
```

---

## Vector Normalization

### Why Normalize?

**L2 distance ≈ Cosine similarity** for normalized vectors:

```
cosine(a, b) = dot(a, b) / (||a|| * ||b||)

If ||a|| = ||b|| = 1 (normalized), then:
cosine(a, b) = dot(a, b)

L2(a, b)² = ||a - b||² = ||a||² + ||b||² - 2*dot(a, b)
                        = 1 + 1 - 2*dot(a, b)  (if normalized)
                        = 2 - 2*cosine(a, b)

Therefore: cosine(a, b) = 1 - L2(a, b)² / 2
```

**Benefit:** L2 distance is faster to compute than cosine (no division).

### Implementation

```typescript
function normalize(vector: Float32Array): Float32Array {
  // Compute L2 norm
  let norm = 0;
  for (let i = 0; i < vector.length; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);

  // Divide by norm (avoid division by zero)
  if (norm < 1e-12) {
    console.warn('Zero vector detected, skipping normalization');
    return vector;
  }

  const normalized = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    normalized[i] = vector[i] / norm;
  }

  return normalized;
}
```

**Validation:**

```typescript
const normalized = normalize(rawEmbedding);

// Check norm = 1.0 (within floating-point precision)
let norm = 0;
for (let i = 0; i < normalized.length; i++) {
  norm += normalized[i] * normalized[i];
}
norm = Math.sqrt(norm);

console.assert(Math.abs(norm - 1.0) < 1e-6, 'Vector not normalized');
```

---

## Error Handling & Recovery

### Worker Crashes

**Symptom:** Worker exits unexpectedly (code 134 = SIGABRT on Linux).

**Cause:** onnxruntime-node bug with multiple concurrent sessions.

**Recovery:**

```typescript
private handleWorkerExit(worker: Worker, code: number): void {
  if (code !== 0) {
    console.error(`Worker crashed with code ${code}`);

    // Remove from pool
    const idx = this.workers.indexOf(worker);
    if (idx >= 0) this.workers.splice(idx, 1);

    // Restart worker
    this.spawnWorker();

    // Retry pending requests (idempotent)
    this.retryPendingRequests();
  }
}

private retryPendingRequests(): void {
  const requests = Array.from(this.pendingRequests.values());
  this.pendingRequests.clear();

  for (const req of requests) {
    this.queue.unshift(req); // Retry at front of queue
  }
}
```

### Model Load Failures

**Symptom:** `Error: Cannot find module 'model.onnx'`

**Cause:** Model file not packaged in Electron app bundle.

**Fix (electron-vite):**

```typescript
// electron.vite.config.ts
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['onnxruntime-node'],
        // Copy models to output
        plugins: [
          {
            name: 'copy-models',
            writeBundle() {
              fs.cpSync('resources/models', 'out/main/models', { recursive: true });
            }
          }
        ]
      }
    }
  }
});
```

---

## Model Selection

### Comparison Table (October 2025)

| Model | Dims | Params | Size | Speed (1K tokens) | Quality (MTEB) |
|-------|------|--------|------|-------------------|----------------|
| **all-MiniLM-L6-v2** | 384 | 22M | 80MB | 14.7ms | 56.3 |
| bge-micro-v2 | 384 | 17M | 62MB | 12.1ms | 58.7 |
| all-MiniLM-L12-v2 | 384 | 33M | 120MB | 22.4ms | 59.8 |
| bge-small-en-v1.5 | 384 | 33M | 130MB | 23.1ms | 62.1 |
| all-mpnet-base-v2 | 768 | 110M | 420MB | 47.2ms | 63.3 |
| bge-base-en-v1.5 | 768 | 109M | 440MB | 48.6ms | 63.6 |

**Recommendation:** **all-MiniLM-L6-v2** for default (good balance of speed/quality).

### When to Use Alternatives

- **bge-micro-v2:** If speed is critical (2ms faster, +2.4 quality)
- **all-mpnet-base-v2:** If quality is critical (768 dims, 3x slower)
- **Multilingual:** Use `paraphrase-multilingual-MiniLM-L12-v2` or `bge-m3`

---

**Related:**
- [Architecture](./architecture.md) - Worker thread design rationale
- [Vector Search](./vector-search.md) - Storage and querying embeddings
- [Data Model](./data-model.md) - Schema for embeddings and vss_sections
- [Performance](./performance.md) - Benchmarks and optimization
