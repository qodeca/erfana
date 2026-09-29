# Fenced quotes from repository files

Documentation sometimes copies a maintained file so the reader can see the exact bytes under
discussion. Put a source marker immediately before such a fenced block:

    <!-- from: path/to/file -->
    ```text
    exact file bytes
    ```

`path/to/file` is relative to the repository root and must use the path's exact case from the Git
index. The block content must byte-match the file. A fence necessarily puts a newline before its
closing delimiter, so that one final newline is tolerated when the source itself has none. An
absolute path, a `..` segment, a wrong-case path, a path that resolves outside the repository, or a
missing file fails the repository check. Missing sources never skip: the marker exists specifically
to catch a quote copied from a file that is absent on the current branch.

For a focused excerpt, append an inclusive line range:

    <!-- from: path/to/file#L10-L14 -->

The selected source lines retain their line endings and are compared byte for byte. The start must
not exceed the end, and both lines must exist.

The marker is optional. Unmarked fences remain ordinary examples and are not compared. A marker
without an immediately following fence fails, as does a marked fence that is not closed. Markers
inside another fenced block are ordinary example text. A marker indented four or more spaces is
also ordinary example text and is therefore a deliberate silent no-op; use no more than three
leading spaces when the quote must be checked. The marked fence itself must not be indented.
Opening and closing fences may use three or more backticks or tildes; a closing fence must use the
same character and at least the opening length.

The check scans maintained Markdown under `docs/` and `.xezar/docs/`, root `*.md`, and —
for a project that still keeps its designs at the repository root — `designs/**/README.md`. It explicitly excludes every `.local/xezar/`, `node_modules/`, and `changelog.d/`
directory encountered inside those surfaces rather than relying on their usual repository
locations to keep them out of the walk.

This excerpt is checked against the task-agent guard in the maintained hook script:

<!-- from: .xezar/checks/leader-context.sh#L32-L46 -->
```sh
# A task agent, even one running in the primary checkout with Worktree off.
[ -z "${XEZ_HANDOFF_FILE:-}" ] || silent
[ -z "${XEZ_TODOS_FILE:-}" ] || silent
[ -z "${XEZ_TASK_ID:-}" ] || silent

# A task worktree, by path or by git registration. The path test is the belt to the git test's
# braces: it does not depend on git being installed or on either git command succeeding.
case "$PWD" in */.local/xezar/worktrees/*) silent ;; esac
case "$REPO_ROOT" in */.local/xezar/worktrees/*) silent ;; esac
git_dir="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-dir 2>/dev/null || true)"
common_dir="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
[ -n "$git_dir" ] && [ "$git_dir" = "$common_dir" ] || silent

# Without the guide there is nothing to load.
[ -f "$GUIDE" ] || silent
```
