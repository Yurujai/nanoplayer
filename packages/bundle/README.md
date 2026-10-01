# @nanoplayer/bundle

The whole player in one file, with the interface, captions, chapters, picture
in picture and audio tracks already included. **102 KB, 31 KB gzip.**

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

## What it does NOT include

**The HLS engine.** `@nanoplayer/engine-hls` loads hls.js with a dynamic
`import()`, and a classic `<script>` tag has nothing to resolve that specifier.

In practice:

| | HLS |
|---|---|
| Safari and iOS | **Yes**, through the native engine |
| Chrome, Firefox, Edge | No |
| MP4 everywhere | Yes |

HLS on desktop needs npm and registering the engine. It is on the to-do list:
the sensible way out is for the bundle to pick up a `window.Hls` already
loaded, so adding hls.js from a CDN in another tag is enough.

## Languages

Spanish and English out of the box; the rest is configuration:

```js
NanoPlayer.create('#player', { manifest, lang: 'eu', strings: {
  eu: { 'ui.play': 'Erreproduzitu' },
} });
```

See [`@nanoplayer/ui`](../ui/README.md#languages).
