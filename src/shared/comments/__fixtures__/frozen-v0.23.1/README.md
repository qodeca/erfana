# Frozen v0.23.1 comment parser and writer

A byte copy of the comment format code that shipped in Erfana v0.23.1, kept so
tests can prove that v0.23.1 still reads and keeps what this version writes
(spec 024, 024-FR-009, 024-FR-010, architecture note § 8 C30).

- `blobs.txt` – the v0.23.1 git blob SHA of every copied file and where it came from.
- `recorded.patch` – the only change from the v0.23.1 bytes: imports rewritten so
  nothing leaves this folder except the pinned packages `parse5-v0.23.1` and
  `zod-v0.23.1` (npm aliases at the v0.23.1 versions) and `@noble/hashes` (exact
  version, unchanged since v0.23.1).
- `frozen.lock.json` – the SHA-256 of every file here; `frozenV0231.contract.test.ts` checks it.

Never edit these files. The folder is excluded from coverage, the max-lines
ratchet and line-ending conversion (`.gitattributes` `-text`).
