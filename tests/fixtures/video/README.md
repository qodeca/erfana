# Video test fixtures

Sample video files for manual UAT of the video import with transcription feature (issue #110 / spec 009 stage 3).

All video files contain **real human speech** (Harvard sentences, female speaker) muxed with a synthetic test pattern, enabling word-for-word transcription verification.

## How they were created

Videos are generated locally using ffmpeg. The audio track comes from the existing audio fixture `speech-harvard-female.wav` (Open Speech Repository, ~34s). The video track is a synthetic `testsrc2` pattern at 640x360, 15 fps.

## Files

### Supported formats (`supported/`)

| File | Container | Video codec | Audio codec | Duration | Size |
|------|-----------|-------------|-------------|----------|------|
| `speech-harvard.mp4` | MP4 | H.264 | AAC 64 kbps | ~34s | 3.7 MB |
| `speech-harvard.mov` | MOV | H.264 | AAC 64 kbps | ~34s | 3.7 MB |
| `speech-harvard.avi` | AVI | H.264 | MP3 64 kbps | ~34s | 3.8 MB |
| `speech-harvard.mkv` | Matroska | H.264 | AAC 64 kbps | ~34s | 3.7 MB |
| `speech-harvard.webm` | WebM | VP8 | Vorbis 64 kbps | ~34s | 2.1 MB |
| `speech-harvard.flv` | FLV | FLV1 | MP3 64 kbps | ~34s | 2.4 MB |
| `speech-harvard.wmv` | ASF/WMV | WMV2 | WMA2 64 kbps | ~34s | 2.4 MB |

### No audio track (`no-audio/`)

| File | Container | Video codec | Audio | Duration | Size |
|------|-----------|-------------|-------|----------|------|
| `no-audio-track.mp4` | MP4 | H.264 | None | 5s | 184 KB |

## Generation commands

```bash
# Prerequisites: ffmpeg

# --- Supported formats ---
cd tests/fixtures/video/supported
AUDIO=../../audio/supported/speech-harvard-female.wav

# MP4 (H.264 + AAC)
ffmpeg -y -f lavfi -i "testsrc2=duration=34:size=640x360:rate=15" \
  -i "$AUDIO" -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p \
  -c:a aac -b:a 64k -shortest speech-harvard.mp4

# MOV (H.264 + AAC)
ffmpeg -y -f lavfi -i "testsrc2=duration=34:size=640x360:rate=15" \
  -i "$AUDIO" -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p \
  -c:a aac -b:a 64k -shortest -movflags +faststart -f mov speech-harvard.mov

# AVI (H.264 + MP3)
ffmpeg -y -f lavfi -i "testsrc2=duration=34:size=640x360:rate=15" \
  -i "$AUDIO" -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p \
  -c:a mp3 -b:a 64k -shortest speech-harvard.avi

# MKV (H.264 + AAC)
ffmpeg -y -f lavfi -i "testsrc2=duration=34:size=640x360:rate=15" \
  -i "$AUDIO" -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p \
  -c:a aac -b:a 64k -shortest speech-harvard.mkv

# WebM (VP8 + Vorbis)
ffmpeg -y -f lavfi -i "testsrc2=duration=34:size=640x360:rate=15" \
  -i "$AUDIO" -c:v libvpx -b:v 500k -c:a libvorbis -ar 44100 -b:a 64k \
  -shortest speech-harvard.webm

# FLV (FLV1 + MP3)
ffmpeg -y -f lavfi -i "testsrc2=duration=34:size=640x360:rate=15" \
  -i "$AUDIO" -c:v flv1 -b:v 500k -c:a mp3 -ar 44100 -b:a 64k \
  -shortest speech-harvard.flv

# WMV (WMV2 + WMA2)
ffmpeg -y -f lavfi -i "testsrc2=duration=34:size=640x360:rate=15" \
  -i "$AUDIO" -c:v wmv2 -b:v 500k -c:a wmav2 -b:a 64k \
  -shortest speech-harvard.wmv

# --- No audio track ---
cd ../no-audio
ffmpeg -y -f lavfi -i "testsrc2=duration=5:size=320x240:rate=10" \
  -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -an no-audio-track.mp4
```

## Test scenarios

### Happy path – video import with transcription

1. **MP4**: Import `speech-harvard.mp4` – verify:
   - TranscriptionDialog opens with "Transcribe video" title and FileVideo icon
   - Progress shows extraction phase (0–20%), then transcription phase (20–100%)
   - Transcription output contains Harvard sentences, e.g. "The birch canoe slid on the smooth planks"
   - Frontmatter includes `type: video`, `resolution`, `video_codec`

2. **All formats**: Import each format (MOV, AVI, MKV, WebM, FLV, WMV) – verify all produce recognizable transcription of the same Harvard sentences content

### Edge cases

3. **No audio track**: Import `no-audio-track.mp4` – verify error dialog with "no audio track" message and suggestion text
4. **Batch import**: Drag-drop multiple video files – verify toast: "Media files not supported in batch"
5. **Mixed batch**: Drag-drop video + text files together – verify video files skipped with toast, text files imported normally
6. **No API key**: Import video without API key configured – verify API key error with suggestion
7. **Cancel during extraction**: Start video import, cancel during extraction phase – verify cleanup (no zombie ffmpeg process)

### Verification checks

```bash
# Verify all fixtures have expected streams
for f in tests/fixtures/video/supported/*; do
  echo "--- $(basename "$f") ---"
  ffprobe -v error -show_entries stream=codec_type,codec_name \
    -show_entries format=duration,format_name \
    -of default=noprint_wrappers=1 "$f"
done

# Verify no-audio fixture has no audio stream
ffprobe -v error -show_entries stream=codec_type \
  -of default=noprint_wrappers=1 tests/fixtures/video/no-audio/no-audio-track.mp4
# Should output only: codec_type=video
```
