# Audio test fixtures

Sample audio files for manual UAT of the audio transcription feature (issue #75 / spec 009).

## Source

All files downloaded from [getsamplefiles.com](https://getsamplefiles.com/sample-audio-files) – free, royalty-free sample files for testing purposes.

## Files

### Supported formats (`supported/`)

| File | Format | Source URL | Size |
|------|--------|-----------|------|
| `sample.mp3` | MP3 | `https://getsamplefiles.com/download/mp3/sample-3.mp3` | ~326 KB |
| `sample.wav` | WAV | `https://getsamplefiles.com/download/wav/sample-3.wav` | ~2.5 MB |
| `sample.m4a` | M4A | `https://getsamplefiles.com/download/m4a/sample-3.m4a` | ~335 KB |
| `sample.ogg` | OGG | `https://getsamplefiles.com/download/ogg/sample-4.ogg` | ~256 KB |
| `sample.flac` | FLAC | `https://getsamplefiles.com/download/flac/sample-3.flac` | ~1.9 MB |
| `sample.aac` | AAC | `https://getsamplefiles.com/download/aac/sample-3.aac` | ~335 KB |
| `sample.wma` | WMA | `https://getsamplefiles.com/download/wma/sample-3.wma` | ~932 KB |

### Unsupported formats (`unsupported/`)

These are valid audio files in formats **not** listed in `SUPPORTED_EXTENSIONS`. Use them for edge-case testing (should be rejected by import validation).

| File | Format | Source URL | Size |
|------|--------|-----------|------|
| `sample.aif` | AIFF | `https://getsamplefiles.com/download/aiff/sample-3.aif` | ~2.5 MB |
| `sample.opus` | Opus | `https://getsamplefiles.com/download/opus/sample-3.opus` | ~689 KB |

## Download instructions

Audio binaries are gitignored. To recreate the fixtures locally:

```bash
# Supported formats
cd tests/fixtures/audio/supported
curl -L -f -o sample.mp3  "https://getsamplefiles.com/download/mp3/sample-3.mp3"
curl -L -f -o sample.wav  "https://getsamplefiles.com/download/wav/sample-3.wav"
curl -L -f -o sample.m4a  "https://getsamplefiles.com/download/m4a/sample-3.m4a"
curl -L -f -o sample.ogg  "https://getsamplefiles.com/download/ogg/sample-4.ogg"
curl -L -f -o sample.flac "https://getsamplefiles.com/download/flac/sample-3.flac"
curl -L -f -o sample.aac  "https://getsamplefiles.com/download/aac/sample-3.aac"
curl -L -f -o sample.wma  "https://getsamplefiles.com/download/wma/sample-3.wma"

# Unsupported formats
cd ../unsupported
curl -L -f -o sample.aif  "https://getsamplefiles.com/download/aiff/sample-3.aif"
curl -L -f -o sample.opus "https://getsamplefiles.com/download/opus/sample-3.opus"
```

## Test scenarios

### Happy path
1. Import each supported file via drag-drop into Erfana
2. Verify TranscriptionDialog opens with language selection
3. Confirm transcription completes and markdown file is created

### Edge cases
- Import an unsupported format (`.aif`, `.opus`) – should be rejected with a toast notification
- Import multiple audio files at once via batch drag-drop – should be rejected with a toast
- Import audio without an API key configured – should show API key prompt

### Validation checks
- Verify `file` command recognizes each download as audio:
  ```bash
  file tests/fixtures/audio/supported/*
  file tests/fixtures/audio/unsupported/*
  ```
