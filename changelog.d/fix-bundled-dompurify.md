### Security

- **Updated the bundled DOMPurify to 3.4.17.** The Mermaid diagram renderer and the Monaco editor
  each bundle DOMPurify, an HTML sanitiser. Both now use the 3.4.17 code, each with its own
  instance, which includes fixes for five published advisories (GHSA-p98j-92pf-mc4p,
  GHSA-6688-9rhm-gjv2, GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr and GHSA-c6gr-qvv4-5v3f). The
  build now fails if a second or older copy appears.
