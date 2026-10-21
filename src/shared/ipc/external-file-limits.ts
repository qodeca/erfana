// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Limits of the external-file requests. Kept apart from the schemas, which
 * import Node's `path`, so the renderer can read them without bundling it.
 */

/** Most files one batch request may carry; matches the confirmer's per-window queue. */
export const EXTERNAL_MOVE_BATCH_MAX = 100
