### Fixed

- **One name for a project on Windows.** A project opened with a different spelling of its path (other letter case, or a short 8.3 name) now shows one consistent name in the title, the recent projects list and the project tree.

- **Folder links show as folders.** Junctions and folder links that lead to another folder inside the project now appear as folders in the project tree and can be expanded. Links that lead outside the project, or that loop back on themselves, are not followed.

- **Faster file access on network projects.** Opening folders and files in a project on a network share makes fewer file-system calls, with the same checks as before.
