### Security

- **Updated the bundled DOMPurify to 3.4.17.** The Mermaid diagram renderer and the Monaco editor
  each bundle DOMPurify, an HTML sanitiser. Both now use the same 3.4.17 copy, which includes fixes
  for two published advisories (GHSA-cg2g-xh64-v4q7 and GHSA-mrv2-3pqr-j5jr). The build now fails
  if a second or older copy appears.
