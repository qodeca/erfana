# Audio test fixtures

Sample speech audio files for manual UAT of the audio transcription feature (issue #75 / spec 009).

All files contain **real human speech with known content**, enabling word-for-word transcription verification.

## Sources

### Open Speech Repository (Harvard sentences)

- **URL**: `http://www.voiptroubleshooter.com/open_speech/american.html`
- **License**: Free to use, publish, and broadcast. Credit "Open Speech Repository".
- **Content**: Harvard sentences – standardized phonetically balanced sentences used in speech research.

### NCH Express Scribe (legal dictation)

- **URL**: `https://www.nch.com.au/scribe/practice/audio-sample-1.mp3`
- **Reference transcript**: `https://www.nch.com.au/scribe/practice/completed-transcription-1.pdf`
- **License**: Practice sample provided by NCH Software for testing purposes.
- **Content**: Legal dictation – realistic conversational speech from a legal interview.

### LibriVox via Internet Archive (audiobook)

- **URL**: `https://archive.org/download/stories_001_librivox/telltale_heart_poe_dm_64kb.mp3`
- **License**: Public domain (LibriVox recording of a public domain text).
- **Content**: "The Tell-Tale Heart" by Edgar Allan Poe – well-known text for easy verification.

## Files

### Supported formats (`supported/`)

| File | Format | Source | Duration | Size |
|------|--------|--------|----------|------|
| `speech-harvard-female.wav` | WAV (PCM 16-bit, 8 kHz mono) | Open Speech Repository – female speaker | ~34s | 0.5 MB |
| `speech-harvard-male.wav` | WAV (PCM 16-bit, 8 kHz mono) | Open Speech Repository – male speaker | ~47s | 0.7 MB |
| `speech-legal.mp3` | MP3 (128 kbps, 16 kHz mono) | NCH Express Scribe | ~6 min 12s | 5.7 MB |
| `speech-legal.m4a` | M4A (AAC 128 kbps) | Converted from MP3 | ~6 min 12s | 3.2 MB |
| `speech-legal.ogg` | OGG (Vorbis, quality 4) | Converted from MP3 | ~6 min 12s | 1.8 MB |
| `speech-legal.flac` | FLAC (lossless) | Converted from MP3 | ~6 min 12s | 11.3 MB |
| `speech-legal.aac` | AAC (raw ADTS, 128 kbps) | Converted from MP3 | ~6 min 12s | 3.2 MB |
| `speech-legal.wma` | WMA (WMAv2, 128 kbps) | Converted from MP3 | ~6 min 12s | 5.9 MB |
| `speech-poe-telltale.mp3` | MP3 (64 kbps, 22.05 kHz) | LibriVox – "The Tell-Tale Heart" | ~18 min 9s | 8.3 MB |

### Unsupported formats (`unsupported/`)

Valid audio files in formats **not** listed in `SUPPORTED_EXTENSIONS`. Used for edge-case testing (should be rejected by import validation).

| File | Format | Source | Duration | Size |
|------|--------|--------|----------|------|
| `speech-legal.aif` | AIFF (PCM 16-bit big-endian) | Converted from MP3 | ~6 min 12s | 11.4 MB |
| `speech-legal.opus` | Opus | Converted from MP3 | ~6 min 12s | 3.7 MB |

## Download and conversion instructions

Audio binaries are committed to git. To recreate or update the fixtures:

```bash
# Prerequisites: curl, ffmpeg

# --- Download source files ---
cd tests/fixtures/audio/supported

# Open Speech Repository – Harvard sentences
curl -L -f -o speech-harvard-female.wav \
  "http://www.voiptroubleshooter.com/open_speech/american/OSR_us_000_0010_8k.wav"
curl -L -f -o speech-harvard-male.wav \
  "http://www.voiptroubleshooter.com/open_speech/american/OSR_us_000_0030_8k.wav"

# NCH Express Scribe – legal dictation
curl -L -f -o speech-legal.mp3 \
  "https://www.nch.com.au/scribe/practice/audio-sample-1.mp3"

# LibriVox – "The Tell-Tale Heart" (~18 min, tests chunking)
curl -L -f -o speech-poe-telltale.mp3 \
  "https://archive.org/download/stories_001_librivox/telltale_heart_poe_dm_64kb.mp3"

# --- Convert to remaining supported formats ---
ffmpeg -y -i speech-legal.mp3 -c:a aac -b:a 128k speech-legal.m4a
ffmpeg -y -i speech-legal.mp3 -c:a libvorbis -q:a 4 speech-legal.ogg
ffmpeg -y -i speech-legal.mp3 -c:a flac speech-legal.flac
ffmpeg -y -i speech-legal.mp3 -c:a aac -b:a 128k -f adts speech-legal.aac
ffmpeg -y -i speech-legal.mp3 -c:a wmav2 -b:a 128k speech-legal.wma

# --- Convert to unsupported formats ---
cd ../unsupported
ffmpeg -y -i ../supported/speech-legal.mp3 -c:a pcm_s16be speech-legal.aif
ffmpeg -y -i ../supported/speech-legal.mp3 -c:a libopus speech-legal.opus
```

## Test scenarios

### Happy path – transcription accuracy

1. **Harvard sentences (WAV)**: Import `speech-harvard-female.wav` – verify transcription contains recognizable Harvard sentences. Expected snippets:
   - "The birch canoe slid on the smooth planks"
   - "Glue the sheet to the dark blue background"
2. **Legal dictation (MP3)**: Import `speech-legal.mp3` – verify transcription matches legal dictation content. Compare against [reference transcript PDF](https://www.nch.com.au/scribe/practice/completed-transcription-1.pdf).
3. **All format conversions**: Import each converted format (M4A, OGG, FLAC) – verify all produce recognizable transcription matching the legal dictation content. Since all are derived from the same source, transcription output should be essentially identical.

### Chunking (long file)

4. **Long audiobook**: Import `speech-poe-telltale.mp3` (~18 min, exceeds 8 min chunking threshold) – verify:
   - Progress dialog shows "chunk N of M" during processing
   - Full text is assembled from all chunks
   - Transcription contains recognizable Poe text, e.g. "TRUE! – nervous – very, very dreadfully nervous"

### Edge cases

5. **Unsupported format**: Import `.aif` or `.opus` file – rejected with toast notification
6. **Batch import**: Import multiple audio files at once via drag-drop – rejected with toast
7. **No API key**: Import audio without an API key configured – shows API key prompt

## Validation checks

Verify downloads are valid audio files:

```bash
# Check file types
file tests/fixtures/audio/supported/*
file tests/fixtures/audio/unsupported/*

# Check durations and codecs
for f in tests/fixtures/audio/supported/* tests/fixtures/audio/unsupported/*; do
  echo "--- $(basename "$f") ---"
  ffprobe -v error -show_entries format=duration,format_name -show_entries stream=codec_name,sample_rate,channels -of default=noprint_wrappers=1 "$f"
done
```
