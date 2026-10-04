# @nanoplayer/bundle

The whole player in one file, with the interface, captions, chapters, picture
in picture, audio tracks, quality, media session, resume, transcript, xAPI and
the HLS engine already included. **125 KB, 39 KB gzip.**

It is the package for installing with one `<script>` tag and three lines: no
build, no tooling and no npm.

```html
<div id="player"></div>
<script src="nanoplayer.min.js"></script>
<script>
  NanoPlayer.create('#player', { manifest: '/api/video/123' });
</script>
```

That gives a player **with controls**: an accessible bar, a settings menu,
layouts, and captions if the manifest has tracks.

---

## How it differs from the core

`@nanoplayer/core` is *headless* on purpose — some people want their own
interface — so its `create()` attaches no controls. This one does:

```js
create('#player', { manifest });                    // with the bar
create('#player', { manifest, controls: false });   // without it
create('#player', { manifest, controls: { lang: 'en' } });
```

Everything else is the same, including **the lazy lifecycle**: attaching the
interface downloads nothing. While the poster is showing there is no `<video>`
in the DOM and no byte of video has been requested, and CI checks that by
loading this file in a real browser.

## One or the other, not both

This bundle **contains the core**. If the same page also loads
`@nanoplayer/core` separately, there will be two plugin registries and two
exclusive-playback policies, and neither will see the other. Plugins would not
activate and two players could play at once.

With your own build, use the individual packages:

```js
import { create } from '@nanoplayer/core';
import { attachControls } from '@nanoplayer/ui';
import '@nanoplayer/plugin-captions';
```

## What is published

| File | What for |
|---|---|
| `nanoplayer.min.js` | IIFE. Leaves the global `NanoPlayer`. **The one for the `<script>` tag** |
| `nanoplayer.umd.js` | UMD. For AMD loaders —RequireJS, Moodle— and CommonJS |
| `index.js` | ESM, for your own build |
| `nanoplayer.css` | The stylesheet as a file, for a strict CSP |

**UMD does not replace the IIFE**, even if it looks like it. UMD checks
`define.amd` first: on a page that already loads RequireJS, a UMD
`<script src>` registers as an anonymous module and **creates no global**. It
would stop working exactly on the platform where it is needed most. So both
ship, and CI checks each does its job with an AMD loader present.

## With a strict CSP

`injectStyles()` creates an inline `<style>`, and a `style-src 'self'` policy
without `'unsafe-inline'` blocks it **silently**: the player has no styles and
there is no error to look at. That is the normal case in an institutional
install.

The way out is to serve the stylesheet as one more resource:

```html
<link rel="stylesheet" href="/path/nanoplayer.css">
<div id="player"></div>
<script src="/path/nanoplayer.min.js"></script>
<script>
  NanoPlayer.create('#player', {
    manifest: '/api/video/123',
    controls: { injectStyles: false },
  });
</script>
```

Through npm, import the stylesheet like this:

```js
import '@nanoplayer/bundle/nanoplayer.css';
```

Checked in CI with the CSP really set by header, not simulated: zero violations
and the styles applied.

## HLS

The bundle carries the HLS engine but **not hls.js**: loading it is one more
tag, from any CDN or your own server, before the bundle.

```html
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.6.17/dist/hls.min.js"
        integrity="sha384-A+DTEBcAPU1Pk7Lby1xo6mi1AwflNlm+ojz8+BPFLErHgB1ZIgxfykSGIG+sPtC5"
        crossorigin="anonymous"></script>
<script src="nanoplayer.min.js"></script>
```

| | HLS |
|---|---|
| Chrome, Firefox, Edge | **With hls.js** on the page (`window.Hls`) |
| Safari and iOS | **Yes**, natively, with or without hls.js |
| MP4 everywhere | Yes, nothing extra |

- **Why not inside.** It would add some 150 KB that MP4-only pages would pay
  for, and each site can pick the version and where it comes from: its own
  server, if its CSP allows no third parties.
- **Any 1.x.** Tested with 1.6. The example pins a version so the `integrity`
  hash holds.
- **`defer` and `async` work.** The engine is chosen when playback starts, not
  when the player is created, so hls.js only has to be there by then.
- **Without it,** nothing breaks: Safari and iOS play HLS natively, and so do
  browsers that learn to.

Checked in CI on the built file in Chrome (`e2e/script-tag.mjs`): the page's
hls.js plays the stream, and the bundle contains none of it.

## Languages

Spanish and English out of the box; the rest is configuration:

```js
NanoPlayer.create('#player', { manifest, lang: 'eu', strings: {
  eu: { 'ui.play': 'Erreproduzitu' },
} });
```

See [`@nanoplayer/ui`](../ui/README.md#languages).
