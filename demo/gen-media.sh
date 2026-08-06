#!/usr/bin/env bash
# Genera los medios de prueba de la demo.
#
# Dos vídeos con timecode incrustado, para que la deriva sea visible a simple
# vista además de medible. Framerates distintos (30 / 25) a propósito: en
# dual-stream real las dos fuentes rara vez coinciden, y ahí es donde aparece.
#
# GOP de 2 segundos, que es lo realista en producción. Importa porque limita la
# precisión del seek: un `currentTime = X` cae al keyframe previo, y eso hay que
# distinguirlo de un fallo del algoritmo de sincronización.
#
# Todo el texto se dimensiona en proporción al fotograma, y el contador de
# frames se alinea a la derecha con `tw` (ancho del texto). Con tamaños fijos,
# al bajar la resolución para publicar, el timecode y el contador se solapaban.
set -euo pipefail

# media/ está en .gitignore, así que en un clon limpio no existe.
mkdir -p "$(dirname "$0")/public/media"
cd "$(dirname "$0")/public/media"

DUR=${DUR:-60}
# Ajustables para publicar una versión ligera sin tocar la de trabajo local.
SIZE=${SIZE:-1280x720}
CRF=${CRF:-23}
FONT=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}

if [ ! -f "$FONT" ]; then
  echo "No se encuentra la fuente: $FONT" >&2
  echo "Instala fonts-dejavu-core, o pasa la ruta con FONT=/ruta/a.ttf" >&2
  exit 1
fi

BOX="drawbox=x=0:y=(ih-ih/4):w=iw:h=(ih/4):color=black@0.8:t=fill"
label()  { echo "drawtext=fontfile=${FONT}:text='$1':x=(w/40):y=(h-h/4+h/40):fontsize=(w/30):fontcolor=white"; }
tc()     { echo "drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=(w/40):y=(h-h/6):fontsize=(w/14):fontcolor=$1"; }
frames() { echo "drawtext=fontfile=${FONT}:text='f%{n}':x=(w-tw-w/40):y=(h-h/6):fontsize=(w/14):fontcolor=$1"; }

echo "Generando presenter.mp4 (${SIZE}, 30fps, con audio)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=${SIZE}:rate=30:duration=${DUR}" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=${DUR}" \
  -filter_complex "[0:v]${BOX},$(label 'PRESENTER 30fps'),$(tc 0x88ff00),$(frames 0x88ff00)[v]" \
  -map "[v]" -map 1:a \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf "${CRF}" -g 60 -c:a aac -b:a 128k \
  -movflags +faststart -shortest \
  presenter.mp4

echo "Generando slides.mp4 (${SIZE}, 25fps, sin audio)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc=size=${SIZE}:rate=25:duration=${DUR}" \
  -vf "${BOX},$(label 'SLIDES 25fps'),$(tc 0x00ccff),$(frames 0x00ccff)" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf "${CRF}" -g 50 -an \
  -movflags +faststart \
  slides.mp4

# --- solo audio ---
# Una locución sintética serviría, pero un tono con armónicos basta para oír
# que suena y para que la duración sea la misma que la del vídeo.
echo "Generando audio.m4a (solo sonido)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "sine=frequency=330:sample_rate=44100:duration=${DUR}" \
  -f lavfi -i "sine=frequency=495:sample_rate=44100:duration=${DUR}" \
  -filter_complex "[0:a][1:a]amix=inputs=2:duration=first,volume=0.5[a]" \
  -map "[a]" -c:a aac -b:a 96k audio.m4a

# --- HLS, para el motor con hls.js ---
# `-c copy` reempaqueta sin recodificar: los segmentos pesan lo mismo que el
# MP4 de origen y la generación es instantánea.
echo "Generando HLS (segmentos de 2 s)..."
rm -rf hls && mkdir -p hls
ffmpeg -y -loglevel error -i presenter.mp4 \
  -c copy -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_filename 'hls/presenter%03d.ts' hls/presenter.m3u8
ffmpeg -y -loglevel error -i slides.mp4 \
  -c copy -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_filename 'hls/slides%03d.ts' hls/slides.m3u8

echo "Generando poster.jpg (fotograma del ponente)..."
ffmpeg -y -loglevel error -ss 3 -i presenter.mp4 -frames:v 1 -vf scale=960:-1 poster.jpg

echo
ls -lh presenter.mp4 slides.mp4 poster.jpg audio.m4a
ls hls/*.m3u8 | sed "s/^/  /"
echo "Listo."
