#!/usr/bin/env bash
# Genera dos emisiones HLS en vivo simuladas, para medir si se pueden
# sincronizar entre sí.
#
# Las dos salen del **mismo proceso y el mismo instante**, así que están
# alineadas en origen por construcción. Es a propósito: el spike no pregunta si
# Wowza alinea bien las fuentes —eso es trabajo de Wowza— sino si **el
# reproductor puede mantenerlas juntas** partiendo de fuentes correctas.
#
# Cada vídeo lleva incrustado el **reloj de pared**, no un contador de tiempo
# propio. Con `%{pts}` ambos marcarían lo mismo por definición y no se vería
# nada; con la hora real, dos fotogramas con la misma hora son el mismo
# instante, y eso permite comprobar la deriva a simple vista.
#
#   ./stream.sh            emite con EXT-X-PROGRAM-DATE-TIME
#   PDT=0 ./stream.sh      emite sin la etiqueta, para comparar
#
# Se para con Ctrl-C.
set -euo pipefail

cd "$(dirname "$0")"
SALIDA=${SALIDA:-vivo}
PDT=${PDT:-1}
SIZE=${SIZE:-640x360}
SEG=${SEG:-2}
FONT=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}

if [ ! -f "$FONT" ]; then
  echo "No se encuentra la fuente: $FONT" >&2
  exit 1
fi

rm -rf "$SALIDA" && mkdir -p "$SALIDA"

BANDERAS="delete_segments+independent_segments"
if [ "$PDT" = "1" ]; then
  BANDERAS="$BANDERAS+program_date_time"
  echo "Emitiendo CON EXT-X-PROGRAM-DATE-TIME"
else
  echo "Emitiendo SIN EXT-X-PROGRAM-DATE-TIME"
fi

# El reloj de pared con centésimas: sin ellas no se aprecian derivas menores de
# un segundo, que son justo las interesantes.
reloj() {
  echo "drawtext=fontfile=${FONT}:text='%{localtime\\:%H\\\\\\:%M\\\\\\:%S}.%{eif\\:mod(t*100,100)\\:d\\:2}'"\
":x=(w-tw)/2:y=(h-th)/2:fontsize=(w/11):fontcolor=$1:box=1:boxcolor=black@0.65:boxborderw=12"
}
etiqueta() {
  echo "drawtext=fontfile=${FONT}:text='$1':x=(w/30):y=(h/22):fontsize=(w/22):fontcolor=white"
}

lanzar() {
  local nombre="$1" patron="$2" color="$3" fps="$4"
  # -re emite a tiempo real, que es lo que convierte esto en un directo.
  ffmpeg -hide_banner -loglevel error -re \
    -f lavfi -i "${patron}=size=${SIZE}:rate=${fps}" \
    -vf "$(etiqueta "${nombre} ${fps}fps"),$(reloj "$color")" \
    -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
    -g $(( fps * SEG )) -keyint_min $(( fps * SEG )) -sc_threshold 0 \
    -f hls -hls_time "$SEG" -hls_list_size 6 -hls_flags "$BANDERAS" \
    -hls_segment_filename "${SALIDA}/${nombre}%04d.ts" \
    "${SALIDA}/${nombre}.m3u8" &
  echo "  $nombre → ${SALIDA}/${nombre}.m3u8  (pid $!)"
}

echo "Segmentos de ${SEG}s, ventana de 6."
# Framerates distintos a propósito, como en S1: en dual-stream real las dos
# fuentes rara vez coinciden.
lanzar presenter testsrc2 0x88ff00 30
lanzar slides    testsrc  0x00ccff 25

trap 'echo; echo "Parando…"; kill $(jobs -p) 2>/dev/null || true; wait 2>/dev/null || true' INT TERM
echo "Emitiendo. Ctrl-C para parar."
wait
