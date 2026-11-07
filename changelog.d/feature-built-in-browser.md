### Added

- **A built-in browser.** Open a web page, your dev server or a project HTML file in a browser tab
  next to the terminal: the **New browser tab** button after the last tab, **File > New browser
  tab** (Cmd+T, Ctrl+T on Windows and Linux), or **Open in browser tab** in the HTML preview. Each project has
  its own browser data in `.erfana/browser/`, which **More > Clear browsing data…** and **Forget this
  project's browser data…** remove. Spec 025.
- **Pick an element and send it to your agent.** **Pick element** (Cmd+E, Ctrl+E on Windows and Linux) holds
  a still image of the page; choose **Explain**, **Ask…**, **Change…** or **Prompt…**, and Erfana
  types the request into the agent's terminal with a screenshot and a context file. Erfana checks
  that an agent runs there first. What is stored, sent and logged is in the user guide's
  **Browser data handling** page.

### Changed

- **A plain click on a web link in the terminal now opens it in an Erfana browser tab.** Cmd-click
  (Ctrl-click on Windows and Linux) opens it in your system's default browser, as a plain click did before.
- **Pasting or dropping text that could run at once asks first.** Text a web page put on the
  clipboard, or text dragged into the terminal from outside Erfana, that holds a line break or a
  control character shows a confirmation with the text before it reaches the terminal.

### Security

- **Erfana's log files record the full address of a browser page that fails to load,** query string
  included, so support can see what failed. A failed search is logged without its text, and page
  titles, form data and console text are never logged.
