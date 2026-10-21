### Fixed

- **Opening the top of a drive (such as `/` or `C:\`) or of a network share as a project is now refused,** because every file on it would count as part of the project. A link or shortcut that leads to such a place is refused as well, and the Welcome screen's recent list now shows the refusal instead of a generic error.
