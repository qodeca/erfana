### Internal

- **The real-pwsh bootstrap test no longer times out under coverage.** The curly-apostrophe
  case in `WindowsTerminalBootstrap.test.ts` spawns a real `pwsh`, whose start-up took 6.5 s
  under coverage on Linux CI and tripped the 5 s default, ejecting pull requests from the merge
  queue. It now has its own 20 s budget; the assertions are unchanged.
