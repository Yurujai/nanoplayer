# Spike S2 — Device matrix

**Questions it answers**, which cannot be answered from a single machine:

1. How many simultaneous videos does the device hold? → sets the budget of the
   `PlayerRegistry` (it also settles **S4**)
2. Does `requestFullscreen` on the container work, or does the system hijack
   the screen and kill the second stream? → **the decisive question for iPhone**
3. Is there `MediaSource` / `ManagedMediaSource`? → without either, hls.js does
   not work
4. Does S1's synchronisation hold outside desktop Chrome?
5. Does it let two videos play sound at once? What is its autoplay policy?

**Status:** ✅ **complete.** Measured on Blink (Ubuntu, Mac M2 Pro), desktop
Safari and two iPhones (Safari 26 and Chrome iOS).

---

## How to use it

```bash
./gen-media.sh      # requires ffmpeg
pnpm install
node build.mjs      # -> dist/nanoplayer-probe.html  (self-contained, ~558 KB)
node verify.mjs     # checks the probe against local Chrome before handing it out
```

`dist/nanoplayer-probe.html` is **a single file with no external resources**. It
can be put on any static hosting, or opened locally. The videos are embedded
in base64 and turned into `blob:` URLs at run time, because Safari on iOS
handles `data:` URIs badly in media elements.

### What testers are asked to do

1. Open the link on the device.
2. Press **Start tests** and wait (under a minute).
3. Press **Test full screen**. It is the most important one: check whether
   **both** videos are visible or only one.
4. Press **Copy report** and send it back.

It is all technical browser data. It collects nothing personal and nothing
leaves the page: there is not a single network request.

---

## Results

| | Chrome · Ubuntu | Chrome · Mac M2 Pro | Safari 16.4 · Mac | **iPhone** (Safari 26 and Chrome iOS) |
|---|---|---|---|---|
| Engine | Blink | Blink | WebKit | WebKit |
| Simultaneous videos | 18 | 18 | 17 | **17** |
| Container fullscreen | yes | yes | yes | **NO** |
| Two audio tracks at once | yes | yes | yes | **no** |
| Drift median / p95 / max | 7.8 / 15.1 / 39 ms | 8.3 / 19.6 / 41 ms | 30.6 / 53.9 / 118 ms | **28.1 / 209 / 405 ms** |
| Hard seeks | 0 | 0 | 0 | **1** |
| `audioTracks` | **no** | **no** | yes | yes |
| MediaSource | yes | yes | yes | no |
| ManagedMediaSource | no | no | no (Safari 16) | **yes** |
| AV1 | probably | probably | no | no |

### The four findings that change the design

**1. iPhone has no container fullscreen.** `requestFullscreen` on a `<div>` is
not implemented: all that is left is `webkitEnterFullscreen()` on the video
alone, which hands the screen to the system player and makes the second stream
disappear. **Dual-stream in full screen is impossible on iPhone.**

On desktop Safari it works. **The limitation is iOS's, not WebKit's** — which is
exactly what the Mac was in the matrix to tell apart.

**2. The simultaneous-video limit belongs to the engine, not the hardware.** 18
on Blink, 17 on WebKit — and a 4-core iPhone gives the same 17 as a Mac.

> **Correction.** An earlier version of this document claimed the iPhone held
> only 2. It was a defect in the probe: the previous tests did not release the
> decoders and the ramp started without resources. Fixed with `release()`, and
> confirmed with two browsers on the same iPhone. Take it as a warning: **a
> surprising number is more likely a fault in the instrument than a finding.**

Caveat: the metric is "how many elements keep advancing their `currentTime`".
It does not prove they render smoothly, and the test videos are 320x180. The
`PlayerRegistry` budget still has to be measured at run time, but starting
from the fact that the order of magnitude is generous, not 2.

**3. S1's tuning is Chrome's, not universal** — and it fails differently in
each place.

