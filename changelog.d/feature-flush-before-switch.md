### Fixed

- **Unsaved tabs are saved before a project switch or close.** Opening another project (from the picker or the recent list) or closing the project now saves every edited tab first, so a quick edit is no longer lost or written late into the project being left. The "discard?" prompt appears only for tabs that could not be saved (for example a file that changed on disk) and says how many, such as "1 tab could not be saved". Cancel keeps the project and autosave running; "Switch Anyway" leaves those tabs unsaved without a late write.
