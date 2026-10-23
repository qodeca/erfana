### Fixed

- **Smaller HTML preview lifecycle defects.** A discarded still-frame capture is no longer scaled and encoded first, a preview whose page is gone no longer exports, reloads or swaps a stylesheet, a failed start detaches its native view from the window, only one repaint check is in the page at a time during a splitter drag, and window routing no longer writes onto Electron's live web contents. (#120)
