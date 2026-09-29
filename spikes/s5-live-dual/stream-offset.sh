#!/usr/bin/env bash
# Like stream.sh, but **starting the second stream later**.
#
# That is the realistic case: two encoders someone starts separately. With
# playlist windows that begin at different moments, `currentTime` stops being
# comparable — and that is exactly the situation to demonstrate.
set -euo pipefail
cd "$(dirname "$0")"
OUT=live; SIZE=${SIZE:-640x360}; SEG=${SEG:-2}
DELAY=${DELAY:-8}
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
rm -rf "$OUT" && mkdir -p "$OUT"

clock() {
  echo "drawtext=fontfile=${FONT}:text='%{localtime\\:%H\\\\\\:%M\\\\\\:%S}.%{eif\\:mod(t*100,100)\\:d\\:2}'"\
":x=(w-tw)/2:y=(h-th)/2:fontsize=(w/11):fontcolor=$1:box=1:boxcolor=black@0.65:boxborderw=12"
}
label() { echo "drawtext=fontfile=${FONT}:text='$1':x=(w/30):y=(h/22):fontsize=(w/22):fontcolor=white"; }

launch() {
  ffmpeg -hide_banner -loglevel error -re \
    -f lavfi -i "$2=size=${SIZE}:rate=$4" \
    -vf "$(label "$1 $4fps"),$(clock "$3")" \
    -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
    -g $(( $4 * SEG )) -keyint_min $(( $4 * SEG )) -sc_threshold 0 \
    -f hls -hls_time "$SEG" -hls_list_size 6 \
    -hls_flags delete_segments+independent_segments+program_date_time \
    -hls_segment_filename "${OUT}/$1%04d.ts" "${OUT}/$1.m3u8" &
  echo "  $1 started (pid $!)"
}
echo "presenter starts now; slides ${DELAY}s later."
launch presenter testsrc2 0x88ff00 30
sleep "$DELAY"
launch slides testsrc 0x00ccff 25
trap 'kill $(jobs -p) 2>/dev/null || true' INT TERM
wait
