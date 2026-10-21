### Fixed

- **The app window now gets only the permissions it needs.** Only the camera (for photo capture) is
  allowed; every other browser permission is refused. The app page also sees a smaller set of
  functions.
- **An OpenAI key is never stored as plain text.** If the system cannot encrypt it (for example Linux
  without a keyring), Erfana says so and does not save it. Before, a failed save showed nothing.
  Project locks now use a stable random secret, so two windows on Windows recognise each other's lock.
