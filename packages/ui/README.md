# @nanoplayer/ui

NanoPlayer's default interface: an accessible control bar.

A separate package on purpose. The core stays *headless* (some will want their
own interface), and the "batteries included" bundle ships both, so the
`<script>` case is still a single tag.

```ts
import { createPlayer } from '@nanoplayer/core';
import { attachControls } from '@nanoplayer/ui';

const player = createPlayer({ container, manifest: '/api/video/123', lang: 'es' });
await player.attach();
attachControls(player);
```

## Options

```ts
attachControls(player, { timeDisplay: 'remaining', aspectRatio: '16:9' });
```

| Option | Default | |
|---|---|---|
| `timeDisplay` | `'elapsed'` | `'remaining'` counts down to the end: "−7:30 / 10:00" |
| `aspectRatio` | none | A fixed shape, `'16:9'` or `'4:3'`, the videos fitted inside. Without it the player is as wide as its container and as tall as the video |
| `hideAfterMs` | `2500` | Idle time before the bar hides; `0` keeps it visible |
| `lang`, `strings` | the player's | Labels; see [Languages](#languages) |
| `label` | "Video player" | Accessible name of the player region |
| `poster` | `true` | Poster and play button until there is media |
| `injectStyles` | `true` | Off when importing `nanoplayer.css` instead |

With the bundle, the same options go under `controls`:
`NanoPlayer.create('#p', { manifest, controls: { aspectRatio: '16:9' } })`.

## Accessibility

Not an intention: it is checked in CI and **blocks the merge**.

| Decision | Why |
|---|---|
| Native `<button>` elements | They bring role, keyboard activation and focus. A `<div role="button">` means reimplementing all of it |
| `<input type="range">` for progress and volume | They bring keyboard, touch gestures and value announcements |
| `aria-valuetext` with spoken time | A screen reader would say "735"; with this it says "12 minutes and 15 seconds" |
| The bar does not hide while focus is inside | Keyboard users would lose sight of the control in use |
| A `role="status"` region | For what is only perceived by looking: buffering, errors |
| Buffering and errors are also on screen | A spinner while a stream has no data (after a short delay, so seeks do not flash it), and the error text with **Try again** when retrying can help. Neither is a live region: the status region already said it |
| No Shadow DOM | ARIA relationships do not cross that boundary well, and it would force a `::part` per element to allow styling |

**What the automated check does NOT cover:** axe-core finds about a third of
real problems. A green run prevents regressions but does not replace a review
with a screen reader.

### Safari and Tab navigation

**Safari does not tab to buttons by default.** With factory settings, Tab only
visits text fields and links; buttons, sliders and selects are skipped until
*System Settings → Keyboard → Keyboard navigation* is on (or, in Safari,
*Advanced → "Press Tab to highlight each item on a webpage"*).

It happens to every page, not just this one, but it matters because Safari is
the default browser on macOS and **the only engine on iOS**.

That is why the container has `tabindex="0"`: in that mode it is the only thing
that gets focus, and **shortcuts keep working from there**. Checked in WebKit
(space plays, arrows seek, `M` mutes) with focus on the player and without
entering any control.

Tab order is verified in CI **in both engines, starting from the document**
(`e2e/keyboard.mjs`), not with a programmatic `focus()`: that shortcut is what
hid this behaviour.

## Keyboard

| Key | Action |
|---|---|
| `Space` / `K` | Play or pause |
| `←` / `→` | ∓5 s |
| `J` / `L` | ∓10 s |
| `↑` / `↓` | Volume |
| `M` | Mute |
| `F` | Fullscreen |
| `0`–`9` | Jump to that percentage |
| `Home` / `End` | Start or end |

Shortcuts give way to keys the focused control already uses: arrows on a slider
belong to it, and space on a button activates it.

During the **intro** seek keys do nothing: there is no bar to refer them to.
During the **outro**, backwards returns to the content and forwards is ignored,
because the outro cannot be skipped.

## Mouse and touch

| On the video | Mouse | Touch |
|---|---|---|
| Once | Play or pause | Show or hide the controls |
| Twice | Fullscreen | Left half −10 s, right half +10 s; each further quick tap adds 10 s |

Each has a keyboard and button equivalent, so none is the only way to do
something. A touch does not pause: revealing the controls by pausing would
interrupt the video every time. A click that only closes the settings menu
does nothing else.

## Intro and outro

Both are drawn **on top of** the content, not in its place, so the stage does
not resize when switching. What is visible is decided by a single attribute,
`data-phase`, set by the player.

- **Skip intro** appears inside the video, bottom right, like the one on ads.
  It does not hide with the bar: during the intro it is the only thing to do.
  It comes before the bar in tab order.
- **The progress bar hides** while either plays, and the time says what it is
  and how much is left instead: "Intro · 0:05". The bar belongs to the content
  only.
