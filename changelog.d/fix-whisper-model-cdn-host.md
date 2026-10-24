### Fixed

- **Local transcription model downloads work again.** The model host moved to a new CDN, which made
  downloads fail. Downloads are now checked against pinned hashes, and the large model now downloads
  from its current file.
- **Installed transcription models are checked before use.** A model file with the wrong size or
  content is removed and you are asked to download it again. Half-finished model downloads are
  cleaned up when the app quits or starts a new download.
