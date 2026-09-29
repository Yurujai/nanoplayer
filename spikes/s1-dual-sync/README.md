# Spike S1 — Dual-stream synchronisation

**Question:** can two video streams be kept in sync within one frame using only
the native `<video>` element, with no external library?

**Answer: yes.** Median drift of ~10 ms and p95 of ~14 ms in steady state (one
frame at 30 fps is 33 ms), with recovery in every scenario tested.

> Throwaway code. What goes to production are the conclusions in §4, not these
> files.

---

## 1. How to run it

```bash
./gen-media.sh          # generates the test videos (requires ffmpeg)
pnpm install
node serve.mjs 8099     # static server WITH Range support
```

- **Manual:** open `http://127.0.0.1:8099/` — live drift chart and buttons to
  trigger each disturbance.
- **Automatic:** `node measure.mjs` (or `HEADED=1 node measure.mjs`).

Parameter sweep without touching code:

```bash
URL="http://127.0.0.1:8099/index.html?gain=1.2&maxRateDelta=0.25" node measure.mjs
```

### Test media

Two 90 s videos with a **burned-in timecode**, so drift is visible to the naked
eye as well as measurable. **Deliberately different** frame rates (30 and
25 fps): in real dual-stream the sources rarely match. A 2 s GOP, which is
realistic in production and limits seek precision.

---

## 2. Results

Chrome 1xx, headless, Linux. `requestVideoFrameCallback` available.

| Scenario | Median drift | p95 | Recovery | Hard seeks |
|---|---|---|---|---|
| Steady 1× (25 s) | 9.8 ms | 14.3 ms | — | 0 |
| Steady 2× (15 s) | 12.9 ms | 22.4 ms | — | 0 |
| Offset +250 ms | — | peak 260 ms | 1905 ms | 0 |
| Offset +2 s | — | peak 2003 ms | 67 ms | 1 |
| Master seek | — | peak 81 ms | 900 ms | 0 |
| Slave stall 1.5 s | — | peak 7 ms | 3 ms | 0 |

Everything below one frame in steady state, even at 2×.

---

## 3. The design that worked

**Master/slave.** The master is the stream with audio, and **its
`playbackRate` is never touched**: changing the speed of audio is audible. All
the correction falls on the slave, which is muted.

**Two regimes:**
- Small drift → proportional control over the slave's `playbackRate`.
  Invisible to the user.
- Drift > 500 ms → hard seek (assign `currentTime`). Noticeable, but it
  recovers in ~67 ms.

**Hysteresis is mandatory.** Engages at 33 ms, releases at 8 ms.

**Stall policy:** pause both. If the slave runs out of buffer and the master is
left running, drift grows beyond the hard-seek threshold and the user sees a
jump instead of a short pause. Pausing both, the measured drift peak was 7 ms.

---

## 4. Conclusions for the real implementation

1. **It is feasible with native `<video>`.** No synchronisation library needed.

2. **Hysteresis is not optional.** Without it the controller has steady-state
   error: it stops on entering the dead zone and leaves a permanent offset.
   Measured on the first pass: **a fixed 28.8 ms median**. With hysteresis
   (engage 33 ms / release 8 ms): **9.8 ms**.

3. **Gain governs recovery, not the speed ceiling.** Raising `maxRateDelta`
   from 0.12 to 0.25 changed nothing (3.4 s → 3.7 s, noise). Raising the gain
   from 0.6 to 1.2 halved it (**1.7 s**) at the cost of 3 ms more steady drift.
   The ceiling can be generous: the slave carries no audio, which is the only
   real reason to limit it.

4. **Starting values:** `deadZone 33 ms`, `releaseZone 8 ms`, `gain 1.2`,
   `maxRateDelta 0.25`, `hardSeek 500 ms`.

5. **Use `requestVideoFrameCallback`** for the control loop where it exists: it
   fires on the actual presentation of the frame, not on repaint. Fall back to
   `requestAnimationFrame`.

6. **Pause both when either one stalls.** Visual coherence over audio
   continuity.

---

## 5. Trap found in the test bench

`python -m http.server` **ignores the Range header**. Every seek forces the
browser to download the whole video again from the start. Because of that, the
first measurement showed 300+ hard seeks and 36-second drifts — all an artefact
of the server, nothing to do with the algorithm.

That is why this spike includes `serve.mjs`, with real Range support.

**A lesson beyond the spike:** any synchronisation measurement is inseparable
from network conditions. Before blaming the algorithm, check that the transport
answers `206 Partial Content`. The same applies when debugging in production.

---

## 6. What this spike does NOT answer

- **Safari / iOS.** That is the subject of spike **S2**. What was measured here
  is Chrome on Linux; nothing guarantees the same behaviour where
  `requestVideoFrameCallback` may not exist and fullscreen works differently.
- **HLS.** These are progressive MP4s. With MSE and hls.js, buffering is another
  world: the measurement has to be repeated.
- **Real network.** Everything on localhost. Measuring with limited latency and
  bandwidth is still pending.
- **CPU/battery cost** of the control loop on modest devices.
