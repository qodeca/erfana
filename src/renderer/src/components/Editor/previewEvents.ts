// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * DOM events the Markdown preview raises on its root element.
 *
 * @module components/Editor/previewEvents
 */

/**
 * Fired (bubbling) on the preview root each time a new version of the
 * document has been written to the DOM.
 *
 * The preview renders behind the editor – deferred and, for large documents,
 * debounced – so "the editor content changed" no longer means "the preview DOM
 * changed". Anything that measures the preview DOM (the scroll-sync map) must
 * wait for this event instead of reacting to the content change.
 */
export const PREVIEW_RENDERED_EVENT = 'preview:rendered'
