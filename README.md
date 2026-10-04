# NanoPlayer

Multi-stream, accessible and extensible web video player.

> **Status: in development.** The player already works —single stream,
> synchronized dual stream, HLS, live, captions and an accessible control bar—
> but **nothing is released**: not on npm, not on a CDN, no tagged version.
> Today the only way to use it is to clone the repository and build it. The API
> may change without notice.

---

## Why

Four requirements, drawn from running lecture video in production, that shape
the whole architecture:

**Accessibility you can verify.** WCAG 2.1 AA and EN 301 549 as an
architectural requirement, checked automatically in CI. Accessibility added at
the end always costs more and always comes out worse.

**No network until the user asks.** A page can hold dozens of players — the
real case that prompted this had 32. Creating one downloads nothing: no
metadata, no manifest, not a byte of video. And an exclusive-playback policy
keeps them from competing.

**Configuration, not forks.** Turning any plugin on or off is runtime
configuration. You never need a custom build to change which features are on.

**Theming without forks.** CSS variables documented as a stable API, to
redesign the look without touching the player's code.

The thesis, in one sentence: **a player that never makes you fork it.**

---

## What works today

| | |
|---|---|
| **Playback** | Single stream, synchronized dual stream, audio only with artwork, and audio with slides |
| **Formats** | MP4 through the native engine; HLS through lazily loaded [hls.js](packages/engine-hls/), downloaded only when needed |
| **Trim** | The `trim` annotation remaps the visible timeline without touching the media: duration, position and seeks are in trimmed time |
| **Intro and outro** | Chained without a visible gap; the intro can be skipped, the outro cannot |
| **Live** | DVR window, jump to the edge, per-stream waiting with retries, and a distinction between "not started yet" and "interrupted" |
| **Sync** | Proportional control with hysteresis and per-engine profiles. Live streams are measured by absolute time (`EXT-X-PROGRAM-DATE-TIME`), not by `currentTime` |
| **Interface** | Accessible control bar, fully keyboard-operable, and a settings menu of stacked panels with YouTube's ergonomics |
| **Layouts** | Side by side, picture in picture, speaker only and slides only |
| **Multi-instance** | Shared registry with exclusive playback and batched manifest resolution — 32 players, one request |
| **Plugins** | Registry with topological order and UI slots. Plugins declare their condition and switch on by themselves from the manifest, each player with its own |
| **Chapters** | Marks on the progress bar, the current chapter on screen and announced to screen readers, and a list in settings to jump to one |
| **Theming** | Documented CSS variables, no Shadow DOM |
| **Installation** | The packages separately from npm, or one `<script>` tag and three lines with the 27 KB gzip bundle. Also UMD for AMD loaders, and the stylesheet as a file for sites with a strict CSP |
| **Errors** | A `code` to decide what the user is told —translatable— and an English `message` as a diagnostic for integrators |
| **Languages** | Spanish and English built in, with an open catalogue: adding another —or changing one word— is configuration, not a fork. Times and percentages are formatted by `Intl`, so they come out right in any language |

The core has **no runtime dependencies**, and hls.js is only downloaded the
first time HLS has to play: whoever plays MP4 does not pay for it.

### Packages

| Package | |
|---|---|
| [`@nanoplayer/core`](packages/core/) | Manifest, lifecycle, engines, sync and plugins. No UI |
| [`@nanoplayer/ui`](packages/ui/) | Accessible control bar, settings menu and layouts |
| [`@nanoplayer/engine-hls`](packages/engine-hls/) | HLS engine on hls.js |
| [`@nanoplayer/plugin-captions`](packages/plugin-captions/) | Captions |
| [`@nanoplayer/plugin-chapters`](packages/plugin-chapters/) | Chapters: marks on the progress bar and a list in settings |
| [`@nanoplayer/plugin-pip`](packages/plugin-pip/) | Picture in picture: the video in the browser's floating window |
| [`@nanoplayer/plugin-audio-tracks`](packages/plugin-audio-tracks/) | Audio tracks: audio description and other languages, from the media |
| [`@nanoplayer/plugin-media-session`](packages/plugin-media-session/) | Lock screen, headphones and media keys, with title, chapter and poster |
| [`@nanoplayer/plugin-quality`](packages/plugin-quality/) | Quality: HLS levels or MP4 sources, or automatic |
| [`@nanoplayer/plugin-resume`](packages/plugin-resume/) | Resume where the viewer left off, locally or through an LMS store |
| [`@nanoplayer/plugin-transcript`](packages/plugin-transcript/) | Interactive transcript below the player: follow along, click to jump |
| [`@nanoplayer/plugin-xapi`](packages/plugin-xapi/) | Progress and completion to the LMS, as xAPI Video Profile statements |
| [`@nanoplayer/bundle`](packages/bundle/) | All of the above in one file, for the `<script>` tag; hls.js comes from its own tag. 39 KB gzip |

## What is missing

In order of what blocks the most people:

- **Publishing.** Nothing is on npm and there is no release workflow. The
  packages are still at `0.0.0`.
