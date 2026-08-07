#!/usr/bin/env bash
# Emisión con ventana DVR amplia, para probar el retroceso y el "ir al directo".
#
# `hls_list_size 60` con segmentos de 2 s son **dos minutos** de ventana, que es
# suficiente para retrasarse de verdad. En Wowza esto lo gobierna nDVR.
set -euo pipefail
cd "$(dirname "$0")"
F=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
rm -rf vivo && mkdir -p vivo
reloj(){ echo "drawtext=fontfile=$F:text='%{localtime\\:%H\\\\\\:%M\\\\\\:%S}':x=(w-tw)/2:y=(h-th)/2:fontsize=(w/10):fontcolor=$1:box=1:boxcolor=black@0.6:boxborderw=14"; }
lanzar(){ ffmpeg -hide_banner -loglevel error -re -f lavfi -i "$2=size=640x360:rate=$4" \
  -vf "$(reloj "$3")" -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
  -g $(( $4*2 )) -keyint_min $(( $4*2 )) -sc_threshold 0 \
  -f hls -hls_time 2 -hls_list_size 60 -hls_flags delete_segments+program_date_time \
  -hls_segment_filename "vivo/$1%04d.ts" "vivo/$1.m3u8" & }
echo "Ventana DVR de ~2 minutos."
lanzar presenter testsrc2 0x88ff00 30
lanzar slides    testsrc  0x00ccff 25
trap 'kill $(jobs -p) 2>/dev/null || true' INT TERM
wait
