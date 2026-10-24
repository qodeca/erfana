### Internal

- **The whisper binaries workflow can run again.** `whisper-binaries.yml` now reads the signing
  secrets that actually exist in the `production-signing` environment – the same names
  `release.yml` uses (`MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `MINISIGN_SECRET_KEY_BASE64`, `MINISIGN_KEY_PASSWORD`) – and the Windows build lets CMake pick
  the installed Visual Studio instead of pinning Visual Studio 2022, which `windows-latest` no
  longer ships. The runbooks list the real secret names.
