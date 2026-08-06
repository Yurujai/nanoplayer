#!/usr/bin/env bash
# Como stream.sh, pero **arrancando el segundo flujo más tarde**.
#
# Es lo realista: dos codificadores que alguien pone en marcha por separado. Con
# ventanas de lista que empiezan en momentos distintos, `currentTime` deja de
# ser comparable — y esa es justo la situación que hay que demostrar.
set -euo pipefail
cd "$(dirname "$0")"
SALIDA=vivo; SIZE=${SIZE:-640x360}; SEG=${SEG:-2}
RETRASO=${RETRASO:-8}
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
rm -rf "$SALIDA" && mkdir -p "$SALIDA"

reloj() {
  echo "drawtext=fontfile=${FONT}:text='%{localtime\\:%H\\\\\\:%M\\\\\\:%S}.%{eif\\:mod(t*100,100)\\:d\\:2}'"\
":x=(w-tw)/2:y=(h-th)/2:fontsize=(w/11):fontcolor=$1:box=1:boxcolor=black@0.65:boxborderw=12"
}
etq() { echo "drawtext=fontfile=${FONT}:text='$1':x=(w/30):y=(h/22):fontsize=(w/22):fontcolor=white"; }

lanzar() {
  ffmpeg -hide_banner -loglevel error -re \
    -f lavfi -i "$2=size=${SIZE}:rate=$4" \
    -vf "$(etq "$1 $4fps"),$(reloj "$3")" \
    -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
    -g $(( $4 * SEG )) -keyint_min $(( $4 * SEG )) -sc_threshold 0 \
    -f hls -hls_time "$SEG" -hls_list_size 6 \
    -hls_flags delete_segments+independent_segments+program_date_time \
    -hls_segment_filename "${SALIDA}/$1%04d.ts" "${SALIDA}/$1.m3u8" &
  echo "  $1 arrancado (pid $!)"
}
echo "presenter arranca ya; slides ${RETRASO}s después."
lanzar presenter testsrc2 0x88ff00 30
sleep "$RETRASO"
lanzar slides testsrc 0x00ccff 25
trap 'kill $(jobs -p) 2>/dev/null || true' INT TERM
wait
