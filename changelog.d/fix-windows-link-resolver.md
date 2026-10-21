### Fixed

- **On Windows, relative links in the preview now show when their file is missing, and open the linked file.** Links with percent-escapes such as `my%20file.md` or `#%C3%A9t%C3%A9` now resolve on every platform, and links with backslashes, spaces in `<...>`, or non-ASCII names get the same broken-link styling as any other. A link can no longer reach outside the project, and Windows device names such as `CON` or `NUL` are refused as file paths. (#300)
