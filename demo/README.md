# Demo

The project's public website. Six pages served by the same Vite, published at
the root of GitHub Pages:

| | |
|---|---|
| [`index.html`](index.html) | **Landing page.** What the player is, why it exists and what it solves, and links to the rest |
| [`video/`](video/index.html) | **Video demo.** The full player with MP4, single or dual, with or without intro and outro |
| [`live/`](live/index.html) | **Live demo.** Dual live on a public test channel |
| [`bench/`](bench/index.html) | **Test bench** for the core, with the raw lifecycle |
| [`manifest/`](manifest/index.html) | **Manifest reference.** Every field, and a complete example that plays |
| [`analytics/`](analytics/index.html) | **Analytics and xAPI.** How viewing data is sent and what, with a live log |

The manifest reference shows [`public/manifest/example.json`](public/manifest/example.json)
and [`live.json`](public/manifest/live.json) as served. A test in the core
fails when a field is added to the types and not to them, so the page cannot
fall behind.

```bash
./gen-media.sh     # needs ffmpeg; generates the videos with a burned-in timecode
pnpm install
pnpm --filter @nanoplayer/demo dev    # http://localhost:5180
```

The site points at the packages' **source**, not their build: changes show up
at once while developing. Shared styles live in [`src/site.css`](src/site.css).

The old addresses (`/demo/` and `/demo/banco.html`) are redirected by the Pages
workflow, so links already shared keep working.

---

## Video demo (`video/`)

It is literally what an integrator would write: `create()` and
`attachControls()`. The only demo-specific part is switching manifests without
reloading, done the way anyone would: destroy the player and create another,
keeping the position. Turning the intro on mid-lecture **does not replay it**:
playback carries on where it was.

- **While the poster shows there is no `<video>` in the DOM** and not a byte of
  video has been downloaded.
- **Captions switch on by themselves** because the manifest has `textTracks`.
- **Layouts are in the settings menu**, under *Layout*, and only appear in dual.
- **Intro and outro** are off by default, so a first-time visitor does not
  see an intro before anything else.

This is the page CI audits with `e2e/a11y.mjs`, `e2e/keyboard.mjs` and
`e2e/chaining.mjs`.

## Live demo (`live/`)

GitHub Pages only serves static files, so the live stream comes from outside:
**[ireplay.tv](https://ireplay.tv/)'s public test channel**, on air 24/7 with
about 25 minutes of DVR window, open CORS and `EXT-X-PROGRAM-DATE-TIME`, the
requirement for syncing two live streams (spike [S5](../spikes/s5-live-dual/)).
Its terms ask for a link wherever it is used, and the page has one.

- **Both streams are the same channel:** the main playlist, with audio, plays
  the camera, and a video-only rendition plays the slides. That is why sync is
  visible by eye: both halves show the same frame.
- **It opens live.** The channel declares `EXT-X-START:TIME-OFFSET=36`, which
  asks to start almost 25 minutes behind. The player honours it because it is
  the standard; the demo jumps to the edge once, as soon as it is known.
- **If the channel goes down, so does the demo.** It is a third-party
  dependency, and the page says so. To use another one, change `SOURCES` in
  [`src/live.ts`](src/live.ts).

## Test bench (`bench/`)

It uses the public API exactly as an integrator would — if anything here needed
to bypass it, the API would be wrong. The difference is that the lifecycle steps
are buttons, because that is precisely what is worth showing.

**Seven scenarios**, picked from the drop-down: single stream, dual stream, the
same two over HLS, audio only, audio with slides, trimmed, and an invalid
manifest with two audio tracks.

### What it shows

**The lazy lifecycle, with the numbers in sight.** The network request counter
and the `<video>` element counter change as the state advances:

| State | Requests | `<video>` elements |
|---|---|---|
| `idle` | 0 | 0 |
| `resolved` | 1 | 0 |
| `attached` | 1 | 2 |

**That the synchronizer really corrects.** *Desync by 400 ms* introduces the
offset on purpose; drift and the loop action show live, and the value goes back
under the 33 ms of one frame. Spike S1 measured a 9.8 ms median.

**That detaching the engine keeps the position.** Press *Detach engine*
mid-playback: the `<video>` elements leave the DOM, the decoders are released
and the position is kept. Attaching again carries on where it was. That is what
makes a page with many players viable — S2 measured the browser ceiling at 17
elements (WebKit) and 18 (Blink).

**That the engine is chosen by capability, not by conditionals.** In the HLS
scenario hls.js wins where MediaSource exists and the native engine elsewhere,
with nothing else in the manifest changing. The `engine:attach:ok` event says
which one won.

**That the bus reports everything.** The event log is literally what
`bus.onAny()` sees, which is where analytics will plug in without touching the
core.

**That validation is not decorative.** The manifest with two audio tracks fails
with the reason: *"playing two tracks at once does not work on iOS"*.
Validation messages are in English on purpose: integrators read them in the
console, and they are what ends up pasted into a search engine.
