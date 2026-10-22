### Fixed

- **"Reduce motion" now stops every animation.** With the system setting on (Windows: Settings →
  Accessibility → Visual effects → Animation effects off; macOS: Reduce motion), loading spinners
  kept spinning and taking a photo still flashed the whole window – twelve stylesheets had no
  reduced-motion rule. One rule for the whole app now ends every animation at once: spinners rest
  as a still ring, the camera flash no longer shows, and panels that slid in appear in place.
  Toasts keep their gentle fade. (#96)
