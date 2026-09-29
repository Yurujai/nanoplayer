# @nanoplayer/engine-hls

HLS engine on top of [hls.js](https://github.com/video-dev/hls.js). It is the
second `MediaEngine` implementation, and proof the abstraction holds: you
register it and that is all, without touching the core.

```ts
import { createPlayer, nativeEngineFactory } from '@nanoplayer/core';
import { enginesWithHls } from '@nanoplayer/engine-hls';

createPlayer({
  container,
  manifest: '/api/video/123',
  engines: enginesWithHls(nativeEngineFactory),
});
```

## hls.js is loaded lazily

It is a peer dependency, and it is only downloaded **the first time HLS has to
play**. Checked in the browser: loading the page and resolving the manifest
never request the library; it appears when the engine attaches.

Whoever plays MP4 pays nothing, which is what lets a `<script>` tag coexist
with not dragging the library along just in case.

## How it splits with the native engine

| | `canPlay` for HLS | Winner |
|---|---|---|
| With MSE or ManagedMediaSource | `probably` | **hls.js** |
| Without MSE (older iOS) | `no` | native |

The whole decision lives in `canPlay`. Registering this engine first is
enough; there are no conditionals scattered through the code.

**It never decides from `canPlayType`.** Spike S2 measured that it returns
`"maybe"` for the HLS MIME type in all five browsers tested, including desktop
Chrome, which does not play HLS natively. See
[docs/browser-quirks.md](../../docs/browser-quirks.md#canplaytype-hls).

## Error recovery

This is the practical reason to prefer it where there is a choice: on a fatal
error it retries —`startLoad()` for network, `recoverMediaError()` for
decoding— and only tells the consumer once there is nothing left to try.

## Seeking outside the buffer

In WebKit hls.js does not notice a seek outside what it has buffered: it stays
idle and the video stays `seeking` forever. The engine calls `startLoad()` at
the new position whenever the target is not buffered. See
[docs/browser-quirks.md](../../docs/browser-quirks.md#webkit-hls-seek).

## Detaching kills the instance

`hls.destroy()` is not optional: without it the instance keeps requesting
segments even after the element has left the DOM. Checked through the full
cycle: after detaching, zero segment requests.
