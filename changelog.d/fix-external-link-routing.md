### Fixed

- **Every link that opens outside Erfana now goes through one check.** Clicks, middle-clicks, links
  in the terminal and pages that try to open a new window all use it. Network-share paths, `file:`
  links and `ftp:` links no longer open, and `mailto:` links keep only the address, subject and body.
