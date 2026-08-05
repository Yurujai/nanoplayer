#!/usr/bin/env bash
# Medios de la sonda S2.
#
# Restricción dominante: van INCRUSTADOS en el HTML en base64, y el fichero
# tiene que poder abrirse cómodamente desde un móvil con datos. Objetivo: unos
# pocos cientos de KB entre los dos.
#
# Por eso el patrón es un fondo plano con timecode encima en lugar de testsrc:
# comprime a casi nada y sigue permitiendo ver a ojo si los vídeos divergen.
#
# H.264 baseline + yuv420p: el perfil más ampliamente soportado que existe, para
# que un fallo en un dispositivo antiguo signifique "no puede", no "no entiende
# este perfil".
set -euo pipefail

cd "$(dirname "$0")/media"

DUR=${DUR:-20}
FONT=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}

if [ ! -f "$FONT" ]; then
  echo "No se encuentra la fuente: $FONT" >&2
  echo "Instala fonts-dejavu-core, o pasa la ruta con FONT=/ruta/a.ttf" >&2
  exit 1
fi

common_v="-c:v libx264 -profile:v baseline -level 3.0 -preset veryfast \
-pix_fmt yuv420p -crf 30 -g 30 -movflags +faststart"

echo "probe-a.mp4 (320x180, 30fps, con audio)..."
# shellcheck disable=SC2086
ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=0x102030:size=320x180:rate=30:duration=${DUR}" \
  -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=${DUR}" \
  -filter_complex "[0:v]drawbox=x='mod(t*40\,320)':y=0:w=8:h=180:color=0x88ff00:t=fill,\
drawtext=fontfile=${FONT}:text='A':x=10:y=8:fontsize=22:fontcolor=white,\
drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=10:y=70:fontsize=42:fontcolor=0x88ff00[v]" \
  -map "[v]" -map 1:a $common_v -c:a aac -b:a 48k -ar 44100 -shortest \
  probe-a.mp4

echo "probe-b.mp4 (320x180, 25fps, sin audio)..."
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
