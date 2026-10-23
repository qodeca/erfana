### Fixed

- **Smaller HTML preview lifecycle defects.** A discarded still-frame capture is no longer scaled and encoded first, a preview whose page is gone no longer exports, reloads or swaps a stylesheet, a failed start detaches its native view from the window, the window-edge resize hold and repeated growth pushes no longer start a repaint check in the page for every push, and window routing no longer writes onto Electron's live web contents. (#120)
