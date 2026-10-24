### Internal

- **The bare-name file search's bound tests no longer depend on machine speed.** The folder-cap
  test and the event-loop test in `findByName.test.ts` failed at random under coverage load: the
  search's real 1.5 s deadline cut the walk short, and the event-loop test measured wall-clock
  turns. Both now run with a frozen clock and a generous `timeLimitMs` (a new test-only option;
  production keeps the 1.5 s default), and the event-loop test counts reads and entries handled
  per turn of the loop instead of timing them.
