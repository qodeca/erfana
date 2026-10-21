# Changelog fragments

One file per pull request, named for its number (`212.md`) or its branch
(`feature-exclude-list.md`). It holds the bullet lines that would otherwise go under
`## [Unreleased]` in `../docs/CHANGELOG.md`, under that file's own Keep a Changelog groups:

```md
### Fixed

- **The lead sentence, in the changelog's voice.** One or two sentences of what and why. (#212)
```

The allowed groups are `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed` and
`### Security`. A fragment carries bullets and their wrapped continuation lines and nothing else.

Why fragments: every open pull request that edits the top of the changelog edits the same lines,
so the first merge makes every other pull request conflict. No two branches ever touch the same
fragment file.

Do not edit `../docs/CHANGELOG.md` in a pull request; add a fragment here instead. At release time every
fragment is folded into the new version's section and the files are deleted in the same commit, so
a fragment is never left unfolded. This `README.md` is not a fragment.
