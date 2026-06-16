// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// Preload test setup
import '@testing-library/jest-dom/vitest'
import { installFlakeGuard } from './flakeGuard'

// Surface intermittent unhandled rejections / uncaught exceptions firing
// after teardown. See `flakeGuard.ts` for rationale.
installFlakeGuard('preload')

// Minimal stubs that some preload tests may rely on.
// Preload tests should generally stub electron APIs explicitly per test.
// We include no global mocks here to keep tests hermetic.
