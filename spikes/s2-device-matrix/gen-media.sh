#!/usr/bin/env bash
# Media for the S2 probe.
#
# The dominant constraint: they are EMBEDDED in the HTML in base64, and the file
# has to open comfortably on a phone on mobile data. Target: a few hundred KB
# for both.
#
# Hence a flat background with a timecode on top instead of testsrc: it
# compresses to almost nothing and still lets you see by eye whether the videos
# drift apart.
#
# H.264 baseline + yuv420p: the most widely supported profile there is, so that
# a failure on an old device means "cannot", not "does not understand this
# profile".
set -euo pipefail

# media/ is in .gitignore, so a clean clone does not have it.
mkdir -p "$(dirname "$0")/media"
cd "$(dirname "$0")/media"

DUR=${DUR:-20}
FONT=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}

if [ ! -f "$FONT" ]; then
  echo "Font not found: $FONT" >&2
  echo "Install fonts-dejavu-core, or pass the path with FONT=/path/to.ttf" >&2
  exit 1
fi

common_v="-c:v libx264 -profile:v baseline -level 3.0 -preset veryfast \
-pix_fmt yuv420p -crf 30 -g 30 -movflags +faststart"

echo "probe-a.mp4 (320x180, 30fps, with audio)..."
# shellcheck disable=SC2086
ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=0x102030:size=320x180:rate=30:duration=${DUR}" \
  -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=${DUR}" \
  -filter_complex "[0:v]drawbox=x='mod(t*40\,320)':y=0:w=8:h=180:color=0x88ff00:t=fill,\
drawtext=fontfile=${FONT}:text='A':x=10:y=8:fontsize=22:fontcolor=white,\
drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=10:y=70:fontsize=42:fontcolor=0x88ff00[v]" \
  -map "[v]" -map 1:a $common_v -c:a aac -b:a 48k -ar 44100 -shortest \
  probe-a.mp4

echo "probe-b.mp4 (320x180, 25fps, no audio)..."
# shellcheck disable=SC2086
ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=0x301020:size=320x180:rate=25:duration=${DUR}" \
  -vf "drawbox=x='mod(t*40\,320)':y=0:w=8:h=180:color=0x00ccff:t=fill,\
drawtext=fontfile=${FONT}:text='B':x=10:y=8:fontsize=22:fontcolor=white,\
drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=10:y=70:fontsize=42:fontcolor=0x00ccff" \
  $common_v -an \
  probe-b.mp4

echo
ls -lh probe-a.mp4 probe-b.mp4
