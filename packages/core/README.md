# @nanoplayer/core

The player's core: manifest, lifecycle, engines, sync and plugin registry. No
UI — the controls live in `@nanoplayer/ui`.

No runtime dependencies, and kept as light as possible.

---

## The manifest

It describes **what** to play, never **how**. It does not mention engines,
`<video>` elements or layouts: if the engine ever has to change, the manifest
does not notice.

It is **JSON**, with no format of its own. It can be passed in two ways:

```js
// An object, if the page already has the data
createPlayer({ container, manifest: { id: 'x', streams: [...] } });

// A URL, fetched and parsed as JSON
createPlayer({ container, manifest: '/api/video/123' });
```

JSON because any backend emits it effortlessly. A format of its own would mean
writing and maintaining a parser nobody asked for. If your API returns
something else, `manifestResolver` can translate it: the player only looks at
the final shape.

### Single stream, the minimal case

```json
{
  "id": "lecture-1",
  "title": "Introduction to thermodynamics",
  "poster": "https://example/thumbnail.jpg",
  "duration": 3600,
  "streams": [
    {
      "id": "camera",
      "role": "presenter",
      "audio": true,
      "sources": [
        { "src": "https://example/video.mp4", "type": "video/mp4" }
      ]
    }
  ]
}
```

### Dual stream

```json
{
  "id": "lecture-1",
  "duration": 3600,
  "streams": [
    {
      "id": "camera", "role": "presenter", "label": "Speaker",
      "audio": true,
      "sources": [{ "src": "camera.mp4", "type": "video/mp4" }]
    },
    {
      "id": "slides", "role": "presentation", "label": "Slides",
      "audio": false,
      "sources": [{ "src": "slides.mp4", "type": "video/mp4" }]
    }
  ]
}
```

> **Exactly one stream may carry `audio: true`.** It is not a matter of taste:
> that stream is the master of the sync clock and the others chase it. Spike S1
> measured that changing the rate of the stream with audio is audible, so the
> correction falls on the muted ones; and S2 measured that **iOS does not play
> two audio tracks at once**. A manifest with two is rejected at validation,
> instead of producing a player that fails only on iPhone.

### HLS

Identical, changing the sources' MIME type:

```json
{
  "streams": [
    {
      "id": "camera", "role": "presenter", "audio": true,
      "sources": [
        { "src": "camera.m3u8", "type": "application/vnd.apple.mpegurl" }
      ]
    }
  ]
}
```

With `@nanoplayer/engine-hls` registered, that type makes hls.js win where
there is MediaSource and the native engine where there is not. **Nothing else
in the manifest changes.**

### Several qualities

```json
"sources": [
  { "src": "video-1080.mp4", "type": "video/mp4", "height": 1080, "label": "1080p" },
  { "src": "video-720.mp4",  "type": "video/mp4", "height": 720 },
  { "src": "video-360.mp4",  "type": "video/mp4", "height": 360 }
]
```

The engine chooses. With HLS, hls.js does adaptive selection and one source is
enough.

### Captions

```json
"textTracks": [
  { "src": "es.vtt", "lang": "es", "label": "Español", "kind": "subtitles", "default": true },
  { "src": "en.vtt", "lang": "en", "label": "English", "kind": "subtitles" }
]
```

With `@nanoplayer/plugin-captions` loaded, this **turns captions on with no
configuration**: the plugin declares that it applies when the manifest has
tracks.

A track with `"kind": "descriptions"` is not offered as subtitles: it gets its
own entry in the settings menu, and its cues are **read out to screen readers**
through a live region, never drawn. `"kind": "chapters"` tracks are left alone;
chapters come from `annotations`.

### Audio description and other languages

Alternative audio comes from the media, not the manifest: the `EXT-X-MEDIA`
renditions of an HLS playlist, or the tracks of the file where the browser
exposes them (Safari; Chrome does not). With
`@nanoplayer/plugin-audio-tracks` loaded, an **Audio** entry appears in the
settings menu once the media reports more than one track. A rendition with
`CHARACTERISTICS="public.accessibility.describes-video"` is marked as audio
description.

```text
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Español",LANGUAGE="es",DEFAULT=YES,URI="es.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Español",LANGUAGE="es",URI="es-ad.m3u8",CHARACTERISTICS="public.accessibility.describes-video"
```

From code: `player.audioTracks`, `player.audioTrack`, `player.setAudioTrack(id)`
and the `audio:tracks` event.

### Quality

With hls.js the choices are the playlist's levels plus automatic. With MP4,
list one source per height and they become the choices; switching keeps the
position and whether it was playing. The browser starts on the first one it
can play.

