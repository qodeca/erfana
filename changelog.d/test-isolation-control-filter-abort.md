### Internal

- **The repository-isolation control test no longer fails on a stricter git.** Its plain
  `git status` runs a filter process that exits before git's handshake; newer git builds abort with
  exit 128 where older ones carry on. The control now ignores the exit code and still checks that
  the fsmonitor and filter commands ran, so it keeps proving the hardened case is not vacuous.
