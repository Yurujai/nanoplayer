# Spike S5 — Live dual-stream

**Question:** can the player keep two independent live HLS streams in sync?

**Answer: yes, but only with `EXT-X-PROGRAM-DATE-TIME`.** Without that tag it
is not that correction gets worse: **there is no way to measure** whether they
are in sync, and acting on the wrong measurement makes things worse.

> Throwaway code. What survives are the conclusions in §4.

---

## 1. How to run it

```bash
./stream.sh                 # two live broadcasts, started together
./stream-offset.sh          # the second stream starts 8 s later
PDT=0 ./stream.sh           # without the time tag, for comparison
node serve.mjs 8170         # serves the playlists WITHOUT caching (essential for live)
node measure.mjs 30         # automatic measurement
```

Manual bench at `http://127.0.0.1:8170/`.

Both broadcasts come from the same process and carry **the wall clock burned
in**: two frames showing the same time are the same instant, so drift can be
checked by eye as well as measured. Different frame rates (30 and 25) on
purpose, as in S1.

**The setup aligns the sources by construction.** On purpose: the question is
not whether the broadcast server aligns them well —that is its job— but whether
the browser manages not to pull them apart.

---

## 2. Results

### Steady state

| | With PDT |
|---|---|
| Real drift (median) | **20–31 ms** |
| Delay behind live | 6.1–6.7 s |
| Stability over 30 s | no noticeable variation |

With aligned sources, two hls.js instances stay within one frame.

### After a 3 s cut in one stream

```
+ 1 s after the cut   real drift = -2 982 ms
+ 5 s                 real drift = -2 981 ms
+12 s                 real drift = -2 981 ms
```

**It never recovers.** The stream that was cut stays three seconds behind for
good.

### The measurement without PDT is useless

Loading both streams **20 s apart** —what happens when the resource budget
evicts one and attaches it again:

```
REAL drift         =     -28 ms     ← they are in sync
by currentTime     = -20 053 ms     ← says they are 20 s apart
```

---

## 3. Why `currentTime` does not work

In a live stream `currentTime` is the position within the playlist window, and
its origin is set by **the moment that player started loading**. Two instances
that start together have similar origins and the measurement seems to work; as
soon as one loads later, the measurement is wrong by the whole difference.

And it is not a contrived case: it happens every time a stream is evicted and
attached again, which is exactly what the `PlayerRegistry`'s resource budget
does.

A synchroniser trusting that measurement would hard-seek to "correct" 20
seconds that do not exist, **wrecking a correct playback**.

---

## 4. Conclusions for the implementation

1. **`EXT-X-PROGRAM-DATE-TIME` is a requirement, not an improvement.** For live
   dual-stream it must be required in both playlists. In Wowza it is the
   `cupertinoEnableProgramDateTime` property, which **is off by default**.

2. **The synchroniser needs a live mode** that compares `playingDate` instead
   of `currentTime`. The rest of the model —master/slave, hysteresis,
   proportional control— works the same; what changes is where the
   measurement comes from.

3. **Without the tag, the only honest behaviour is not to correct.** Put both
   at the live edge and warn that they may drift apart. Faking a
   synchronisation that cannot be measured is worse than not offering it.

4. **Correction is needed after every cut.** hls.js does not recover on its
   own, and the offset a 3-second stall leaves is 3 seconds, for good. Here a
   hard seek by absolute time beats smooth correction: absorbing 3 seconds at
   25 % extra speed would take twelve.

5. **Detecting whether a stream has started** is separate and simpler: the
   playlist returns 404, or exists with no segments. "Not started yet" must be
   told apart from "interrupted", because someone who has been watching for
   twenty minutes should not read that it has not started.

---

## 5. What this spike does NOT answer

- **Real Wowza.** Here the sources come from the same process with the same
  clock. With two real encoders, the timestamp reflects *when the stream
  reached* the packager, not when it was captured: different upload latencies
  shift the timestamps. It has to be measured with real broadcasts.
- **Safari and iOS.** Everything measured on Chrome. S2 already showed that the
  sync calibration does not carry over between engines.
- **Unstable network.** Everything on localhost, with no packet loss or
  varying bandwidth, which is where stalls become frequent.
- **Low latency.** LL-HLS has not been tested, where windows and segment
  durations change quite a lot.