```json
"sources": [
  { "src": "cam-720.mp4", "type": "video/mp4", "height": 720 },
  { "src": "cam-360.mp4", "type": "video/mp4", "height": 360 }
]
```

With `@nanoplayer/plugin-quality` loaded, a **Quality** entry appears in the
settings menu when there are two or more. With two streams, the other one
follows: it takes its tallest quality not above the master's. Native HLS
(Safari, iOS) offers no choice; the browser decides.

From code: `player.qualities`, `player.quality`, `player.playingQuality`,
`player.setQuality(id)` (`AUTO_QUALITY` for automatic) and the
`quality:change` event.

### Resuming

With `@nanoplayer/plugin-resume` loaded, a recorded lecture continues where
the viewer left it, keyed by the manifest's `id`, and says so: "Resuming from
12:30". Not after only a few seconds, and not near the end, which counts as
finished. Live is left alone.

Positions live in `localStorage` by default. An LMS passes its own store so
the position follows the student to another device; any method may be async,
and a failing store never stops playback:

```js
create('#player', {
  manifest,
  plugins: {
    resume: {
      store: {
        load: (id) => lms.get(`position/${id}`),      // { time, duration } or null
        save: (id, position) => lms.put(`position/${id}`, position),
        clear: (id) => lms.delete(`position/${id}`),
      },
    },
  },
});
```

`resume: false` turns it off.

### Transcript

With `@nanoplayer/plugin-transcript` loaded and caption tracks in the
manifest, a **Transcript** button in the bar opens a panel below the player:
every phrase with its time, the current one marked, and any of them a way to
jump there. It is one tab stop, moved through with the arrow keys. The file is
fetched only when the panel opens; with several languages the panel has its
own picker.

The panel sits right after the player's element, on the page, so it inherits
the page's colours and fonts. It is not shown in full screen.

### Links to a time

With `@nanoplayer/plugin-time-links` loaded, a lecture opens at the minute a
link names, and **Settings → Copy link to this moment** makes such a link:

```text
https://campus.example/lecture-3#t=23:10
https://campus.example/lecture-3?t=1390
https://campus.example/lecture-3#t=1h2m30s&v=lecture-3
```

`t` takes seconds, `mm:ss`, `h:mm:ss` or `1h2m30s`. With several players on
a page, `v` names the manifest the time is for; without it, the first player
takes it. A link on the same page (`<a href="#t=12:30">`) jumps there and
plays. A time from a link wins over the position the resume plugin
remembers. Not for live streams.

### Thumbnails

```json
"thumbnails": "thumbs.vtt"
```

A WebVTT file whose cues name the picture for each stretch, usually a region
of one sprite sheet so a single request serves the whole bar:

```text
WEBVTT

00:00:00.000 --> 00:00:05.000
thumbs.jpg#xywh=0,0,160,90

00:00:05.000 --> 00:00:10.000
thumbs.jpg#xywh=160,0,160,90
```

With `@nanoplayer/plugin-thumbnails` loaded, hovering the progress bar shows
the picture above the time. Image URLs are relative to the WebVTT file. Times
are media time, like annotations, so a trim does not shift them. The file is
fetched when playback starts or on the first hover, not with the page.

### Chromecast and AirPlay

With `@nanoplayer/plugin-cast` loaded, a button appears in the bar **when a
device is available**, and opens the browser's own picker. It uses the
standard Remote Playback API, which Chrome (desktop and Android) and Safari
(macOS and iOS) implement: no Google SDK, no receiver app to register. The
`<video>` stays in charge while it plays remotely, so the control bar keeps
working, and the player says the picture is on another screen.

- **Only the master is sent**, the stream with the sound: remote playback is
  per element, and one screen shows one video.
- **AirPlay needs a plain source.** Under hls.js the element plays Media Source
  buffers, which AirPlay cannot take; where Safari plays the HLS natively, or
  with MP4, it works.
- Older Safari without the standard API falls back to its AirPlay picker.

### Progress to the LMS (xAPI)

