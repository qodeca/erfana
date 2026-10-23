### Changed

- **The coverage floors now count untested files and sit just under real coverage.** All three
  vitest configs set `all: true`, so a source file no test loads counts at 0 % instead of
  dropping out of the totals. The project-wide floors rise to one point under the measured
  values (lines, functions, branches, statements): main from 10/10/5/10 to 90/92/90/90,
  renderer from 10/10/5/10 to 85/90/89/85, preload from 62/28/95/62 to 71/52/97/71.
  (lens review finding [62])
