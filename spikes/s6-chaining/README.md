# Spike S6 — Intro and outro chaining

**Question:** can the player go from the intro to the content —and from the
content to the outro— without the cut being visible, and does the second
`play()` survive the autoplay policy?

**Answer: yes, but only with anticipation.** Starting the next piece when the
previous one ends leaves a gap of **340–445 ms** — ten frames, perfectly
visible. Starting it a few hundred milliseconds earlier brings it down to
**0 ms** in both desktop engines.

**On iPhone too, and without unlocking** (measured on 2026-09-28 on an iPhone 17
Pro with Safari 26.5): with 600 ms of anticipation the gap is **0 ms** at both
seams, whether unlocking in the gesture or not, and unmuting the incoming piece
does not pause it. It is a single device with a single Safari: the per-element
policy is historical on iOS and still has to be confirmed on an earlier iOS.

> Throwaway code. What survives are the conclusions in §5.

---

## 1. Why it has to be measured before writing the player

There are two questions, and the answer to one gets in the way of the other:

**For the cut not to be visible**, the next piece must already be decoding
when the current one ends. That forces **two distinct `<video>` elements**: one
visible and another waiting behind it.

**But a `<video>` element that has never played is locked.** When the intro
ends and `play()` has to be called on the second one, that call does not come
from a user gesture: it comes from an `ended`. On iOS the playback permission
belongs **to each element**, not to the page, so that second element can
reject the `play()` with `NotAllowedError` and leave the intro finished and the
content stopped.

The known way out is **unlocking the second element inside the same gesture
that started the intro**: a `play()` followed by an immediate `pause()`, in the
click handler itself. It works in theory and it is what players with
advertising do. This spike exists to check whether it really works, and at
what cost.

The alternative —**a single element whose `src` is swapped**— has no
permission problem, because the element was unlocked by the initial gesture.
In exchange it forces a `load()` and a buffer refill, and that shows. How much
it shows is precisely what has to be quantified before ruling it out.

---

## 2. The three variants

| | Elements | Unlock in the gesture | Anticipation |
|---|---|---|---|
| **A** | One per piece | Yes | Configurable |
| **B** | One per piece | **No** | Configurable |
| **C** | A single one, swapping `src` | Not needed | **Impossible** |

**A is the proposal.** B is its control: the same mechanics without the
unlock, to be able to say whether the unlock contributes anything or is
superstition. C is the simple alternative, to know what is lost by choosing
it.

That C does not support anticipation is not a limitation of the bench: **the
next piece cannot be loaded without destroying the one playing**, because
there is only one element. That impossibility is already a result.

### Anticipation

Starting the incoming piece a few milliseconds **before** the outgoing one
ends, so it has a frame ready at the moment of the switch. During that overlap
the incoming piece is **muted** —otherwise both would be heard— and it is
unmuted when revealed.

That introduces a third question the bench also measures: unmuting a playing
video is another operation with no gesture behind it, and some browsers
respond by **pausing it**. The report's `pausedAfterUnmute` field is that.

---

## 3. How to run it

```bash
./gen-media.sh                 # requires ffmpeg
pnpm install
node serve.mjs 8180            # also prints the local network IP
```

> **ffmpeg without `drawtext`.** Homebrew's on macOS is built without
> libfreetype and lacks that filter. The script detects it and generates the
> videos **without text**, with a warning: the real instrument is the flat
> colour, and the white box crossing the screen is enough to see whether the
> video advances or is frozen. To get the text, install
> `homebrew-ffmpeg/ffmpeg/ffmpeg --with-freetype`.

Manual bench at `http://127.0.0.1:8180/`, and from the phone at the LAN
address the server prints.

```bash
node measure.mjs               # system Chrome, or Playwright's Chromium
ENGINE=webkit node measure.mjs # Safari's engine
HEADED=1 node measure.mjs      # with a window
DUR_MAIN=12 ./gen-media.sh     # short main piece, so as not to wait on every pass
```

The harness prefers Google Chrome if installed and otherwise falls back to
Playwright's Chromium. S1 and S5 require the system one because the bundled
one did not ship H.264 codecs; **that is no longer true** in current versions,
and it is checked before measuring: if the browser does not decode the pieces,
it aborts instead of returning zeros that would look like a result.

### What the phone tester is asked to do

1. Open it **in Safari** if it is an iPhone. Chrome and Firefox on iOS are
   WebKit underneath, but their layer changes the autoplay behaviour.
