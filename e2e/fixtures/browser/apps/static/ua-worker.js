// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
// A dedicated worker that reports what it presents as its browser
// (025-AC-024): its user agent, its client-hint brands, and the headers its
// own request carried (`/__headers` echoes them).
fetch('/__headers').then(
  function (response) {
    return response.json()
  }
).then(
  function (headers) {
    self.postMessage({
      userAgent: navigator.userAgent,
      brands: navigator.userAgentData ? navigator.userAgentData.brands : null,
      headers: headers
    })
  },
  function (error) {
    self.postMessage({ error: String(error) })
  }
)
