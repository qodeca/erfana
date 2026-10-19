### Fixed

- **PDF export can no longer hang the app's export queue.** Each step now has a time limit, and a
  stuck export fails cleanly so the next one works. The export page also runs in its own sealed
  session and loads only its own content and `https:` or embedded images.
