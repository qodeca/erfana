### Fixed

- **Local transcription model downloads work again.** The model host moved to a new CDN, which made
  downloads fail. Downloads are now checked against pinned hashes, and the large model now downloads
  from its current file.