2. Turn off **Low Power Mode**: it alters playback and contaminates the
   measurement.
3. Try the three variants, letting both seams finish in each one.
4. Also try the **Skip intro** button.
5. Press **Copy report** and send it back.

Watching the screen matters as much as the number: **if black shows between
two pieces, there was a gap**. The three pieces are in flat, saturated colours,
and the stage background is the only black thing on the page.

---

## 4. What is measured

**The gap**, in milliseconds, between the last **presented** frame of the
outgoing piece and the first of the incoming one. The source is
`requestVideoFrameCallback`, which is the only API that says when a frame
reached the screen: with `timeupdate`, which arrives at about 4 Hz, a 200 ms
gap is indistinguishable from a 20 ms one.

Where that API does not exist it is estimated with `requestAnimationFrame` and
**the report warns about it**. Those numbers are not comparable with those of a
browser that has it.

Also, for each seam:

| Field | |
|---|---|
| `blocked` | The `play()` was rejected with `NotAllowedError` |
| `withSound` | Whether the request went with sound. **If it is `false`, that row proves nothing about the policy**: a muted `play()` is always granted |
| `pausedAfterUnmute` | When unmuted, the browser paused it |
| `incomingReadyState` | How much the incoming piece had loaded when its play was requested. Below 2 means the gap is a buffer gap, not a policy one |

> The report field names were translated to English after the measurements
> below were taken: the raw reports from those runs use the earlier Spanish
> names (`huecoMs`, `latenciaMs`, `bloqueado`, `conSonido`,
> `pausadaTrasSonido`, `anticipada`, `readyStateEntrante`, `costuras`,
> `desbloqueos`…). The data is the same; only the keys changed.

That `withSound` is published on purpose: the easiest trap when building this
is muting the incoming piece so it always starts, and ending up concluding
there is no autoplay problem when what is really happening is that it was
never tested.

**Nothing is downloaded until play is pressed.** The elements are created
inside the click handler itself, which is what the player's principle 2
demands and is also the hard part: an element has to be unlocked while it does
not yet have a single byte.

### When reading the output of `measure.mjs`

**Desktop Chrome grants activation per page, not per element.** A click
anywhere unlocks every `<video>` on the page, so variant B is expected to pass.
**That says nothing about iOS**, where the permission belongs to each element.
The harness does not pass `--autoplay-policy=no-user-gesture-required` —unlike
those of S1 and S5— precisely so as not to skew this any more than the
platform already does.

---

## 5. Results

Measured on 2026-09-19, macOS arm64, Playwright's Chromium 141 and WebKit
26.5, 8 / 12 / 6 s pieces served from localhost. Gaps in milliseconds.

### Without anticipation, the gap is always visible

| Variant | Engine | intro→main | main→outro |
|---|---|---:|---:|
| A (two elements, unlocked) | Chromium | 340 | 91 |
| A | WebKit | 444 | 444 |
| B (not unlocked) | Chromium | 375 | 90 |
| B | WebKit | 445 | 445 |
| C (one element, swapping `src`) | Chromium | 187 | 180 |
| C | WebKit | 236 | 235 |

One frame at 30 fps is 33 ms. All of that is visible.

And there is a surprise: **C does better than A**. Reloading the whole element
is faster than waking one that had spent eight seconds paused with
`opacity: 0`. The cause is in the latency column: the `play()` of a stopped
element takes about **250 ms in Chromium and 375–430 ms in WebKit** to give
the first frame, while C's `load()` + `play()` takes 65–180 ms. Having the
element ready does not mean it starts instantly.

### With anticipation, the gap disappears

| Anticipation | Engine | intro→main | main→outro |
|---|---|---:|---:|
| 300 ms | Chromium | 21 | 0 |
| 300 ms | WebKit | **0** | **0** |
| 600 ms | Chromium | **0** | **0** |
| 600 ms | WebKit | **0** | **0** |

**The anticipation has to exceed the `play()` latency**, and that latency
depends on the engine. With 300 ms Chromium still leaves 21 ms because its
`play()` takes ~250 and the watch loop samples every 50. With 600 ms there is
plenty of margin in both.

### The skip is free

Skipping the intro halfway gives **0–28 ms**, and for a reason worth
understanding: when skipping, the outgoing piece **keeps playing** until the
incoming one has a frame. There is no gap because nothing stops being shown.
It is the same mechanism as the anticipation, triggered by hand.

### What could NOT be measured