- The outro **has no button** and cannot be skipped forward.

## Captions

They are drawn in a player-wide layer, not inside a `<video>`. The browser
would draw them inside the element, and in a side-by-side layout that squeezes
them into half the width.

The `<track>` is still there in `hidden` mode: the browser parses WebVTT and
handles timing (the hard part), and only where they are drawn is taken over.
**What is lost are the operating system's caption preferences**, so the
captions plugin adds its own: **Settings → Caption style** lets each viewer
choose size, text colour, background colour and opacity, font and text edge,
with a reset. The choice is remembered between visits (in `localStorage`) and
shared by every player on the page.

A site sets its defaults with variables; whatever the viewer changes wins over
them, and what they leave alone keeps the site's:

```css
.np {
  --np-cue-color: #fff;
  --np-cue-bg: rgba(0, 0, 0, .78);
  --np-cue-font: inherit;
}
.np .np__cue { --np-cue-size: 1.4rem; }   /* scales with width by default */
```

## Inside an iframe

It just works, but **fullscreen needs explicit permission**:

```html
<iframe src="…" allow="fullscreen; autoplay; picture-in-picture"></iframe>
```

Without that attribute the call is rejected with *Disallowed by permissions
policy*, and the button **hides itself** instead of doing nothing.

A less obvious consequence: `PlayerRegistry` does not cross iframes, so several
players in several iframes stop coordinating with each other.

## Languages

Spanish and English built in. **Adding another is configuration, not a fork:**

```ts
create('#player', {
  manifest,
  lang: 'eu',
  strings: {
    eu: {
      'ui.play': 'Erreproduzitu',
      'ui.pause': 'Pausatu',
      'ui.mute': 'Mututu',
    },
  },
});
```

Whatever the new language does not cover falls back to the base catalogue, so a
half-done translation leaves the player usable instead of with blank buttons. A
key that exists nowhere **is shown as is** (`ui.play`), because an empty gap
does not say where to look.

It works the same for changing a single word, the most common case and the one
that fits worst in a PR to the project:

```ts
create('#player', { manifest, strings: {
  es: { 'ui.layout.presentation': 'Pizarra' },
} });
```

The language is given **once**, in `create()`, and the bar, the poster and all
plugins inherit it. `attachControls(player, { lang })` exists only for the rare
case where the bar must speak a different one.

When nothing is given, the language of the document containing the player
(`<html lang>`) is used, and `es` if it declares none. An `es-MX` gets the `es`
catalogue.

### Keys

| Prefix | Covers |
|---|---|
| `ui.*` | Bar buttons and sliders |
| `ui.status.*` | Live region: playing, paused, loading |
| `ui.live.*` | Live: badge, waiting, go to the edge |
| `ui.chain.*` | Intro and outro: names and skip button |
| `ui.poster.*` | The poster before playback |
| `ui.settings.*` | Settings menu |
| `ui.layout.*` | Layout names |
| `captions.*` | Captions plugin |

Keys with a variable write it in braces (`'Behind live: {time}'`) so each
language can put the words in its own order.

### What needs no translation

Times and percentages are formatted by `Intl`, not by this catalogue. `12
minutes and 15 seconds` for `aria-valuetext`, `35%` for volume, and both come
out right in any language without anyone writing a string: in Basque the sign
goes first (`% 35`) and in Spanish it is separated by a space.

### Adding a language to the project

One more object in `packages/ui/src/strings.ts`, with the same keys as the base
language. Nothing else needs touching.

**CI checks that the translation is complete**, against the base language, so a
new language is covered without touching the test. It fails if:

- a base key is missing, and it names which ones;
- there is a key the base does not have, almost always a typo;
- a string is empty;
- **a variable is lost.** If `ui.live.behindBy` is `'Behind live: {time}'` and
  the translation only says `'Behind live'`, no key is missing and nothing is
  empty: the time simply stops appearing. That failure does not show when
  reading the diff.

### From a plugin

`ctx.t` comes in the context, so a plugin **neither guesses the language nor
brings its own table**:

```ts
plugins.register({ id: 'mine', load: () => ({
  activate(ctx) {
    ctx.whenUi((ui) => ui.addBarControl({
      id: 'mine', icon: ICON, label: () => ctx.t('mine.label'), onActivate,
    }));
  },
}) });

// When loaded, the plugin adds its strings to the shared catalogue:
strings.register('en', { 'mine.label': 'Mine' });
```

Integrators can override them with `strings` without touching the plugin.

## Theming

Everything customisable is a CSS variable. The whole player can be redesigned
without forking:

```css
.np {
  --np-color-accent: #c8102e;
  --np-control-size: 3rem;
  --np-bar-height: 6px;
  --np-radius: 0;
}
```
