# Embedding pipeline – ONNX and workers

> This is part 2 of the embedding pipeline documentation, split for readability.
>
> **Other parts:**
> - [Embedding pipeline – overview and preprocessing](./embedding-pipeline-overview.md)
> - [Embedding pipeline – batch processing and models](./embedding-pipeline-batch-models.md)

> ⚠️ **WORK IN PROGRESS – NOT READY FOR DEVELOPMENT**
>
> This documentation is currently under active development and review. The Graph Engine specification, architecture, and implementation details are subject to significant changes. **DO NOT start implementation work based on these documents.**
>
> **Status**: Draft specification being refined
> **Expected Ready**: TBD pending architectural review and wireframe finalization

**Last Updated:** October 2025

---

## ONNX Runtime integration

### Why ONNX?

- **Local Execution:** No API calls, fully offline
- **Performance:** Native C++ inference (~10-20ms per 1K tokens)
- **Portability:** Same model runs on macOS/Linux/Windows
- **Flexibility:** Swap models without code changes

### Model download

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

### ONNX Runtime setup

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

## Worker thread architecture

### Why worker threads?

- **Non-Blocking:** Keep main thread responsive (UI doesn't freeze)
- **Parallelism:** Batch process chunks concurrently
- **Isolation:** Crash in worker doesn't kill main process

### Worker pool management

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

### Concurrency limits

**⚠️ CRITICAL:** onnxruntime-node crashes with >4 concurrent workers (GitHub issue #18790, March 2024).

**Recommended:**
- **Development:** 2 workers
- **Production:** 2-4 workers (monitor crash logs)
- **Alternative:** Consider `transformers.js` (wraps onnxruntime, better stability)

---

## See also

- [Embedding pipeline – overview and preprocessing](./embedding-pipeline-overview.md) – pipeline overview, text preprocessing, tokenization, chunking
- [Embedding pipeline – batch processing and models](./embedding-pipeline-batch-models.md) – batch processing, normalization, error handling, model selection
- [Architecture](./architecture-overview.md) – Worker thread design rationale
- [Vector Search](./vector-search-overview.md) – Storage and querying embeddings
- [Data Model](./data-model.md) – Schema for embeddings and vss_sections
- [Performance](./performance.md) – Benchmarks and optimization