`blocked` came out **no** in every row, including variant B. **That does not
mean the unlock is unnecessary.** On desktop, both Chromium and WebKit grant
activation per page: the click on "Play" unlocks every `<video>` in the
document, so B never gets put to the test. On iOS the permission belongs to
each element and that is where B should fail.

`pausedAfterUnmute` came out **no** in every row: unmuting the incoming piece
mid-playback did not pause it in either engine. A good sign for the
anticipation, pending confirmation on iOS.

### iPhone

Measured on 2026-09-28 by hand, on an iPhone 17 Pro with Safari 26.5 (the UA
says "iPhone OS 18_7" because Safari has frozen that number since version 26).

| Variant | Anticipation | intro→main | main→outro | blocked | paused when unmuted |
|---|---:|---:|---:|---|---|
| A · unlocked | 0 | 434 | 384 | no | — |
| B · not unlocked | 0 | 433 | 384 | no | — |
| C · one element | 0 | 269 | 234 | no | — |
| A · unlocked | 600 | **0** | **0** | no | no |
| B · not unlocked | 600 | **0** | **0** | no | no |

**B passes, and that is what decides it.** Without anticipation, the incoming
piece's `play()` with sound comes from an `ended` some 8 s after the tap, with
no prior unlock, and it is not rejected. With anticipation, unmuting it without
a gesture does not pause it either. In this Safari the permission behaves as
per page, just as on desktop. The `play()` latency ranges from 324 to 392 ms:
600 ms covers it.

**The skip with sound does leave a gap: 321 ms.** The bench's skip starts the
incoming piece **with sound**, and the gap is almost equal to its latency
(361 ms): the outgoing piece stops painting as soon as that `play()` is
requested. It fits what S2 measured —iPhone does not play two audio tracks at
once—, and it does not happen at the anticipated seams, where the incoming
piece starts muted. On desktop the same skip gave 0–28 ms.

**Starting it muted, the skip drops to 0 ms.** The bench was changed to skip
the way the player does —incoming piece muted, sound on reveal— and measured
again on the same iPhone, variant A with 600 ms:

| Skip | Gap | Latency | With sound | Paused when unmuted |
|---|---:|---:|---|---|
| Incoming with sound | 321 | 361 | yes | — |
| Incoming muted | **0** | 364 | no | no |

The latency does not change: what changes is that the intro keeps painting
until the content has a picture.

---

## 6. Conclusions for the implementation

1. **Anticipation is not an optimisation, it is the mechanism.** Without it
   there is no way to chain without a visible gap, in any engine and with any
   of the three variants. The player has to start the next piece before the
   current one ends.

2. **A 600 ms margin, measured, not assumed.** It has to exceed the `play()`
   latency, which ranges from 250 ms (Chromium) to 430 ms (WebKit) for a
   stopped element. 300 ms is enough on WebKit and falls short on Chromium.

3. **During the overlap, the incoming piece is muted and unmuted when
   revealed.** Neither engine paused it when doing so.

4. **Having the element attached is not enough.** `readyState` 4 and a
   `play()` that takes a quarter of a second coexist without trouble. Any
   design that assumes "it is already loaded, so it starts right away" is
   wrong.

5. **The skip button reuses exactly the same path:** start the incoming piece
   **muted**, wait for its first frame, switch. The muting is not a detail: on
   iPhone, starting it with sound stops the outgoing piece and leaves a 321 ms
   gap; muted, 0 ms (§5). The player already does it this way.

6. **The unlock was not needed on iOS 26** (variant B, §5). It is kept for now:
   it is a single device, and an earlier iOS could still apply the per-element
   policy. If B also passes on iOS 17 or 18, it is removed, and with it the
   need to attach the outro from the start of playback.

## 7. What this spike does NOT answer

- **HLS.** Everything is progressive MP4. With HLS the start goes through
  parsing the playlist and fetching the first segment, so the gaps will be
  different — and the hls.js engine has its own attach cycle.
- **Dual-stream.** The intro is single-stream, which is realistic, but the
  main content can be dual, and there the switch has to be coordinated with
  the synchroniser.
- **Live.** An intro in front of a live stream changes the problem: while the
  intro plays, the broadcast's edge moves away.
- **Full screen.** Chaining has not been tested with the player in full
  screen, where switching the visible element could behave differently. On
  iPhone, moreover, container fullscreen does not exist (S2).
- **Android.** Neither Chrome nor Samsung Internet. Android's autoplay policy
  has its own rules.
