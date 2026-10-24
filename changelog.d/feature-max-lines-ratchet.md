### Internal

- **Source files can no longer grow past 500 lines.** ESLint's `max-lines` rule now holds every
  non-test `src/**/*.{ts,tsx}` file to 500 lines, and each of the 43 files already over it to its
  current size, listed in `scripts/max-lines-baseline.json`: a file may shrink, never grow. A new
  `npm run lint` step, `lint:max-lines`, counts every file's lines itself, so an inline comment
  that switches the ESLint rule off cannot let a file grow. It also fails when a listed file
  shrinks without its entry being lowered, when an entry is no longer needed, or when a file has
  such a comment. `npm run lint:max-lines -- --update` lowers or removes entries and never raises
  one (technical debt #26 in `docs/technical-debt.md`). (lens review finding [65])
