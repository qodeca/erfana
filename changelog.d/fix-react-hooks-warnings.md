### Internal

- **`npm run lint` drops from 107 to 43 react-hooks warnings, with no change in behaviour.** Every
  warning in a file no open pull request touches is resolved: render-time ref writes move to a new
  `useLatestRef` hook (assigned in a layout effect), the dockview "re-read on subscribe" effects
  move to a `useDockviewValue` hook built on `useSyncExternalStore`, resets move from effects into
  render, missing dependencies are added where they are stable, and the deliberate cases carry an
  `eslint-disable` comment with its reason. The 43 left are in files open pull requests change;
  the rule level stays `warn` until a follow-up.
