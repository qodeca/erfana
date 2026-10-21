### Fixed

- **Opening the top of a drive (such as `/` or `C:\`) or of a network share as a project is now refused,** because every file on it would count as part of the project. A link or shortcut that leads to such a place is refused as well.

- **On Windows, the Windows, Program Files and ProgramData folders (and your `.ssh`, `.aws` and similar folders) can no longer be opened as projects,** as the equivalent system folders already could not on macOS and Linux.

- **A refused project now says why, the same way everywhere.** Whether you open from the folder dialog, from the recent list or by dropping, the message and the inline error read in plain words, without the internal "Error invoking remote method" text.
