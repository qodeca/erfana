### Added

- **You can comment on elements of a previewed HTML page.** Turn on comment mode in the preview
  toolbar (Ctrl+Alt+M, Cmd+Option+M on macOS), click an element, and write what should change.
  Comments appear as pins on the page and in a drawer that lists every thread, with reply, edit,
  resolve and delete. The comment is saved inside the `.html` file as an ordinary HTML comment right
  before the element, so it travels with the file through git and a coding agent that reads the file
  sees your request next to the markup. Every comment block starts with a short note telling agents
  to act only on open comments and to leave the block unchanged. Comments work inside same-project
  frames too. The format is documented in `docs/html-comments/format-v1.md`.
- **A Settings > Comments section.** It holds your name and optional email, which Erfana writes next
  to each comment, and the **Comments in HTML preview** switch (on by default). With the switch off,
  previews behave exactly as before.

### Changed

- **Pages that Vue, Svelte or Angular hydrate get their comment block before the app's root.**
  Those frameworks do not tolerate an extra comment inside the markup they hydrate. A page script
  that walks `childNodes` can still see comment blocks. Files over 4 MB show no comments.

### Fixed

- **A file created just after a project opens now shows in the project tree.** The file watcher
  starts after the tree is first read, and on Windows each folder's watch opens a moment later
  still, so a file created in between appeared only after pressing Refresh – collapsing and
  re-opening its folder did not help. The tree is now read once more when the watcher is ready, and
  opening a folder checks it against the disk and refreshes the tree when they differ.
- **An HTML preview no longer misses a save made just after it opens.** A stylesheet or script
  saved while the preview was still finding the page's linked files was not watched yet, so the
  page kept the old version until the next save. Each newly watched file is now checked when its
  watch starts, and a file changed since the page began loading refreshes the preview once.

### Security

- **Comment saves are gated end to end.** The preview page can only ask for a comment window; the
  write happens from Erfana's own Save, replaces the file only if it is still exactly the file that
  was read, refuses links, keeps the Windows mark of the web, and never logs comment text, names or
  paths. The preview preload now runs in frames and has one receive channel when comments are on
  (ADR 0005). See `docs/security.md` § HTML Preview comments.
