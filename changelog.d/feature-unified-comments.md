### Added

- **You can comment on a Markdown document in its preview.** In the **Preview Only** view, turn on
  comment mode (Ctrl+Alt+M, Cmd+Option+M on macOS) and select a paragraph, list item or heading, or
  right-click one. The comment is saved inside the `.md` file as an HTML comment right before the
  block, so it does not show when the file is rendered and a coding agent reading the file sees it.
  Erfana refuses a comment that would change how the file looks, and keeps comments read-only while
  the editor holds unsaved changes. A new **Comments in Markdown preview** switch in
  **Settings > Comments** turns them off. Spec 024.
- **You can comment on selected words, in both previews.** Select words and select **Comment**, or
  right-click and choose **Comment on selection**; the words are underlined, and **Narrow to words**
  picks fewer of them. Erfana keeps the words only when it finds them in the file as written.
  Spec 024.
- **The HTML preview's right-click offers a comment outside comment mode.** When the page does not
  use its own right-click, Erfana's menu offers to comment on the element or the selection. Spec 024,
  comments-v2 OD-01.
- **Step through comments, and repair damaged ones.** **Previous comment** and **Next comment** (or
  Alt+F9 and Alt+Shift+F9) move through the open comments, with **Resolve and next** and **Reply and
  resolve**. **Rebuild from data…** repairs a comment whose readable lines were edited by hand but whose
  data line is intact. Spec 024, comments-v2 C-13 and OD-05.

### Changed

- **One comment experience in both previews.** The comment window, the Comments list and the words
  are the same in the HTML and the Markdown preview. The list now filters by **Open**, **Resolved** and
  **Can't edit** and sorts by **File order**, **Changed first** or **Latest activity**; a comment
  whose target changed is marked **Changed** with what it was and what it is now; a note says when
  open comments were removed outside Erfana. The identity notice is shown once for both previews.
  Spec 024, comments-v2.
- **Comments are no longer refused by folder.** A file in a dot-folder, `node_modules`, `dist`,
  `out` or `coverage` can be commented like any other: if a file can be opened, it can be commented.
  Spec 024, comments-v2 OD-07.

### Security

- **New `file-comment:*` channels for Markdown comments.** Sender-gated before the payload is read,
  strict capped schemas, single-use draft tokens bound to the window, the panel and the file, events
  only to the owning window, and every Markdown parse checked against size and nesting limits before
  it runs. The unsaved-edits check now asks every window. See `docs/security.md` § Markdown Preview
  comments and the `file-comment:*` channels. Spec 024.

### Internal

- **A shared comment base.** The format core moved to `src/shared/comments/`, the write path and
  parse worker to `src/main/services/comments/`, and the comment window and drawer to
  `src/renderer/src/components/Comments/`; the HTML preload overlay and the renderer overlay host
  share one pure core (`src/shared/comments/overlayCore/`, ADR 0006). A later text-file preview
  plugs in through `CommentFileKind` and `PreviewCommentAdapter`. Spec 024.
