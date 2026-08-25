// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import { DOCX_EXPORT } from '../../../shared/constants'
import { logger } from '../LoggingService'

/**
 * Runs DOCX conversion in a killable Electron `utilityProcess`.
 *
 * Mirrors `GitStatusWorkerAdapter`: the child is created lazily, one request is
 * tracked by id, and a hard timeout `kill()`s a hung child (the whole point —
 * the previous in-thread `Promise.race` timeout could not interrupt the
 * library's synchronous image decoding). The child is recreated lazily on the
 * next call after a kill or crash.
 *
 * @see src/main/services/docx/docx-convert.process.ts (the child entry)
 * @see GitStatusWorkerAdapter (the lifecycle template)
 */
export class DocxConvertProcessAdapter {
  private child: UtilityProcess | null = null
  private nextId = 1
  private pending = new Map<
    number,
    {
      resolve: (value: Buffer) => void
      reject: (reason: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private readonly modulePath: string

  constructor() {
    // Child bundle is emitted alongside the main bundle (see electron.vite.config.ts).
    this.modulePath = join(__dirname, 'docx', 'docx-convert.process.js')
  }

  /** Convert already-stripped, already-wrapped HTML into a DOCX buffer. */
  async convert(html: string): Promise<Buffer> {
    const child = this.ensureChild()
    const id = this.nextId++

    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new Error(
            `DOCX conversion timed out after ${DOCX_EXPORT.CONVERSION_TIMEOUT_MS / 1000} seconds`
          )
        )
        // Kill and recreate on timeout -- the child may be in a synchronous hang.
        this.killChild()
      }, DOCX_EXPORT.CONVERSION_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })
      child.postMessage({ type: 'convert', id, html })
    })
  }

  /** Terminate the child process and release resources. Safe to call repeatedly. */
  async dispose(): Promise<void> {
    this.killChild()
  }

  // --- Private methods ---

  private ensureChild(): UtilityProcess {
    if (!this.child) {
      this.createChild()
    }
    return this.child!
  }

  private createChild(): void {
    this.child = utilityProcess.fork(this.modulePath, [], { serviceName: 'docx-convert' })
    logger.debug('[DocxConvertProcessAdapter] utility process created')

    this.child.on(
      'message',
      (msg: { type?: string; id?: number; bytes?: Uint8Array; error?: string }) => {
        if (!msg || (msg.type !== 'result' && msg.type !== 'error') || typeof msg.id !== 'number') {
          return
        }
        const entry = this.pending.get(msg.id)
        if (!entry) return
        clearTimeout(entry.timer)
        this.pending.delete(msg.id)
        if (msg.type === 'result' && msg.bytes) {
          entry.resolve(Buffer.from(msg.bytes))
        } else {
          entry.reject(new Error(msg.error ?? 'Unknown DOCX conversion error'))
        }
      }
    )

    this.child.on('exit', (code: number) => {
      logger.debug(`[DocxConvertProcessAdapter] utility process exited with code ${code}`)
      this.child = null
      if (code !== 0) {
        this.rejectAllPending(new Error(`DOCX convert process exited with code ${code}`))
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

  private killChild(): void {
    if (this.child) {
      const child = this.child
      this.child = null
      try {
        child.kill()
      } catch {
        // Already gone.
      }
    }
  }
}

/** Shared singleton used by HtmlToDocxConverter. */
export const docxConvertProcessAdapter = new DocxConvertProcessAdapter()