- **Planned plugins:** Chromecast, playlists and H5P. The
  manifest's annotations are already the mechanism they will come in through.
- **Demo.** The multi-instance case has nowhere to be seen, and spike S5 is not
  published on Pages. The live demo depends on a third-party public test
  channel.

The detailed scope and schedule will be published when the MVP is further along.

---

## Browser quirks

Much of the code exists to work around measured browser behaviour — iOS not
preloading, WebKit and hls.js seeking, one audio track at a time on iPhone, and
more. Each one is catalogued, with how it was found and which test guards it,
in [`docs/browser-quirks.md`](docs/browser-quirks.md).

---

## Spikes

Before writing architecture, validate what could sink the project. Throwaway
code: what survives are the conclusions.

### [S1 · Dual-stream sync](spikes/s1-dual-sync/) ✅

**Can two videos be kept in sync with nothing but native `<video>`?** Yes.
Median drift of 9.8 ms and p95 of 14.3 ms in Chrome — one frame at 30 fps is
33 ms — recovering in every scenario tried.

Main finding: **hysteresis is mandatory**. Without separating the engage
threshold from the release threshold, the controller leaves a permanent 28.8 ms
offset.

### [S2 · Device matrix](spikes/s2-device-matrix/) ✅

**What can each device take?** Measured on Blink, desktop Safari and two
iPhones. A single self-contained HTML file anyone opens on their phone, which
returns a report.

| Engine | Videos at once | Drift p95 | Container full screen |
|---|---|---|---|
| Blink (Chrome) | 18 | 15 ms | yes |
| WebKit (Safari, Mac) | 17 | 54 ms | yes |
| WebKit (iPhone) | 17 | 209 ms | **no** |

The answer to the decisive question was no: **iPhone has no container full
screen**, so full-screen dual stream is impossible, and it is an iOS limitation,
not a WebKit one. Hence the button hides where policy forbids it instead of
sitting there doing nothing.

### [S5 · Live dual stream](spikes/s5-live-dual/) ✅

**Can two independent HLS live streams be synchronized?** Yes, **but only with
`EXT-X-PROGRAM-DATE-TIME`** in both playlists. Without that tag the correction
does not just get worse: **there is no way to measure** whether they are in
sync, because in a live stream `currentTime` starts from the moment each stream
began loading.

That is why the synchronizer has a live mode that compares absolute time, and
why without the tag the player **does not correct** rather than pretend. In
Wowza the property is `cupertinoEnableProgramDateTime`, off by default.

### [S6 · Intro and outro chaining](spikes/s6-chaining/) ✅

**Can the intro hand over to the content —and the content to the outro—
without a visible gap?** Yes, but only by starting the next piece **600 ms
before** the current one ends, muted, and switching on its first frame: 0 ms
gap on Chromium, WebKit and an iPhone 17 Pro with Safari 26.5.

---

## Development

Requirements: Node 20+, pnpm, ffmpeg.

```bash
pnpm install
pnpm test          # 394 unit tests
pnpm typecheck
```

The accessibility audit runs on the demo's build, not on the dev server —
auditing what is actually deployed is more faithful:

```bash
pnpm --filter @nanoplayer/demo build
cd e2e && node a11y.mjs --serve ../demo/dist
node keyboard.mjs --serve ../demo/dist
node chaining.mjs --serve ../demo/dist
```

### The demo

```bash
cd demo
./gen-media.sh     # generates the test videos with ffmpeg
pnpm --filter @nanoplayer/demo dev      # http://localhost:5180
```

It is the public website: a landing page explaining what the player is, a video
demo, a live demo on a public test channel, and the core's **test bench**. See
[`demo/README.md`](demo/README.md).

### The spikes

```bash
# S1 — sync bench
cd spikes/s1-dual-sync
./gen-media.sh && pnpm install
node serve.mjs 8099     # http://127.0.0.1:8099 to see it
node measure.mjs        # automatic measurement

# S2 — device probe
cd spikes/s2-device-matrix
./gen-media.sh && pnpm install
node build.mjs          # -> dist/nanoplayer-probe.html
node verify.mjs         # check the probe before handing it out

# S5 — live dual stream
cd spikes/s5-live-dual
./stream.sh             # two live broadcasts started together
node serve.mjs 8170     # serves the playlists WITHOUT caching: essential for live
node measure.mjs 30
```

Test media are not versioned: they are regenerated with `gen-media.sh`.

### Publishing

Every push to `main` publishes the website and the S1, S2 and S6 benches to
GitHub Pages. CI runs the tests, the typecheck, the accessibility audit, the
keyboard walk and the chaining check, and they **block the merge**:
accessibility that is not checked automatically gets lost without anyone
noticing, which is exactly what this project exists to prevent.

---

## License

[Apache-2.0](LICENSE). Permissive, with a patent grant.

A deliberate choice: anyone can use NanoPlayer, modify it, build it into
proprietary products and sell it, without asking. In a web player adoption is
the value, and legal friction is the first thing that rules an option out when
someone evaluates what to integrate.

Contributions come in under the same licence by default, per section 5 of
Apache-2.0 itself. No CLA to sign.
