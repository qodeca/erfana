### Changed

- **A program that floods the terminal no longer swamps the window.** Terminal output is now sent to the window in batches (about 380 times fewer messages for a 50 MB flood, which also finishes about 7 % sooner), and when the window falls behind, the program in the terminal is briefly held back until it catches up instead of output piling up without limit (macOS and Linux; on Windows output is batched only). A terminal in a minimised or hidden window is never held back, so builds and agents left running in the background keep their speed.
