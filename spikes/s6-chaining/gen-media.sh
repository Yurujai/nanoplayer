#!/usr/bin/env bash
# Generates the test media for spike S6.
#
# Three pieces with a **flat, saturated colour background**, different in each.
# It is not decoration: it is the instrument. If the browser leaves a gap
# between one and the next, it shows as a black flash over a background that
# is never black. A video with real footage would hide exactly what has to be
# measured.
#
# Different frame rates (25 / 30 / 25) on purpose, as in S1: in production the
# institutional intro and the lecture recording rarely match, and a frame-rate
# change is among the hardest things to splice.
#
# The intro carries a **countdown**: whoever watches the screen knows when the
# seam is coming and can look right there.
set -euo pipefail

mkdir -p "$(dirname "$0")/media"
cd "$(dirname "$0")/media"

# Short durations: what is measured is the seams, not the content. An 8 s
# intro is also the realistic length of an institutional bumper.
DUR_INTRO=${DUR_INTRO:-8}
DUR_MAIN=${DUR_MAIN:-30}
DUR_OUTRO=${DUR_OUTRO:-6}

SIZE=${SIZE:-1280x720}
CRF=${CRF:-23}
FONT=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}

# `drawtext` needs ffmpeg built with libfreetype, and Homebrew's on macOS
# **does not have it**. Instead of failing, it degrades: the text helps, but
# the real instrument is the flat colour, and that does not depend on any
# optional filter.
if ffmpeg -hide_banner -filters 2>/dev/null | grep -q drawtext; then
  HAS_TEXT=1
else
  HAS_TEXT=0
  echo "WARNING: this ffmpeg lacks the drawtext filter (no libfreetype)."
  echo "         The videos will have no timecode or countdown. The flat colour"
  echo "         and the moving box are still enough to see the seams."
  echo "         To get it on macOS: brew tap homebrew-ffmpeg/ffmpeg"
  echo "                             brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-freetype"
  echo
fi

if [ "$HAS_TEXT" = "1" ] && [ ! -f "$FONT" ]; then
  for f in \
    /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf \
    /System/Library/Fonts/Supplemental/Arial\ Bold.ttf \
    /Library/Fonts/Arial\ Bold.ttf
  do
    [ -f "$f" ] && FONT="$f" && break
  done
  if [ ! -f "$FONT" ]; then
    echo "WARNING: no font found; generating without text." >&2
    HAS_TEXT=0
  fi
fi

# A white box that crosses the screen every 4 seconds.
#
# Not an ornament: over a flat colour background **there is no way to tell
# whether the video advances or is frozen**, and telling "it got stuck" from
# "it keeps playing" is exactly what has to be watched at a seam. `drawbox` is
# a basic filter and is in every build, unlike drawtext.
MOVING="drawbox=x='(iw-iw/8)*mod(t\,4)/4':y='(ih-ih/8)/2':w='iw/8':h='ih/8':color=white:t=fill"

# The text filters are only added if drawtext is available.
layer() {
  local label="$1" dur="$2" filters="${MOVING}"
  if [ "$HAS_TEXT" = "1" ]; then
    filters="${filters},drawtext=fontfile=${FONT}:text='${label}':x=(w-tw)/2:y=(h/2-h/8):fontsize=(w/12):fontcolor=white"
    filters="${filters},drawtext=fontfile=${FONT}:text='%{eif\:max(0\,${dur}-t)\:d}':x=(w-tw)/2:y=(h/2+h/24):fontsize=(w/8):fontcolor=white"
    filters="${filters},drawtext=fontfile=${FONT}:text='%{pts\:hms}':x=(w/40):y=(h-h/8):fontsize=(w/18):fontcolor=white@0.85"
    filters="${filters},drawtext=fontfile=${FONT}:text='f%{n}':x=(w-tw-w/40):y=(h-h/8):fontsize=(w/18):fontcolor=white@0.85"
  fi
  echo "${filters}"
}

# --- intro -----------------------------------------------------------------
echo "Generating intro.mp4 (magenta, ${DUR_INTRO}s, 25fps, with audio)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=0xB5179E:size=${SIZE}:rate=25:duration=${DUR_INTRO}" \
  -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=${DUR_INTRO}" \
  -filter_complex "[0:v]$(layer 'INTRO' "${DUR_INTRO}")[v]" \
  -map "[v]" -map 1:a \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf "${CRF}" -g 50 \
  -c:a aac -b:a 128k -movflags +faststart -shortest \
  intro.mp4

# --- main content ----------------------------------------------------------
echo "Generating main.mp4 (green, ${DUR_MAIN}s, 30fps, with audio)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=0x1B7F3B:size=${SIZE}:rate=30:duration=${DUR_MAIN}" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=${DUR_MAIN}" \
  -filter_complex "[0:v]$(layer 'MAIN' "${DUR_MAIN}")[v]" \
  -map "[v]" -map 1:a \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf "${CRF}" -g 60 \
  -c:a aac -b:a 128k -movflags +faststart -shortest \
  main.mp4

# --- outro -----------------------------------------------------------------
echo "Generating outro.mp4 (orange, ${DUR_OUTRO}s, 25fps, with audio)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=0xE07A1F:size=${SIZE}:rate=25:duration=${DUR_OUTRO}" \
  -f lavfi -i "sine=frequency=330:sample_rate=48000:duration=${DUR_OUTRO}" \
  -filter_complex "[0:v]$(layer 'OUTRO' "${DUR_OUTRO}")[v]" \
  -map "[v]" -map 1:a \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf "${CRF}" -g 50 \
  -c:a aac -b:a 128k -movflags +faststart -shortest \
  outro.mp4

echo
ls -lh intro.mp4 main.mp4 outro.mp4
echo "Done."
