// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { Worker } from 'worker_threads'
import { join } from 'path'
import type { IGitStatusWorker, GitWorkerRequest } from '../interfaces/IGitStatusWorker'
import { GIT_STATUS } from '../../shared/constants'
import type { GitStatusResponse } from '../../shared/ipc/git-schema'
import { logger } from './LoggingService'

/**
 * Worker thread adapter for git status computation
 *
 * Wraps a `worker_threads.Worker` that runs git status operations
 * off the main thread. The worker is created lazily on first execute()
 * and recreated automatically after crashes or timeouts.
 *
 * @see IGitStatusWorker for the interface contract
 * @see Spec #022 - Git status thread offloading
 */
export class GitStatusWorkerAdapter implements IGitStatusWorker {
  private worker: Worker | null = null
  private nextRequestId = 1
  private pending = new Map<
    number,
    {
      resolve: (value: GitStatusResponse) => void
      reject: (reason: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private readonly workerPath: string

  constructor() {
    // Worker script is co-located in the same output directory as the main bundle
    this.workerPath = join(__dirname, 'git-status.worker.js')
    logger.debug(`[GitStatusWorkerAdapter] Worker path: ${this.workerPath}`)
  }

  /** Execute a git status operation in the worker thread. */
  async execute(request: GitWorkerRequest): Promise<GitStatusResponse> {
    const worker = this.ensureWorker()
    const id = this.nextRequestId++

    return new Promise<GitStatusResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Worker request timed out after ${GIT_STATUS.WORKER_REQUEST_TIMEOUT}ms`))
        // Terminate and recreate on timeout -- the worker may be hung
        this.terminateWorker()
      }, GIT_STATUS.WORKER_REQUEST_TIMEOUT)

      this.pending.set(id, { resolve, reject, timer })
      worker.postMessage({
        type: 'execute',
        id,
        projectPath: request.projectPath,
        strategy: request.strategy
      })
    })
  }

  /** Terminate the worker thread and release resources. Safe to call multiple times. */
  async dispose(): Promise<void> {
    await this.terminateWorker()
  }

  /** Check if the worker thread is alive and accepting requests. */
  isAlive(): boolean {
    return this.worker !== null
  }

  // --- Private methods ---

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.createWorker()
    }
    return this.worker!
  }

  private createWorker(): void {
    this.worker = new Worker(this.workerPath)
    logger.debug('[GitStatusWorkerAdapter] Worker thread created')

    this.worker.on('message', (msg: { type: string; id?: number; data?: GitStatusResponse; error?: string }) => {
      if (msg.type === 'result' || msg.type === 'error') {
        const entry = this.pending.get(msg.id!)
        if (entry) {
          clearTimeout(entry.timer)
          this.pending.delete(msg.id!)
          if (msg.type === 'result') {
            entry.resolve(msg.data!)
          } else {
            entry.reject(new Error(msg.error ?? 'Unknown worker error'))
          }
        }
      }
    })

    this.worker.on('error', (error: Error) => {
      logger.error(`[GitStatusWorkerAdapter] Worker error: ${error.message}`)
      this.rejectAllPending(error)
    })

    this.worker.on('exit', (code: number) => {
      logger.debug(`[GitStatusWorkerAdapter] Worker exited with code ${code}`)
      this.worker = null
      if (code !== 0) {
        this.rejectAllPending(new Error(`Worker exited with code ${code}`))
      }
    })
  }

  private rejectAllPending(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }

  private async terminateWorker(): Promise<void> {
    if (this.worker) {
      const worker = this.worker
      this.worker = null
      try {
        await worker.terminate()
      } catch {
        // Worker already terminated
      }
    }
  }
}
