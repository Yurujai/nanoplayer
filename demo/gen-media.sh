#!/usr/bin/env bash
# Generates the demo's test media.
#
# Two videos with a burned-in timecode, so drift is visible by eye as well as
# measurable. Different frame rates (30 / 25) on purpose: in real dual-stream
# the two sources rarely match, and that is where drift shows up.
#
# 2-second GOP, as in production. It limits seek precision (`currentTime = X`
# lands on the previous keyframe), which must not be mistaken for a sync bug.
#
# Text is sized relative to the frame: with fixed sizes, the timecode and the
# frame counter overlapped at the smaller published resolution.
set -euo pipefail

# media/ is git-ignored, so it does not exist in a fresh clone.
mkdir -p "$(dirname "$0")/public/media"
cd "$(dirname "$0")/public/media"

DUR=${DUR:-60}
# Tunable to publish a lighter version without touching the local one.
SIZE=${SIZE:-1280x720}
CRF=${CRF:-23}
FONT=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}

# drawtext needs ffmpeg built with libfreetype, which Homebrew's is not. Rather
# than fail, fall back to a moving box so you can still see the video advance.
# CI runs on Ubuntu, where drawtext is available.
if ffmpeg -hide_banner -filters 2>/dev/null | grep -q drawtext && [ -f "$FONT" ]; then
  HAS_TEXT=1
else
  HAS_TEXT=0
  echo "WARNING: no drawtext or no font; videos will have no timecode."
  echo "         On macOS: brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-freetype"
  echo
fi

BOX="drawbox=x=0:y=(ih-ih/4):w=iw:h=(ih/4):color=black@0.8:t=fill"
# On a still image there is no telling whether the video advances or is frozen.
MOVING="drawbox=x='(iw-iw/12)*mod(t\\,4)/4':y='ih-ih/5':w='iw/12':h='ih/12':color=white:t=fill"
label()  { [ "$HAS_TEXT" = 1 ] && echo "drawtext=fontfile=${FONT}:text='$1':x=(w/40):y=(h-h/4+h/40):fontsize=(w/30):fontcolor=white" || echo "$MOVING"; }
tc()     { [ "$HAS_TEXT" = 1 ] && echo "drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=(w/40):y=(h-h/6):fontsize=(w/14):fontcolor=$1" || echo "null"; }
frames() { [ "$HAS_TEXT" = 1 ] && echo "drawtext=fontfile=${FONT}:text='f%{n}':x=(w-tw-w/40):y=(h-h/6):fontsize=(w/14):fontcolor=$1" || echo "null"; }

echo "Generating presenter.mp4 (${SIZE}, 30fps, with audio)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc2=size=${SIZE}:rate=30:duration=${DUR}" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=${DUR}" \
  -filter_complex "[0:v]${BOX},$(label 'PRESENTER 30fps'),$(tc 0x88ff00),$(frames 0x88ff00)[v]" \
  -map "[v]" -map 1:a \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf "${CRF}" -g 60 -c:a aac -b:a 128k \
  -movflags +faststart -shortest \
  presenter.mp4

echo "Generating slides.mp4 (${SIZE}, 25fps, no audio)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc=size=${SIZE}:rate=25:duration=${DUR}" \
  -vf "${BOX},$(label 'SLIDES 25fps'),$(tc 0x00ccff),$(frames 0x00ccff)" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf "${CRF}" -g 50 -an \
  -movflags +faststart \
  slides.mp4

# A stand-in for a sign language interpreter: smooth colour that never stops
# moving (cheap to encode), and the same burned-in timecode, so its sync is
# visible by eye too.
echo "Generating interpreter.mp4 (640x360, 25fps, no audio)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "gradients=size=640x360:rate=25:speed=0.02:n=3:duration=${DUR}" \
  -vf "format=yuv420p,${BOX},$(label 'INTERPRETER 25fps'),$(tc 0xffffff)" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf "${CRF}" -g 50 -an \
  -movflags +faststart \
  interpreter.mp4

echo "Generating audio.m4a (audio only)..."
ffmpeg -y -loglevel error \
  -f lavfi -i "sine=frequency=330:sample_rate=44100:duration=${DUR}" \
  -f lavfi -i "sine=frequency=495:sample_rate=44100:duration=${DUR}" \
  -filter_complex "[0:a][1:a]amix=inputs=2:duration=first,volume=0.5[a]" \
  -map "[a]" -c:a aac -b:a 96k audio.m4a

# Intro and outro in a flat, distinct colour each, as in S6: a gap in the
# chaining would show as a black flash.
bumper() {
  local name="$1" color="$2" text="$3" dur="$4" filters="${MOVING}"
  [ "$HAS_TEXT" = 1 ] && filters="${filters},drawtext=fontfile=${FONT}:text='${text}':x=(w-tw)/2:y=(h-th)/2:fontsize=(w/10):fontcolor=white"
  echo "Generating ${name}.mp4 (${dur} s)..."
  ffmpeg -y -loglevel error \
    -f lavfi -i "color=c=${color}:size=${SIZE}:rate=25:duration=${dur}" \
    -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=${dur}" \
    -vf "${filters}" -map 0:v -map 1:a \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf "${CRF}" -g 50 -c:a aac -b:a 96k \
    -movflags +faststart -shortest \
    "${name}.mp4"
}
bumper intro 0x7b2cbf 'INTRO' 5
bumper outro 0xd9480f 'OUTRO' 4

# HLS for the hls.js engine. `-c copy` repackages without re-encoding.
echo "Generating HLS (2 s segments)..."
rm -rf hls && mkdir -p hls
ffmpeg -y -loglevel error -i presenter.mp4 \
  -c copy -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_filename 'hls/presenter%03d.ts' hls/presenter.m3u8
ffmpeg -y -loglevel error -i slides.mp4 \
  -c copy -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_filename 'hls/slides%03d.ts' hls/slides.m3u8

echo "Generating poster.jpg (a presenter frame)..."
ffmpeg -y -loglevel error -ss 3 -i presenter.mp4 -frames:v 1 -vf scale=960:-1 poster.jpg

# Progress bar thumbnails: one 160x90 frame every 5 s, tiled in one sheet, and
# the WebVTT naming each region. Generated together: the duration varies.
STEP=5; COLS=5; TW=160; TH=90
COUNT=$(( (DUR + STEP - 1) / STEP ))
ROWS=$(( (COUNT + COLS - 1) / COLS ))
echo "Generating thumbs.jpg and thumbs.vtt (${COUNT} frames)..."
ffmpeg -y -loglevel error -i presenter.mp4 \
  -vf "fps=1/${STEP},scale=${TW}:${TH},tile=${COLS}x${ROWS}" -frames:v 1 thumbs.jpg
stamp() { printf '%02d:%02d:%02d.000' $(( $1 / 3600 )) $(( $1 % 3600 / 60 )) $(( $1 % 60 )); }
{
  echo "WEBVTT"
  for (( i = 0; i < COUNT; i++ )); do
    start=$(( i * STEP )); end=$(( start + STEP > DUR ? DUR : start + STEP ))
    echo
    echo "$(stamp $start) --> $(stamp $end)"
    echo "thumbs.jpg#xywh=$(( i % COLS * TW )),$(( i / COLS * TH )),${TW},${TH}"
  done
} > thumbs.vtt

echo
ls -lh presenter.mp4 slides.mp4 interpreter.mp4 intro.mp4 outro.mp4 poster.jpg thumbs.jpg audio.m4a
ls hls/*.m3u8 | sed "s/^/  /"
echo "Done."
