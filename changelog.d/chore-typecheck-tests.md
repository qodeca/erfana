### Changed

- **`npm run typecheck` now checks the tests too.** The unit tests (main, preload, shared and
  renderer) and the Playwright e2e specs are type-checked in the required Typecheck job, through
  one config per process. The type errors that had built up in tests were fixed in the tests,
  not silenced. (#109)
