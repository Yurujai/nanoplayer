#!/usr/bin/env bash
# Generates two simulated live HLS broadcasts, to measure whether they can be
# kept in sync with each other.
#
# Both come from the **same process at the same instant**, so they are aligned
# at the source by construction. On purpose: the spike does not ask whether
# Wowza aligns the sources well —that is Wowza's job— but whether **the player
# can keep them together** starting from correct sources.
#
# Each video carries the **wall clock** burned in, not a timer of its own. With
# `%{pts}` both would read the same by definition and nothing would show; with
# the real time, two frames showing the same time are the same instant, which
# makes drift visible to the naked eye.
#
#   ./stream.sh            broadcasts with EXT-X-PROGRAM-DATE-TIME
#   PDT=0 ./stream.sh      broadcasts without the tag, for comparison
#
# Stop with Ctrl-C.
set -euo pipefail

cd "$(dirname "$0")"
OUT=${OUT:-live}
PDT=${PDT:-1}
SIZE=${SIZE:-640x360}
SEG=${SEG:-2}
FONT=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}

if [ ! -f "$FONT" ]; then
  echo "Font not found: $FONT" >&2
  exit 1
fi

rm -rf "$OUT" && mkdir -p "$OUT"

FLAGS="delete_segments+independent_segments"
if [ "$PDT" = "1" ]; then
  FLAGS="$FLAGS+program_date_time"
  echo "Broadcasting WITH EXT-X-PROGRAM-DATE-TIME"
else
  echo "Broadcasting WITHOUT EXT-X-PROGRAM-DATE-TIME"
fi

# The wall clock with hundredths: without them, drifts under a second do not
# show, and those are exactly the interesting ones.
clock() {
  echo "drawtext=fontfile=${FONT}:text='%{localtime\\:%H\\\\\\:%M\\\\\\:%S}.%{eif\\:mod(t*100,100)\\:d\\:2}'"\
":x=(w-tw)/2:y=(h-th)/2:fontsize=(w/11):fontcolor=$1:box=1:boxcolor=black@0.65:boxborderw=12"
}
label() {
  echo "drawtext=fontfile=${FONT}:text='$1':x=(w/30):y=(h/22):fontsize=(w/22):fontcolor=white"
}

launch() {
  local name="$1" pattern="$2" color="$3" fps="$4"
  # -re emits in real time, which is what makes this a live stream.
  ffmpeg -hide_banner -loglevel error -re \
    -f lavfi -i "${pattern}=size=${SIZE}:rate=${fps}" \
    -vf "$(label "${name} ${fps}fps"),$(clock "$color")" \
    -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
    -g $(( fps * SEG )) -keyint_min $(( fps * SEG )) -sc_threshold 0 \
    -f hls -hls_time "$SEG" -hls_list_size 6 -hls_flags "$FLAGS" \
    -hls_segment_filename "${OUT}/${name}%04d.ts" \
    "${OUT}/${name}.m3u8" &
  echo "  $name → ${OUT}/${name}.m3u8  (pid $!)"
}

echo "${SEG}s segments, window of 6."
# Different frame rates on purpose, as in S1: in real dual-stream the two
# sources rarely match.
launch presenter testsrc2 0x88ff00 30
launch slides    testsrc  0x00ccff 25

trap 'echo; echo "Stopping…"; kill $(jobs -p) 2>/dev/null || true; wait 2>/dev/null || true' INT TERM
echo "Broadcasting. Ctrl-C to stop."
wait
