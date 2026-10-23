// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Why a tool Erfana would run is refused (#250), as plain data shared by main,
 * the IPC schema and the window. The wording lives in `untrustedToolMessage`
 * (`errors.ts`).
 *
 * - `project` / `temp` – it is inside the open project or a temporary folder;
 * - `network` – it is, or would be looked up, on a network share in PATH;
 * - `relative` – it comes from a relative or empty PATH entry;
 * - `unresolvable` – its real location cannot be resolved (fail closed);
 * - `ambiguous` – two copies in different folders, and the lookup styles
 *   disagree on which one runs.
 */
export const UNSAFE_TOOL_REASONS = ['project', 'temp', 'network', 'relative', 'unresolvable', 'ambiguous'] as const
export type UnsafeToolReason = (typeof UNSAFE_TOOL_REASONS)[number]

/** The programs a LibreOffice conversion runs by name: LibreOffice itself and LiteParse's helpers. */
export const UNSAFE_TOOL_NAMES = ['libreoffice-fresh', 'libreoffice', 'soffice', 'which', 'powershell'] as const
export type UnsafeToolName = (typeof UNSAFE_TOOL_NAMES)[number]

/** Which program was refused and why. Never carries a path. */
export interface UnsafeToolInfo {
  tool: UnsafeToolName
  reason: UnsafeToolReason
}