`@nanoplayer/plugin-xapi` reports what was watched as [xAPI Video
Profile](https://w3id.org/xapi/video) statements, which any LRS reads:
`initialized` and `played` on the first play, then `paused`, `seeked`,
`completed` and `terminated` when the page goes away. Progress counts what was
really watched, each second once: dragging to the end does not complete a
lecture. The intro and outro are left out.

It is off unless configured, as it needs somewhere to report to: an LRS, or
the LMS's own channel.

```js
create('#player', {
  manifest,
  plugins: {
    xapi: {
      endpoint: 'https://lrs.example.org/xapi',   // statements go to …/statements
      auth: 'Basic ' + btoa('key:secret'),
      actor: { objectType: 'Agent', mbox: 'mailto:student@example.org' },
      // send: (statement) => lms.record(statement),  // instead of endpoint
      // activityId: 'https://lms.example.org/course/7/lecture/3',
      // completionThreshold: 0.9,
    },
  },
});
```

The activity id defaults to `urn:nanoplayer:video:<manifest id>`. A failing
LRS never stops playback.

### Analytics

`@nanoplayer/plugin-analytics` sends player events to any analytics
destination, in batches: every 10 s, every 20 events, and with `sendBeacon`
as the page goes away. Off unless configured.

```js
create('#player', {
  manifest,
  plugins: {
    analytics: {
      endpoint: 'https://stats.example.org/collect',        // POSTs a JSON array
      // send: (events) => events.forEach((e) => gtag('event', e.type, e)),
      context: { course: 'PHY-101' },                        // added to every event
      // events: ['play', 'pause', 'ended'] or 'all'; sample: 0.1
    },
  },
});
```

Each event carries `type`, `time`, a random `session`, the manifest's `id` as
`video`, `position`, `duration`, the event's own `data` and the `context`.
Besides the bus events worth counting (play, pause, seeks, errors, stalls,
quality, intro and outro…, not the per-second `time`), it derives two:

| Event | |
|---|---|
| `milestone` | 25, 50 and 75 % **played through**, a seek past them does not count; 100 at the end |
| `session:end` | Seconds really watched, and the milestones reached |

No personal data: whoever needs to tie events to a student adds it to
`context`, deliberately.

### Audio only

Nothing needs declaring: the MIME type is enough.

```json
{
  "id": "podcast-1",
  "poster": "https://example/cover.jpg",
  "streams": [
    {
      "id": "voice", "role": "presenter", "audio": true,
      "sources": [{ "src": "audio.m4a", "type": "audio/mp4" }]
    }
  ]
}
```

The cover **stays up during playback** instead of leaving a black rectangle.
Without `poster`, the player shrinks to the control bar: reserving an empty
video box adds nothing.

When the MIME type is not enough —audio-only HLS, whose type is the same as for
video— it is declared explicitly:

```json
{ "id": "x", "role": "presenter", "audio": true, "kind": "audio",
  "sources": [{ "src": "audio.m3u8", "type": "application/vnd.apple.mpegurl" }] }
```

### Audio with slides

A lecture without a camera but with the presentation. The master/slave model
does not change: **the audio is the master** and the muted video chases it.

```json
"streams": [
  { "id": "voice", "role": "presenter", "audio": true,
    "sources": [{ "src": "audio.m4a", "type": "audio/mp4" }] },
  { "id": "slides", "role": "presentation", "audio": false,
    "sources": [{ "src": "slides.mp4", "type": "video/mp4" }] }
]
```

### Intro and outro

Pieces chained before and after the content: an institutional intro or an
outro with credits.

```json
"intro": { "sources": [{ "src": "intro.mp4", "type": "video/mp4" }] },
"outro": { "sources": [{ "src": "outro.mp4", "type": "video/mp4" }] }
```

**Both are optional and independent of each other.** Use one, both or neither.

Each is **a single piece with its own sound**, even if the content is dual
stream: there is nothing to sync.

**The intro can be skipped; the outro cannot.** That is why there is no field
to configure it: the piece's role decides. Not skipping the outro means it
cannot be fast-forwarded with the bar, the keyboard or the system controls
either. It is possible to **seek back** into the content, and on reaching the
end again the outro plays again.

The progress bar shows **only the content**, already trimmed if there is a
`trim`. Neither `duration` nor `currentTime` count the intro or the outro.

**Both are rejected in a live stream.** While the intro plays, the broadcast
moves on and the edge is reached late. The outro depends on the broadcast
ending, and a live stream does not guarantee it.

#### How the chain works

Starting the next piece when the previous one ends leaves a black gap of
340–445 ms (spike S6). So the next one starts **600 ms early**, muted and
behind, and the switch happens **on its first frame**, not as soon as it
accepts `play()`. No gap is left on any engine.

| | |
|---|---|
| `player.phase` | `'intro'`, `'main'` or `'outro'` |
| `player.canSkip` | `true` only during the intro |
| `player.skipIntro()` | Skips the intro, with no gap. There is no `skipOutro()` |
| `chain:phase` | `{ from, to, skipped }`, at the moment of the visible switch |
| `chain:time` | Progress of the intro or outro. `time` is content only |
| `chain:unavailable` | A piece does not load and is skipped; the content goes on |

The phase is also published as `data-phase` on the container: the UI decides
what is shown from **that single attribute**, and flipping it at once is what
makes the switch instant.

`ended` arrives when **the outro** finishes, not the content. Pressing play
afterwards goes back to the start of the content, without the intro. If the
player is evicted halfway through a piece, that piece restarts from the
beginning on return.

### Annotations

Data anchored to the timeline. It unifies what look like separate features:
trim, chapters and interactive content consume the same mechanism, and adding a
new one does not touch the core.

```json
"annotations": [
  { "kind": "trim", "start": 12, "end": 3500 },
  { "kind": "chapter", "start": 60, "end": 900, "title": "First law" },
  { "kind": "h5p", "start": 300, "data": { "src": "https://lms.example/h5p/embed.php?id=7", "title": "Quick check" } }
]
```

An unknown `kind` **passes validation**: its plugin will handle it, not the
core.

#### Trim

`trim` **does not modify the media: it remaps the visible timeline.** With
`{ "kind": "trim", "start": 100, "end": 160 }` on a 600 s video:

| | |
|---|---|
| `player.duration` | `60`, not 600 |
| `player.currentTime` | Counts from the trim: at second 130 of the file it is `30` |
| `player.seek(20)` | Goes to second 120 of the media |
| `player.trim` | `{ start: 100, end: 160 }`, for whoever draws on the timeline |

Seeking outside is clamped: there is no way to reach the material on either
side, even though it is still in the file.

**The player enforces the end, not the media.** The file has 440 more seconds
and the engine does not know they are spare, so on reaching `end` it pauses and
emits `ended`. Pressing play afterwards goes back to the start of the trim, as
a `<video>` would at the end of the video.

The duration **is known without touching the network**: it comes from the
manifest, not the engine. If the manifest comes preloaded, the bar can show
`0:15` before a single byte is downloaded.

There can be only **one** trim, it needs `end`, and **it is rejected on a live
stream**: trimming something that has not finished makes no sense.


#### H5P

With `@nanoplayer/plugin-h5p` loaded, each `h5p` annotation is marked on the
bar, and playing through its `start` pauses the video and opens the activity
over the whole player. `data.src` is the content's **embed URL**, the one
Moodle, H5P.com or WordPress give; `data.title` names it. It is a dialog:
focus goes into it, Escape or **Continue the video** closes it and playback
goes on. Seeking over an activity does not open it.

Only `http(s)` URLs are accepted, and the iframe is sandboxed so the activity
cannot navigate the page. Results stay with whatever hosts the content: report
them from there, or with the xAPI plugin for the video itself.

### Live

```json
{
  "id": "closing",
  "live": true,
  "liveWaitingImage": "https://example/starts-at-10.jpg",
  "streams": [
    { "id": "camera", "role": "presenter", "audio": true,
      "sources": [{ "src": "camera.m3u8", "type": "application/vnd.apple.mpegurl" }] },
    { "id": "slides", "role": "presentation", "audio": false,
      "sources": [{ "src": "slides.m3u8", "type": "application/vnd.apple.mpegurl" }] }
  ]
}
```

`liveWaitingImage` is separate from `poster` on purpose: the poster is what is
shown **before** pressing play; this is what is shown **after**, while waiting.
They usually mean different things. If missing, the poster is used.

**A stream that is not broadcasting does not stop the rest from playing.** The
notice appears in the missing stream's slot, and it is retried with growing
delays until it starts. The status is read with `player.liveStatus` and
`player.liveStatusOf(id)`, and arrives through the `live:status` event.

**"Has not started yet"** is told apart from **"has been interrupted"**: saying
the former to someone who had been watching for twenty minutes would be
baffling.

> **Requirement for live dual stream:** both playlists must carry
> `EXT-X-PROGRAM-DATE-TIME`. Without that tag the player **cannot measure**
> whether the streams are in sync —live `currentTime` starts from the moment
> each one began loading— so it does not correct, rather than pretend. In Wowza
> it is the `cupertinoEnableProgramDateTime` property, off by default.

#### DVR window and live edge

Live, the server keeps a **sliding playlist**: it only holds the latest
segments and old ones expire. That is the **DVR window**, and it is how far
back one can go. In Wowza nDVR governs it, at a disk cost.

| Property | |
|---|---|
| `player.dvrWindow` | Seconds that can be sought back |
| `player.liveEdge` | Latest available position |
| `player.behindLive` | How far behind the edge playback is |
| `player.atLiveEdge` | Whether the edge is being watched |
| `player.seekToLive()` | Go back to the edge |

Playing a live stream always runs a few seconds behind the edge —the buffer
that prevents stalls— so `atLiveEdge` has a 12 s tolerance. And `seekToLive()`
does not go to the exact end: that instant is not buffered yet and seeking
there causes a stall.

**How far behind depends on the segments.** With 6 s segments, staying 3 s from
the edge means running out of data until the next one is published: measured,
15 s of stuttering on returning to live. So if the engine knows where it is
best to be (`liveSyncPosition()`, which hls.js works out from the segments),
`seekToLive()` goes there, and the `atLiveEdge` tolerance counts from that
position rather than the edge. Without that information, a 3 s margin.

A trim on a live stream is rejected: it makes no sense.

---

## Playback options

```js
create('#player', { manifest, autoplay: 'muted', loop: true });
```

| Option | | |
|---|---|---|
| `autoplay` | `true` | Tries with sound. Browsers usually refuse until the viewer has interacted with the site; then the play button stays |
| | `'muted'` | Starts muted, which browsers allow |
| | `'any'` | Tries with sound and, refused, retries muted |
| `loop` | `boolean` | Starts over at the end. The intro is not replayed |
| `muted`, `volume` | | Initial state |

Autoplay gives up the lazy lifecycle: the media downloads as soon as the
player is created. Sound that starts on its own needs a way to stop it (WCAG
1.4.2); the control bar provides one, and `'muted'` avoids the question.

## Reference

### Manifest

| Field | Type | |
|---|---|---|
| `id` | `string` | **Required** |
| `streams` | `Stream[]` | **Required**, at least one |
| `title` | `string` | |
| `poster` | `string` | Can also be passed to `createPlayer` to have it without resolving |
| `duration` | `number` | Seconds |
| `intro` | `Bumper` | Can be skipped. Not allowed live |
| `outro` | `Bumper` | Cannot be skipped. Not allowed live |
| `annotations` | `Annotation[]` | |
| `textTracks` | `TextTrackDef[]` | |
| `live` | `boolean` | |

### Bumper

| Field | Type | |
|---|---|---|
| `sources` | `Source[]` | **Required**, at least one |

### Stream

| Field | Type | |
|---|---|---|
| `id` | `string` | **Required**, unique |
| `role` | `string` | **Required**. `presenter`, `presentation` or another |
| `audio` | `boolean` | **Required**. Exactly one set to `true` |
| `sources` | `Source[]` | **Required**, at least one |
| `kind` | `'video' \| 'audio'` | Inferred from the MIME type; only needed if ambiguous |
| `label` | `string` | |
| `poster` | `string` | |

### Source

| Field | Type | |
|---|---|---|
| `src` | `string` | **Required** |
| `type` | `string` | **Required**. The MIME type picks the engine |
| `height` | `number` | |
| `label` | `string` | |

---

## Errors: a code for the UI, a message for whoever debugs

`PlayerError` always carries both, and they serve different audiences:

```ts
{ code: 'media/network', message: 'HLS network error: fragLoadError 404', retryable: true }
```

**`message` is diagnostic and always in English.** It carries the HTTP status,
the hls.js detail or the manifest path, and is meant for a `console.log`, an
issue or a search engine. **It is never shown to the end user.**

**`code` decides what the viewer is told.** The default UI resolves its own
text for each code —`ui.error.media/network` and so on—, translatable like the
rest of the catalogue, and falls back to `ui.error.generic` for a code it does
not know. So a screen reader user hears that the connection to the video was
lost, not "hls.js cannot run in this browser: no Media Source Extensions".

The same goes for `retryable`: deciding on the code rather than matching
strings is what allows translating without breaking anything.

| Code | |
|---|---|
| `manifest/fetch` | The manifest could not be fetched. Retryable |
| `manifest/invalid` | It arrived, but does not pass validation |
| `engine/unsupported` | No engine can play those sources |
| `engine/failed` | The engine failed to start. Retryable |
| `media/decode` | The media could not be decoded |
| `media/network` | Cut off by the network. Retryable |
| `media/blocked` | The browser blocked playback |
| `internal` | Programming error |

**Validation** messages follow the same rule: they are in English, because
they are read by whoever integrates, not whoever watches.

## Validate before playing

```ts
import { validateManifest } from '@nanoplayer/core';

const r = validateManifest(data);
if (!r.ok) {
  for (const e of r.errors) console.error(`${e.path}: ${e.message}`);
}
```

Errors **accumulate** rather than stopping at the first: fixing a manifest one
error at a time is maddening. And each message says why, not just what.
