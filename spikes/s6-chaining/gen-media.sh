#!/usr/bin/env bash
# Genera los medios de prueba del spike S6.
#
# Tres piezas con **fondo de color plano y saturado**, distinto en cada una.
# No es decoración: es el instrumento. Si entre una y otra el navegador deja
# un hueco, se ve como un destello negro sobre un fondo que nunca es negro.
# Un vídeo con imagen real escondería exactamente lo que hay que medir.
#
# Framerates distintos (25 / 30 / 25) a propósito, como en S1: en producción
# la cabecera institucional y la grabación de clase rara vez coinciden, y un
# cambio de framerate es de lo que más cuesta empalmar.
#
# La cabecera lleva **cuenta atrás**: quien mira la pantalla sabe cuándo va a
# ocurrir la costura y puede fijarse justo ahí.
set -euo pipefail

mkdir -p "$(dirname "$0")/media"
cd "$(dirname "$0")/media"

# Duraciones cortas: lo que se mide son las costuras, no el contenido. Una
# cabecera de 8 s es además la duración realista de un bumper institucional.
DUR_INTRO=${DUR_INTRO:-8}
DUR_MAIN=${DUR_MAIN:-30}
DUR_OUTRO=${DUR_OUTRO:-6}

SIZE=${SIZE:-1280x720}
CRF=${CRF:-23}
FONT=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}

# `drawtext` necesita que ffmpeg se haya compilado con libfreetype, y el de
# Homebrew en macOS **no lo trae**. En vez de fallar, se degrada: el texto es
# ayuda, pero el instrumento de verdad es el color plano, y ese no depende de
# ningún filtro opcional.
if ffmpeg -hide_banner -filters 2>/dev/null | grep -q drawtext; then
  HAY_TEXTO=1
else
  HAY_TEXTO=0
  echo "AVISO: este ffmpeg no trae el filtro drawtext (le falta libfreetype)."
  echo "       Los vídeos saldrán sin timecode ni cuenta atrás. El color plano"
  echo "       y el cuadro en movimiento siguen bastando para ver las costuras."
  echo "       Para tenerlo en macOS: brew tap homebrew-ffmpeg/ffmpeg"
  echo "                              brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-freetype"
  echo
fi

if [ "$HAY_TEXTO" = "1" ] && [ ! -f "$FONT" ]; then
  for f in \
    /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf \
    /System/Library/Fonts/Supplemental/Arial\ Bold.ttf \
    /Library/Fonts/Arial\ Bold.ttf
  do
    [ -f "$f" ] && FONT="$f" && break
  done
  if [ ! -f "$FONT" ]; then
    echo "AVISO: no se encuentra ninguna fuente; se generará sin texto." >&2
    HAY_TEXTO=0
  fi
fi

# Un cuadro blanco que cruza la pantalla cada 4 segundos.
#
# No es adorno: sobre un fondo de color plano **no se puede saber si el vídeo
# avanza o está congelado**, y distinguir "se quedó parado" de "sigue
# reproduciendo" es justo lo que hay que mirar en una costura. `drawbox` es un
# filtro básico y está en cualquier compilación, al revés que drawtext.
MOVIL="drawbox=x='(iw-iw/8)*mod(t\,4)/4':y='(ih-ih/8)/2':w='iw/8':h='ih/8':color=white:t=fill"

# Los filtros de texto solo se añaden si hay drawtext.
capa() {
  local etiqueta="$1" dur="$2" filtros="${MOVIL}"
  if [ "$HAY_TEXTO" = "1" ]; then
    filtros="${filtros},drawtext=fontfile=${FONT}:text='${etiqueta}':x=(w-tw)/2:y=(h/2-h/8):fontsize=(w/12):fontcolor=white"
    filtros="${filtros},drawtext=fontfile=${FONT}:text='%{eif\:max(0\,${dur}-t)\:d}':x=(w-tw)/2:y=(h/2+h/24):fontsize=(w/8):fontcolor=white"
    filtros="${filtros},drawtext=fontfile=${FONT}:text='%{pts\:hms}':x=(w/40):y=(h-h/8):fontsize=(w/18):fontcolor=white@0.85"
    filtros="${filtros},drawtext=fontfile=${FONT}:text='f%{n}':x=(w-tw-w/40):y=(h-h/8):fontsize=(w/18):fontcolor=white@0.85"
  fi
  echo "${filtros}"
}

# --- cabecera --------------------------------------------------------------
echo "Generando intro.mp4 (magenta, ${DUR_INTRO}s, 25fps, con audio)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=0xB5179E:size=${SIZE}:rate=25:duration=${DUR_INTRO}" \
  -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=${DUR_INTRO}" \
  -filter_complex "[0:v]$(capa 'CABECERA' "${DUR_INTRO}")[v]" \
  -map "[v]" -map 1:a \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf "${CRF}" -g 50 \
  -c:a aac -b:a 128k -movflags +faststart -shortest \
  intro.mp4

# --- contenido principal ---------------------------------------------------
echo "Generando main.mp4 (verde, ${DUR_MAIN}s, 30fps, con audio)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=0x1B7F3B:size=${SIZE}:rate=30:duration=${DUR_MAIN}" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=${DUR_MAIN}" \
  -filter_complex "[0:v]$(capa 'PRINCIPAL' "${DUR_MAIN}")[v]" \
  -map "[v]" -map 1:a \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf "${CRF}" -g 60 \
  -c:a aac -b:a 128k -movflags +faststart -shortest \
  main.mp4

# --- cola ------------------------------------------------------------------
echo "Generando outro.mp4 (naranja, ${DUR_OUTRO}s, 25fps, con audio)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "color=c=0xE07A1F:size=${SIZE}:rate=25:duration=${DUR_OUTRO}" \
  -f lavfi -i "sine=frequency=330:sample_rate=48000:duration=${DUR_OUTRO}" \
  -filter_complex "[0:v]$(capa 'COLA' "${DUR_OUTRO}")[v]" \
  -map "[v]" -map 1:a \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf "${CRF}" -g 50 \
  -c:a aac -b:a 128k -movflags +faststart -shortest \
  outro.mp4

echo
ls -lh intro.mp4 main.mp4 outro.mp4
echo "Listo."
