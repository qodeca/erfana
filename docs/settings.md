# Settings overlay

Full-screen settings dialog for app-wide configuration.

## Access

**Click**: Gear icon in left activity bar (bottom)
**Keyboard**: Escape to close

## UI features

- **Portal rendering**: Renders to `#portal-root`
- **Full-screen overlay**: Dark backdrop with centered content
- **Focus management**: Auto-focuses close button, restores focus on close
- **Keyboard support**: Escape key closes overlay

## Settings sections

### Editor

| Setting | Description | Default |
|---------|-------------|---------|
| Preserve line breaks | Show single line breaks as `<br>` in preview | Off |

### Git status

| Setting | Description | Default |
|---------|-------------|---------|
| Enable polling fallback | Periodic git status checks for unreliable file watchers | On |
| Polling interval | Check frequency (3s, 5s, 7s, 10s) | 5s |

### Logging

| Setting | Description | Default |
|---------|-------------|---------|
| Log level | Minimum severity for file logging (trace, debug, info, warn, error, fatal) | info |

### Transcription

| Setting | Description | Default |
|---------|-------------|---------|
| Backend | Transcription backend selection (OpenAI) | openai |
| OpenAI API key | API key for OpenAI transcription (stored encrypted via Electron safeStorage in `~/.erfana/`) | – |

**API key security**: Keys are encrypted using platform-native keychain (macOS Keychain, Linux libsecret, Windows DPAPI). The global settings JSON only stores a boolean `openaiApiKeyStored` flag, never the key itself. Plaintext fallback with warning if safeStorage unavailable.

## Storage

Settings persist to `~/.erfana/settings.json` via GlobalSettingsService.

## Implementation

**Location**: `src/renderer/src/components/Settings/SettingsOverlay.tsx`
**State**: `useSettingsStore` (open/close), `useGlobalSettingsStore` (values)
**Schema**: `src/shared/ipc/global-settings-schema.ts`

---

See: [Logging](./logging.md) | [File Watching](./file-watching/README.md) | [UI Components](./ui-components.md)
