#!/usr/bin/env bash
# Generates the test media for spike S1.
#
# Two videos with a burned-in timecode, so drift is visible to the naked eye as
# well as measurable. Different frame rates (30 / 25) on purpose: in real
# dual-stream the two sources rarely match, and that is where drift shows up.
#
# A 2-second GOP, which is realistic in production. It matters because it
# limits seek precision: `currentTime = X` lands on the previous keyframe, and
# that must be told apart from a failure of the sync algorithm.
#
# All text is sized relative to the frame, and the frame counter is
# right-aligned with `tw` (text width). With fixed sizes, the timecode and the
# counter overlapped once the resolution was lowered for publishing.
set -euo pipefail

# media/ is in .gitignore, so a clean clone does not have it.
mkdir -p "$(dirname "$0")/media"
cd "$(dirname "$0")/media"

DUR=${DUR:-90}
# Tunable to publish a lighter version without touching the local working one.
SIZE=${SIZE:-1280x720}
CRF=${CRF:-23}
FONT=${FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}

if [ ! -f "$FONT" ]; then
  echo "Font not found: $FONT" >&2
  echo "Install fonts-dejavu-core, or pass the path with FONT=/path/to.ttf" >&2
  exit 1
fi

BOX="drawbox=x=0:y=(ih-ih/4):w=iw:h=(ih/4):color=black@0.8:t=fill"
label()  { echo "drawtext=fontfile=${FONT}:text='$1':x=(w/40):y=(h-h/4+h/40):fontsize=(w/30):fontcolor=white"; }
tc()     { echo "drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=(w/40):y=(h-h/6):fontsize=(w/14):fontcolor=$1"; }
frames() { echo "drawtext=fontfile=${FONT}:text='f%{n}':x=(w-tw-w/40):y=(h-h/6):fontsize=(w/14):fontcolor=$1"; }

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

echo
ls -lh presenter.mp4 slides.mp4
echo "Done."
