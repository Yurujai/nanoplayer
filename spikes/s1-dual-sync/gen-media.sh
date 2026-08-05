#!/usr/bin/env bash
# Genera los medios de prueba del spike S1.
#
# Dos vídeos con timecode incrustado, para que la deriva sea visible a simple
# vista además de medible. Framerates distintos (30 / 25) a propósito: en
# dual-stream real las dos fuentes rara vez coinciden, y ahí es donde aparece.
#
# GOP de 2 segundos, que es lo realista en producción. Importa porque limita la
# precisión del seek: un `currentTime = X` cae al keyframe previo, y eso hay que
# distinguirlo de un fallo del algoritmo de sincronización.
set -euo pipefail

# media/ está en .gitignore, así que en un clon limpio no existe.
mkdir -p "$(dirname "$0")/media"
cd "$(dirname "$0")/media"

DUR=${DUR:-90}
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf

echo "Generando presenter.mp4 (1280x720, 30fps, con audio)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=${DUR}" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=${DUR}" \
  -filter_complex "[0:v]drawbox=x=0:y=520:w=1280:h=200:color=black@0.8:t=fill,\
drawtext=fontfile=${FONT}:text='PRESENTER 30fps':x=40:y=540:fontsize=44:fontcolor=white,\
drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=40:y=600:fontsize=88:fontcolor=0x88ff00,\
drawtext=fontfile=${FONT}:text='f%{n}':x=980:y=600:fontsize=88:fontcolor=0x88ff00[v]" \
  -map "[v]" -map 1:a \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 60 -c:a aac -b:a 128k \
  -movflags +faststart -shortest \
  presenter.mp4

echo "Generando slides.mp4 (1280x720, 25fps, sin audio)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc=size=1280x720:rate=25:duration=${DUR}" \
  -vf "drawbox=x=0:y=520:w=1280:h=200:color=black@0.8:t=fill,\
drawtext=fontfile=${FONT}:text='SLIDES 25fps':x=40:y=540:fontsize=44:fontcolor=white,\
drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=40:y=600:fontsize=88:fontcolor=0x00ccff,\
drawtext=fontfile=${FONT}:text='f%{n}':x=980:y=600:fontsize=88:fontcolor=0x00ccff" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -g 50 -an \
  -movflags +faststart \
  slides.mp4

echo
ls -lh presenter.mp4 slides.mp4
echo "Listo."
