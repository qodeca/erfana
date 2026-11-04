### Fixed

- **The context meter knows the newer Claude models.** Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1
  and Mythos 5.1 now show their 1M window from the first reply instead of 200k; the model table was
  re-checked against Anthropic's documentation on 2026-11-03. (#383)
- **`/model` no longer shrinks a 1M-only model to 200k.** Picking a model such as Opus 5 with
  `/model` and no `[1m]` keeps the meter at 1M, because that model has no 200k window. A model that
  offers both, such as Opus 4.6, still shows 200k after that pick. (#383)
- **A Claude model newer than Erfana's table no longer shows 200k.** It takes the window of the newest
  model Erfana knows in its family, however far ahead it is, so the next release does not bring this
  bug back. The tooltip marks any such guess **(inferred)**, a guessed 200k included. (#383)
