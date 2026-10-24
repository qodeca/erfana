// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Renderer Markdown-image gateway (#71): the one place `window.api.markdownImage`
 * is read.
 *
 * Renderer code calls `markdownImageGateway.read`, which forwards to the
 * preload bridge with the same contract ({@link MarkdownImageBridge}). Keeping
 * the access in one module gives the renderer a single seam to change or fake.
 */
import type { MarkdownImageBridge } from '../../../shared/ipc/markdown-image-schema'

/** The bridge is read per call, so a test that swaps `window.api` is honoured. */
// `Window['api']` leaves this bridge out of its type; this module is the only place it is put back
const bridge = (): MarkdownImageBridge =>
  (window as unknown as { api: { markdownImage: MarkdownImageBridge } }).api.markdownImage

export const markdownImageGateway: MarkdownImageBridge = {
  read: (...args) => bridge().read(...args)
}
