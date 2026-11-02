// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// A dedicated worker whose failed request counts for its tab (025-AC-038).
fetch('/__status/404?from=worker').then(
  function (response) {
    self.postMessage('worker request ' + response.status)
  },
  function (error) {
    self.postMessage('worker request failed ' + error.name)
  }
)