On desktop Safari the degradation is uniform: a 30.6 ms median against 7.8.
That is calibration.

On iPhone the signature is different and more interesting: **a 28.1 ms median
(good, below a frame) with a 209 ms p95 and a 405 ms maximum**. It is not a gain
mismatch — if the constants were wrong, the median would be wrong too. They are
**occasional severe excursions** on top of correct baseline behaviour.

Two plausible causes, not yet told apart:
- Momentary buffering from decoding contention on the device.
- Mobile WebKit does not apply `playbackRate` changes with the precision the
  controller assumes.

Consequence for Phase 3: the fix is **not raising the gain** but lowering the
hard-seek threshold in the WebKit profile, so that a 200 ms excursion gets
corrected instead of staying. Telling both causes apart requires instrumenting
stall events during playback, and is better done with the real player than
with the probe.

**4. `audioTracks` is the opposite of what was expected:** it exists on WebKit
and not on Blink. The `AudioTrackProvider` needs both paths from the start
—native on Safari, hls.js on Chrome—, and it is the legitimate exception to the
rule of "a single implementation until there is a real consumer": here there
are already two.

And a piece of good news: iOS 26.5 ships `ManagedMediaSource`, so hls.js is
viable on iPhone despite there being no classic `MediaSource`.

### What falls outside this spike

- **Telling apart the cause of the iPhone excursions** (stalls vs.
  `playbackRate` not honoured). It needs stall events instrumented during
  playback; better done with the real player in Phase 3.
- **HLS.** The probe uses progressive MP4 to stay self-contained. With MSE and
  hls.js buffering is another world and the measurement must be repeated.
- **Real network.** Everything is in-memory blobs: no latency or limited
  bandwidth.
- **Sustained battery and CPU** use.

---

## How the results will be read

| Finding | Consequence for the product |
|---|---|
| `maxConcurrentVideos` < 4 | Suspect the probe first: 17-18 measured on every engine. If confirmed, degrading is mandatory |
| `containerFullscreen: false` | On that device there is no dual-stream in full screen. A decision is needed: switch to one stream, or disable the button |
| `mediaSource` and `managedMediaSource` both `false` | hls.js does not work: native HLS only, with no quality control of our own |
| `hlsMime` is `"maybe"` | **It proves nothing.** Chrome returns it without supporting native HLS. Only `"probably"` together with no MSE indicates real native HLS |
| `audioTracks: false` | Multi-audio cannot go through the native API in that browser |
| `coldAutoplay.muted: false` | Not even muted can it autostart: the poster and play button are mandatory, not an optimisation |
| `dualAudio: false` | Confirms audio must come from a single stream, as the master/slave design already assumes |
| `driftP95Ms` > 33 | S1's synchronisation does not hold there; thresholds must be reviewed per platform |
| very low `loopFps` | The control loop is CPU-bound; it has to be spaced out |

---

## Devices of interest

Priority by how much each can change the design:

1. **A recent iPhone** — the container fullscreen question
2. **An old iPhone or iPad** — the floor for simultaneous decoding
3. **iPad** — expected to support container fullscreen; confirm that iPad and
   iPhone diverge
4. **Safari on Mac** — separates "it is Safari" from "it is iOS"
5. **Low-end Android** — the other decoding floor

An old iPad mini **is not a bad test device, it is one of the good ones**:
hardware limits only show up on modest machines. What has to be decided is
whether it falls below the declared support floor — but that is decided *with*
the data, not before having it.

---

## Limitations of the probe

- **It does not test HLS.** It would need an external stream, which would break
  self-containment. Synchronisation over HLS/MSE has to be measured separately,
  with our own hosting.
- **It does not test a real network.** Everything is local; no latency or
  limited bandwidth.
- The decoding test stops at 24 videos. If a device reaches that, the report
  flags it with `decodeCappedAtLimit`, and the real number is higher.
- Sustained battery and CPU use is not measured.
