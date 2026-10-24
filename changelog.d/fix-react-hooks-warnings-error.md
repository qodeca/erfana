### Internal

- **React hooks lint is now an error, with the last 43 warnings fixed and no change in behaviour.**
  Every `eslint-plugin-react-hooks` rule in the renderer (`exhaustive-deps` and the
  React-Compiler-derived rules) is `error`, so a new stale closure or render-time ref write fails
  `npm run lint` instead of adding to a warning count. The fixes follow #368: `useLatestRef` for
  render-time ref writes (HTML preview hooks, file and directory watchers, git status), the
  `useDockviewValue` hook for the preview panel's visible and active state, resets moved from
  effects into render, and promise chains where an `async` loader was misread as setting state
  synchronously. Four deliberate cases carry an `eslint-disable` comment with its reason.
