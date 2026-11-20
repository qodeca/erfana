// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The byte budget every Markdown preview of a window draws its image `data:`
 * URLs from (#71). Moved out of `markdownImageStore.ts` (#478 plan S18) so the
 * store stays inside its line ratchet.
 *
 * @module components/Editor/markdownImageBudget
 */
import { MARKDOWN_IMAGE_BYTE_BUDGET } from '../../../../shared/ipc/markdown-image-schema'

/**
 * `data:` URL characters held by every preview of a window. Counting the URL
 * length rather than the file size is deliberate: the URL is what is held.
 */
export class ImageByteBudget {
  private used = 0
  private readonly releaseListeners = new Set<() => void>()

  constructor(private readonly limit: number) {}

  /** Characters held now (for tests and measurements). */
  get held(): number {
    return this.used
  }

  /** Characters still free. */
  get remaining(): number {
    return this.limit - this.used
  }

  /**
   * Hear about every release, so an image waiting for room can be read once
   * there is some – rather than on every refresh.
   *
   * @returns The function that stops listening
   */
  onRelease(listener: () => void): () => void {
    this.releaseListeners.add(listener)
    return () => {
      this.releaseListeners.delete(listener)
    }
  }

  /** Take `amount` if it fits; false (and nothing taken) when it does not. */
  reserve(amount: number): boolean {
    if (amount <= 0) return true
    if (this.used + amount > this.limit) return false
    this.used += amount
    return true
  }

  /** Give back what {@link reserve} took. */
  release(amount: number): void {
    if (amount <= 0) return
    this.used = Math.max(0, this.used - amount)
    for (const listener of [...this.releaseListeners]) listener()
  }
}

/** One budget per window: every preview panel, hidden ones included, draws from it. */
export const sharedImageByteBudget = new ImageByteBudget(MARKDOWN_IMAGE_BYTE_BUDGET)
