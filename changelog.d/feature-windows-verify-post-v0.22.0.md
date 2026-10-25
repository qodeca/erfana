### Security

- **Electron 44.9.3.** Picks up Electron's mitigation for compromised eMudhra intermediate
  certificates, with patch releases of vite (Windows argument escaping in `launch-editor`),
  brace-expansion, fast-uri, postcss-selector-parser and source-map-js from `npm audit fix`.

- **Mermaid 12.2.0.** Clears the KaTeX prototype-pollution advisory that reached the preview
  through Mermaid 11. Mermaid 12 defaults to a new look and the ELK layout; Erfana pins the
  classic look and the dagre layout, so existing diagrams keep their shape, and a diagram can
  still opt in through its own front matter.

### Internal

- **vitest 5.** Upgraded vitest and `@vitest/coverage-v8` from 3.2 to 5.0.5, which removes
  the critical tinypool and `@vitest/mocker` advisories from the dev tree. The three projects
  are listed in `vitest.config.ts` (`test.projects`) instead of `vitest.workspace.ts`, and the
  per-project configs are renamed `vitest.<project>.config.ts`, as vitest 5 requires. Mocks
  that code builds with `new` use `function` implementations, and test helpers type their
  mocks as `Mock` rather than `ReturnType<typeof vi.fn>`. The coverage floors were
  re-measured: vitest 5 maps v8 coverage through the AST and counts more branches, so the same
  code reads lower (main branches 91.37 → 82.85). The CI deprecation allowlist is now empty.
- **Three e2e tests that failed on a Windows host now pass.** `MonacoPage.focus()` waits for
  Monaco's text area to settle before it clicks (an early click became a drag that selected
  line 1), the tree focus-ring check expects 2 px snapped to device pixels as Chromium draws it
  at 125 % scaling, and the tree right-click lands well inside the row instead of 10 px from an
  edge that moves. Recorded in `docs/windows/known-flakes.md`.
- **Two-worker e2e runs on Windows no longer freeze the covered window.** Chromium stops
  rendering a window another one covers, so the HTML-preview and editor checks in the hidden
  worker's app timed out. Every e2e launch now passes `E2E_CHROMIUM_ARGS`
  (`--disable-features=CalculateNativeWinOcclusion` on Windows).
