### Fixed

- **A Whisper download that fails after Cancel is reported as a failure.** An integrity or other
  error that lands after Cancel is now shown and logged as that error, instead of as a cancelled
  download. A cancelled download is still logged, at debug level.
- **The Whisper download Cancel button sends one request.** After the first press it reads
  "Cancelling…" and stays focusable but inactive until the download ends, so repeated presses do
  not send repeated cancel requests. Cancel also stops a download that is still getting ready to
  start, and if the cancel request itself fails, the button can be pressed again.
