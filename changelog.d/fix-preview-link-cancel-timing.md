### Fixed

- **A link the previewed page cancels is no longer followed.** When an HTML page in the preview
  cancelled a link click in one of its own later click handlers, Erfana still opened the link.
  The preview now waits until the page's handlers have all run before it acts on a click.
