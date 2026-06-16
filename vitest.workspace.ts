// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'vitest.main.ts',
  'vitest.preload.ts',
  'vitest.renderer.ts',
])

