### Changed

- **The preview toolbars now look the same.** In the HTML and Markdown previews, the comment tools
  are icons only, with a number when the file has comments. A button that is on shows the same fill
  and lime line in both previews, and the Markdown view-mode buttons use this look too.
- **The Markdown comments panel fills a narrow preview.** Under 640 px wide it takes the whole
  preview, as it does in the HTML preview.

- **Comment messages now use plain words.** Every message in the comments feature is written for
  people who are not developers. It says what happened and what to do next, without terms such as
  "element", "thread" or "read-only".

### Fixed

- **The HTML page stays sharp behind comment windows, menus and warnings.** The page was a small
  picture stretched to fit, so the text looked blurred. It now keeps the full screen size.
- **Fast clicks in the HTML preview no longer show a false warning.** Quick clicks on links counted as
  links the page opened by itself, so a "Blocked link" warning appeared although the links worked.
- **Links that change only the `?` part of an address now work in the HTML preview.** A link such as
  `page.html?lang=pl` did nothing and could show a "Blocked link" warning. The page now loads in the same tab.
  Back still steps between files, not between `?` choices.
- **Comment mode now tells you about the Tab key.** The spoken text says that Tab moves between sections
  (paragraphs in Markdown).
