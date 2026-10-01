# Browser quirks

Every workaround in NanoPlayer that exists because a browser does something
surprising. Each entry says what happens, where, what the code does about it,
which test would catch a regression and where it was measured.

The code keeps at most a one-line comment pointing here (`see
docs/browser-quirks.md#<id>`). The reasoning lives in this file so that nobody
"simplifies" a workaround without knowing what it protects.

The **Revisit** line says what would let us remove the workaround. Browsers
change: Safari 26 already relaxed at least one of them.

| Id | Affects | In one line |
|---|---|---|
| [ios-no-preload](#ios-no-preload) | iOS Safari | Nothing downloads until the first `play()` |
| [ios-playsinline](#ios-playsinline) | iPhone | Without `playsinline`, playing goes full screen |
| [ios-single-audio](#ios-single-audio) | iPhone | Only one audio track plays at a time |
| [ios-container-fullscreen](#ios-container-fullscreen) | iPhone | No full screen for a container element |
| [ios-per-element-autoplay](#ios-per-element-autoplay) | iOS (older) | Permission to play with sound is per element |
| [webkit-hls-seek](#webkit-hls-seek) | WebKit + hls.js | hls.js misses long seeks and freezes |
| [play-abort](#play-abort) | All | `play()` interrupted by `pause()` rejects |
| [canplaytype-hls](#canplaytype-hls) | All | `canPlayType` says "maybe" to HLS everywhere |
| [sync-profiles](#sync-profiles) | WebKit vs Blink | Same sync settings, different drift |
| [live-currenttime-origin](#live-currenttime-origin) | All (live) | Live `currentTime` is not comparable between streams |
| [live-segment-latency](#live-segment-latency) | All (live) | Too close to the edge starves with long segments |
| [decoder-release](#decoder-release) | All | Removing a `<video>` does not free its decoder |
| [decoder-limit](#decoder-limit) | All | About 17–18 videos can decode at once |
| [first-frame-latency](#first-frame-latency) | All | A ready element still takes 250–430 ms to show a frame |
| [iframe-fullscreen](#iframe-fullscreen) | All (iframes) | Full screen refused without `allow="fullscreen"` |
| [native-captions-in-video](#native-captions-in-video) | All | Native captions are drawn inside the `<video>` box |
| [webkit-tab](#webkit-tab) | Safari | Tab does not reach buttons by default |
| [safari-ua-frozen](#safari-ua-frozen) | Safari 26+ | The user agent reports a frozen OS version |

---

## ios-no-preload

**What happens.** iOS Safari does not download media until something calls
`play()`, whatever `preload` says. `canplay` never arrives, and on Safari 26
not even `loadeddata` does.

**Where.** iPhone 17 Pro, Safari 26.5 (2026-09-28). The same happens elsewhere
with data saver, low power mode or `preload="none"`.

**What we do.** The native engine considers itself attached on `loadeddata`
**or** `suspend`, the standard event a browser fires when it stops downloading
on purpose. A resume position is applied on `loadedmetadata` if there is no
metadata yet. The player's `duration` falls back to the manifest while the
engine reports 0.

**Before the fix.** The attach waited for data forever, the `play()` behind it
never ran, and the play button did nothing (the bench stayed in `attaching`).

**Code.** `packages/core/src/native-engine.ts`, `packages/core/src/media-element-engine.ts`.
**Tests.** `packages/core/test/native-engine.test.ts` (resolves on `suspend`,
start position deferred to metadata). Reproducible on desktop by forcing
`preload` to `none`.
**Revisit.** Never: it is how iOS works, and `suspend` is correct everywhere.

## ios-playsinline

**What happens.** On iPhone, playing a `<video>` without `playsinline` takes it
full screen in the system player, and a second stream disappears.

**What we do.** Every engine sets both the property and the attribute (older
Safari only reads the attribute).

**Code.** `packages/core/src/media-element-engine.ts`.
**Evidence.** Spike S2.
**Revisit.** Never.

## ios-single-audio

**What happens.** iPhone does not play two audio tracks at once. Starting a
second element **with sound** stops the first one from presenting frames.

**What we do.**
- Validation rejects manifests with more than one stream with `audio: true`.
- The incoming piece of the intro/outro chain always starts muted and is
  unmuted at the switch, also when skipping the intro.

**Measured.** Skipping the intro with the incoming piece unmuted left a 321 ms
gap on iPhone; muted, 0 ms (S6 README, 2026-09-28).
**Code.** `packages/core/src/validate.ts`, `packages/core/src/chain-controller.ts`.
**Tests.** `packages/core/test/validate.test.ts`, `packages/core/test/chain.test.ts`.
**Revisit.** Never.

## ios-container-fullscreen

**What happens.** iPhone has no full screen for an arbitrary element, only for
a `<video>` in the system player. Dual-stream full screen is impossible there.

**What we do.** The full screen button uses the container where it can and
falls back to `webkitEnterFullscreen` on the master video. The button is shown
only when one of the two ways exists.

**Code.** `packages/ui/src/fullscreen-button.ts`.
**Evidence.** Spike S2 (device matrix).
**Revisit.** If iOS adds element full screen.

## ios-per-element-autoplay

**What happens.** Historically iOS granted permission to play with sound per
element, not per page. A piece started from a timer (no user gesture) could be
refused, or paused when unmuted.

**What we do.** On the first play, the chain "unlocks" the pieces that come
later (content behind an intro, and the outro) with `play()` + `pause()`. The
outro is attached at start so it can be unlocked.

**Measured.** On iPhone 17 Pro with Safari 26.5 the unlock **was not needed**:
without it, no seam was refused or paused (S6 README §5, variant B).
**Code.** `packages/core/src/chain-controller.ts` (the unlock step).
**Revisit.** Measure variant B of S6 on iOS 17 or 18. If it passes, remove the
unlock and attach the outro only near the end of the content: it currently
holds a decoder for the whole lecture.

## webkit-hls-seek

**What happens.** In WebKit, a long seek outside the buffered range leaves the
element at `readyState` 4 with no `waiting` event. hls.js does not notice the
seek, stays idle pointing at the end of its old buffer, and the video stays in
`seeking` forever. Chromium drops to `readyState` 1 and hls.js reloads in
about 100 ms.

**What we do.**
- The HLS engine calls `hls.startLoad(position)` when seeking outside the
  buffer.
- As a safety net, the synchronizer treats a slave that cannot be measured for
  more than 4 s while the master plays as stuck, and makes it seek to its own
  position (`recover`). The wait is published as `waiting`, never as `ok`.

**Measured.** With a 25-minute live window, rewinding 60 s or going back to
live froze the slides stream while the camera recovered (2026-09-28).
**Code.** `packages/engine-hls/src/index.ts`, `packages/core/src/sync.ts`.
**Tests.** `packages/engine-hls/test/seek.test.ts`, `packages/core/test/sync.test.ts`.
**Revisit.** Newer hls.js versions; check with a far seek on WebKit.

## play-abort

**What happens.** A `play()` followed by `pause()` before playback starts
rejects with `AbortError`. If the element already had enough data, the browser
resolves it instead, so the failure depends on timing.

**What we do.** Engines treat `AbortError` from `play()` as a non-event: no
error callback, no rejection.

**Before the fix.** The chain's unlock (`play()` + `pause()`) on an outro
without data was reported as a media error, and the chain dropped the outro.
The same bug would have shown "the video could not be played" when pausing
during loading. It shipped in `75e6bbb` and was fixed in `300959a`.
**Code.** `packages/core/src/media-element-engine.ts`.
**Tests.** `packages/core/test/native-engine.test.ts`, and end to end in
`e2e/chaining.mjs`, which fails in both engines without the fix.
**Revisit.** Never.

## canplaytype-hls

**What happens.** `canPlayType('application/vnd.apple.mpegurl')` returned
`"maybe"` in all five browsers measured, including desktop Chrome, which cannot
play HLS natively.

**What we do.** Engine selection decides HLS by the presence of Media Source
Extensions: with MSE, hls.js wins; without it (older iOS), the native engine.

**Code.** `packages/core/src/engine.ts` (`isHlsType`, `hasMse`),
`packages/core/src/native-engine.ts`, `packages/engine-hls/src/index.ts`.
**Tests.** `packages/engine-hls/test/selection.test.ts`.
**Evidence.** Spike S2.
**Revisit.** Never.

## sync-profiles

**What happens.** The same synchronization settings drift differently:

| Engine | median | p95 | max |
|---|---|---|---|
| Blink | 7.8 ms | 15 ms | 39 ms |
| WebKit (Mac) | 30.6 ms | 54 ms | 118 ms |
| WebKit (iPhone) | 28.1 ms | 209 ms | 405 ms |

WebKit on the phone has a good median with occasional severe excursions: not a
gain problem, but isolated jumps.

**What we do.** A WebKit profile with a lower hard-seek threshold, so a 200 ms
excursion is corrected instead of lingering. Hysteresis is mandatory in every
profile: without it the controller left a permanent 28.8 ms offset (S1).

**Code.** `packages/core/src/sync.ts`.
**Tests.** `packages/core/test/sync.test.ts`.
**Evidence.** Spikes S1 and S2.
**Revisit.** When re-measuring on new engine versions.

## live-currenttime-origin

**What happens.** In a live stream, `currentTime` starts wherever each player
began loading. Two streams synchronized to 28 ms had `currentTime` values 20 s
apart.

**What we do.** Live drift is measured by absolute time
(`EXT-X-PROGRAM-DATE-TIME`). Without that tag the player does not correct at
all and emits `sync:unavailable`, rather than correcting on a meaningless
reading.

**Code.** `packages/core/src/sync.ts`, `getProgramTime()` in both engines.
**Tests.** `packages/core/test/sync.test.ts`.
**Evidence.** Spike S5.
**Revisit.** Never.

## live-segment-latency

**What happens.** Going back to live 3 s behind the edge works with 2-second
segments and starves with 6-second ones: the next segment is not published
yet. Measured: 15 s of stuttering after "Go to live", then occasional stalls.

**What we do.** Engines may expose `liveSyncPosition()`. The HLS engine takes
hls.js's, which accounts for segment duration. `seekToLive()` goes there, and
"at the live edge" is measured from that position, not from the edge. The
engine-less fallback is still 3 s.

**Code.** `packages/core/src/live-edge.ts`, `packages/engine-hls/src/index.ts`.
**Tests.** `packages/core/test/live-edge.test.ts`, `packages/core/test/player.test.ts`.
**Revisit.** Never.

## decoder-release

**What happens.** Removing a `<video>` from the DOM does not free its decoder.
An iPhone that supports 17 simultaneous videos measured only 2 with a partial
clean-up. With hls.js, a detached instance also keeps downloading segments.

**What we do.** Detaching pauses, removes `src` and every `<source>`, calls
`load()` and only then removes the element. The HLS engine destroys its hls.js
instance first.

**Code.** `packages/core/src/media-element-engine.ts`, `packages/engine-hls/src/index.ts`.
**Tests.** `packages/core/test/native-engine.test.ts`.
**Evidence.** Spike S2.
**Revisit.** Never.

## decoder-limit

**What happens.** A page can decode about 17 (WebKit) or 18 (Blink) videos at
once. The limit is the engine's, not the hardware's, so it applies on desktop
too.

**What we do.** The lazy lifecycle downloads nothing until play, and players
can be detached (`attached → resolved`) keeping their position, so a page can
have more players than decoders.

**Code.** `packages/core/src/state.ts`, `packages/core/src/player.ts`,
`packages/core/src/registry.ts`.
**Evidence.** Spike S2.
**Revisit.** Never.

## first-frame-latency

**What happens.** Calling `play()` on a paused element that is already loaded
(`readyState` 4) still takes about 250 ms in Chromium and up to 430 ms in
WebKit (324–392 ms on iPhone) to present the first frame. Starting the next
piece when the previous one ends leaves a visible 340–445 ms black gap.

**What we do.** The chain starts the next piece 600 ms before the current one
ends, muted and hidden, and switches on its **first presented frame**
(`requestVideoFrameCallback`), not when `play()` resolves. The skip button uses
the same path.

**Code.** `packages/core/src/chain.ts`, `packages/core/src/chain-controller.ts`.
**Tests.** `packages/core/test/chain.test.ts`, `e2e/chaining.mjs`.
**Evidence.** Spike S6, with iPhone results.
**Revisit.** Never.

## iframe-fullscreen

**What happens.** Inside an `<iframe>` without `allow="fullscreen"`, a full
screen request is refused ("Disallowed by permissions policy").

**What we do.** The full screen button is hidden when neither
`fullscreenEnabled` nor the iOS video fallback is available, instead of showing
a control that does nothing.

**Code.** `packages/ui/src/fullscreen-button.ts`.
**Revisit.** Never.

## native-captions-in-video

**What happens.** Browsers draw native captions inside the `<video>` box. In a
side-by-side layout they are squeezed into half the player; in picture in
picture they can land inside the small video.

**What we do.** The `<track>` stays in `hidden` mode, so the browser still
parses WebVTT and times the cues, and the captions plugin paints the text in
an overlay as wide as the player. The operating system's caption preferences
no longer apply, so the plugin offers its own caption style panel, applied
through CSS variables (`--np-cue-*`) and remembered between visits.

**Code.** `packages/plugin-captions/src/index.ts`, `packages/plugin-captions/src/style.ts`.
**Revisit.** If a way appears to honour system caption preferences outside the
video box.

## webkit-tab

**What happens.** Safari does not move keyboard focus to buttons with Tab
unless "full keyboard access" is enabled in the operating system, which is off
by default.

**What we do.** The player container is focusable and receives the keyboard
shortcuts, so the player is operable from the keyboard in Safari anyway. The
keyboard e2e checks the container in WebKit and every control in Chromium.

**Code.** `packages/ui/src/control-bar.ts`, `packages/ui/src/keyboard-shortcuts.ts`.
**Tests.** `e2e/keyboard.mjs`.
**Revisit.** Never.

## safari-ua-frozen

**What happens.** From Safari 26 the user agent reports a frozen OS version: an
iPhone on iOS 26 says `iPhone OS 18_7`. `Version/26.5` is the part that tells
the real Safari.

**What we do.** Nothing in the player: it never sniffs the user agent and
detects capabilities instead. Recorded here because it matters when reading
device reports.

**Revisit.** Never.
