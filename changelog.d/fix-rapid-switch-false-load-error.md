### Fixed

- **Opening two projects in quick succession no longer shows a false "Failed to Load Project" error.**
  When a second project was opened before the first had finished loading, the first project's
  folder read could be refused and reported as an error. Erfana now recognises that read as
  superseded and drops it quietly, and the second project opens normally.
