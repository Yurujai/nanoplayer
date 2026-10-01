/**
 * UI styles as a string, injected from JavaScript so the `<script>` case stays
 * one tag (a build can turn that off and import the CSS file). CSS variables
 * are the theming API. No Shadow DOM: ARIA relations do not cross it well.
 */
export const CSS = `
:where(.np) [hidden]{
  /* Any explicit display rule beats the hidden attribute: buttons declaring
     inline-flex stayed visible while hidden. */
  display:none!important;
}

.np{
  /* --- theming API: override these variables --- */
  --np-color-accent:#6aa9ff;
  --np-color-bg:#000;
  --np-color-control:#fff;
  --np-color-control-dim:rgba(255,255,255,.72);
  --np-color-bar-bg:rgba(255,255,255,.28);
  --np-color-bar-buffer:rgba(255,255,255,.45);
  --np-color-focus:#ffb648;
  --np-control-size:2.5rem;
  --np-bar-height:4px;
  --np-bar-height-active:6px;
  --np-radius:6px;
  --np-font:system-ui,-apple-system,sans-serif;
  --np-gradient:linear-gradient(to top,rgba(0,0,0,.78),rgba(0,0,0,0));
  --np-transition:120ms ease;

  /* One stacking scale: loose z-indexes let picture-in-picture cover the menu. */
  --np-z-pip:1;
  --np-z-overlay:2;
  --np-z-bar:3;
  --np-z-poster:4;

  position:relative;
  container-type:inline-size;
  background:var(--np-color-bg);
  font-family:var(--np-font);
  color:var(--np-color-control);
  overflow:hidden;
  line-height:1;
}
.np:focus-visible{outline:3px solid var(--np-color-focus);outline-offset:2px}
.np__stage{position:relative;display:flex;width:100%}
.np__stage>[data-stream]{position:relative;flex:1;min-width:0}
/* A live stream not on air has no video, hence no height for its notice. */
.np__stage>[data-stream]:not(:has(video)){aspect-ratio:16/9;background:#000}
.np__stage video{display:block;width:100%;height:auto}

/* --- poster --- */
.np__poster{
  position:absolute;inset:0;z-index:var(--np-z-poster);
  display:flex;align-items:center;justify-content:center;
  background:var(--np-color-bg) center/cover no-repeat;
}
.np__poster[hidden]{display:none}
.np--with-poster{aspect-ratio:16/9}
button.np__poster-play{
  width:4.5rem;height:4.5rem;border-radius:50%;
  display:inline-flex;align-items:center;justify-content:center;
  border:0;background:rgba(0,0,0,.55);color:var(--np-color-control);
  cursor:pointer;transition:background var(--np-transition),transform var(--np-transition);
}
button.np__poster-play:hover:not([disabled]){background:rgba(0,0,0,.75);transform:scale(1.06)}
button.np__poster-play:focus-visible{outline:3px solid var(--np-color-focus);outline-offset:3px}
button.np__poster-play svg{width:45%;height:45%;fill:currentColor;pointer-events:none}
.np__poster--loading button{opacity:.5;cursor:progress}
.np__poster--loading button svg{animation:np-pulse 1s ease-in-out infinite}
@keyframes np-pulse{50%{opacity:.35}}
.np--with-poster .np__bar{opacity:0;pointer-events:none}

/* Audio only: the poster becomes a backdrop below the bar, or it would cover it. */
.np__poster--backdrop{z-index:0;pointer-events:none}
.np--audio-only .np__stage{display:none}
.np--audio-only{aspect-ratio:16/9}
.np--audio-only.np--no-poster{aspect-ratio:auto;min-height:5.5rem}
.np--audio-only.np--no-poster .np__bar{background:#000}

/* --- control bar --- */
.np__bar{
  position:absolute;left:0;right:0;bottom:0;
  display:flex;flex-direction:column;gap:.25rem;
  padding:2.5rem .6rem .5rem;
  z-index:var(--np-z-bar);
  background:var(--np-gradient);
  transition:opacity var(--np-transition),transform var(--np-transition);
}
.np--inactive .np__bar{opacity:0;transform:translateY(.5rem);pointer-events:none}
/* Never hide the bar with focus inside it. */
.np__bar:focus-within{opacity:1!important;transform:none!important;pointer-events:auto!important}
.np__row{display:flex;align-items:center;gap:.15rem}

button.np__btn{
  flex:0 0 auto;
  width:var(--np-control-size);height:var(--np-control-size);
  display:inline-flex;align-items:center;justify-content:center;
  padding:0;border:0;border-radius:var(--np-radius);
  background:transparent;color:var(--np-color-control);
  cursor:pointer;transition:background var(--np-transition);
}
button.np__btn:hover{background:rgba(255,255,255,.16)}
button.np__btn:focus-visible{outline:3px solid var(--np-color-focus);outline-offset:-3px}
button.np__btn svg{width:60%;height:60%;fill:currentColor;pointer-events:none}
button.np__btn[disabled]{opacity:.4;cursor:default}

.np__time{
  font-size:.8125rem;font-variant-numeric:tabular-nums;
  color:var(--np-color-control-dim);padding:0 .5rem;white-space:nowrap;
}
.np__spacer{flex:1 1 auto}
.np__segment{
  flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:.8125rem;color:var(--np-color-control);
}
.np__segment:empty{display:none}

/* --- segment marks --- */
.np__row--progress{position:relative}
.np__marks{
  position:absolute;left:0;right:0;top:50%;height:var(--np-bar-height-active);
  transform:translateY(-50%);pointer-events:none;
}
.np__mark{position:absolute;top:0;bottom:0;width:3px;margin-left:-1.5px;background:rgba(0,0,0,.7)}
.np__tip{
  position:absolute;bottom:calc(100% + .45rem);transform:translateX(-50%);
  padding:.25rem .55rem;border-radius:4px;
  background:rgba(20,22,26,.94);color:var(--np-color-control);
  font-size:.78rem;white-space:nowrap;pointer-events:none;
}
.np__plugins{display:inline-flex;align-items:center}

/* --- sliders: native range inputs keep keyboard, touch and announcements --- */
.np__range{
  -webkit-appearance:none;appearance:none;
  width:100%;height:var(--np-bar-height-active);
  margin:0;padding:0;background:transparent;cursor:pointer;
}
.np__range::-webkit-slider-runnable-track{
  height:var(--np-bar-height);border-radius:99px;
  background:linear-gradient(to right,
    var(--np-color-accent) var(--np-progress,0%),
    var(--np-color-bar-buffer) var(--np-progress,0%),
    var(--np-color-bar-buffer) var(--np-buffered,0%),
    var(--np-color-bar-bg) var(--np-buffered,0%));
  transition:height var(--np-transition);
}
.np__range::-moz-range-track{
  height:var(--np-bar-height);border-radius:99px;
  background:linear-gradient(to right,
    var(--np-color-accent) var(--np-progress,0%),
    var(--np-color-bar-buffer) var(--np-progress,0%),
    var(--np-color-bar-buffer) var(--np-buffered,0%),
    var(--np-color-bar-bg) var(--np-buffered,0%));
}
.np__range::-webkit-slider-thumb{
  -webkit-appearance:none;appearance:none;
  width:13px;height:13px;border-radius:50%;border:0;
  background:var(--np-color-accent);
  margin-top:calc((var(--np-bar-height) - 13px) / 2);
  transform:scale(0);transition:transform var(--np-transition);
}
.np__range::-moz-range-thumb{
  width:13px;height:13px;border-radius:50%;border:0;
  background:var(--np-color-accent);
  transform:scale(0);transition:transform var(--np-transition);
}
.np__range:hover::-webkit-slider-thumb,
.np__range:focus-visible::-webkit-slider-thumb{transform:scale(1)}
.np__range:hover::-moz-range-thumb,
.np__range:focus-visible::-moz-range-thumb{transform:scale(1)}
.np__range:hover::-webkit-slider-runnable-track{height:var(--np-bar-height-active)}
.np__range:focus-visible{outline:3px solid var(--np-color-focus);outline-offset:4px;border-radius:2px}

.np__volume{display:flex;align-items:center}
.np__volume .np__range{width:0;opacity:0;transition:width var(--np-transition),opacity var(--np-transition)}
.np__volume:hover .np__range,
.np__volume:focus-within .np__range{width:5rem;opacity:1;margin:0 .5rem 0 .25rem}

/* --- overlays --- */
.np__overlay{position:absolute;z-index:var(--np-z-overlay);pointer-events:none}
.np__overlay--fill{inset:0}
.np__overlay--center{inset:0;display:flex;align-items:center;justify-content:center}
.np__overlay--captions{
  left:0;right:0;bottom:1.5rem;
  display:flex;flex-direction:column;align-items:center;gap:.25rem;
  padding:0 5%;text-align:center;
  transition:bottom var(--np-transition);
}
.np:not(.np--inactive) .np__overlay--captions{bottom:5.25rem}

/* Caption styling: the API to replace the native caption preferences we lose. */
.np__cue{
  --np-cue-size:clamp(.95rem,2.6cqw,1.6rem);
  display:inline-block;max-width:100%;
  background:var(--np-cue-bg,rgba(0,0,0,.78));
  color:var(--np-cue-color,#fff);
  font-size:calc(var(--np-cue-size) * var(--np-cue-scale,1));
  font-family:var(--np-cue-font,inherit);
  font-variant:var(--np-cue-variant,normal);
  text-shadow:var(--np-cue-edge,none);
  line-height:1.35;padding:.15em .5em;border-radius:3px;
  text-wrap:balance;
}
.np__cue b,.np__cue strong{font-weight:700}
.np__cue i,.np__cue em{font-style:italic}

/* --- live waiting notice --- */
.np__waiting{
  position:absolute;inset:0;z-index:var(--np-z-overlay);
  display:flex;align-items:center;justify-content:center;
  background:#000 center/cover no-repeat;
  padding:1rem;text-align:center;
}
.np__waiting-text{
  margin:0;padding:.5em .9em;border-radius:var(--np-radius);
  background:rgba(0,0,0,.72);font-size:clamp(.85rem,2.4cqw,1.1rem);
  max-width:90%;
}
.np__stage>[data-stream]{position:relative}

button.np__live{
  display:inline-flex;align-items:center;gap:.4rem;
  width:auto;height:auto;
  font:inherit;font-size:.7rem;font-weight:700;letter-spacing:.06em;
  padding:.3rem .55rem;margin-left:.4rem;border:0;border-radius:3px;
  background:#c8102e;color:#fff;cursor:default;
}
button.np__live::before{
  content:'';width:.45rem;height:.45rem;border-radius:50%;background:#fff;
}
/* Behind the edge: from indicator to action. */
button.np__live--behind{
  background:rgba(255,255,255,.2);cursor:pointer;opacity:1;
}
button.np__live--behind::before{background:var(--np-color-control-dim)}
button.np__live--behind:hover{background:rgba(255,255,255,.32)}
button.np__live:focus-visible{outline:3px solid var(--np-color-focus);outline-offset:2px}

/* --- settings menu --- */
.np__menu-anchor{position:relative;display:inline-flex}
.np__menu{
  position:absolute;right:0;bottom:calc(100% + .5rem);
  min-width:12rem;max-width:min(18rem,90vw);
  max-height:min(20rem,50vh);overflow-y:auto;
  background:rgba(20,22,26,.96);border-radius:var(--np-radius);
  box-shadow:0 8px 28px rgba(0,0,0,.5);
  padding:.3rem;font-size:.875rem;
}
.np__menu [role="menu"]{display:flex;flex-direction:column}
.np__menu button{
  display:flex;align-items:center;gap:.5rem;
  width:100%;padding:.6rem .7rem;min-height:2.5rem;
  border:0;border-radius:calc(var(--np-radius) - 2px);
  background:transparent;color:var(--np-color-control);
  font:inherit;text-align:left;cursor:pointer;
}
.np__menu button:hover{background:rgba(255,255,255,.12)}
.np__menu button:focus-visible{outline:3px solid var(--np-color-focus);outline-offset:-3px}
.np__menu-item--parent{justify-content:space-between}
.np__menu-value{
  display:inline-flex;align-items:center;gap:.15rem;
  color:var(--np-color-control-dim);
  white-space:nowrap;
}
.np__menu-item--parent>span:first-child{white-space:nowrap}
.np__menu-chevron{font-size:1.15em;line-height:1}
.np__menu-tick{width:1rem;flex:0 0 1rem;color:var(--np-color-accent)}
.np__menu-back{
  border-bottom:1px solid rgba(255,255,255,.14)!important;
  border-radius:0!important;margin-bottom:.2rem;font-weight:600;
}

/* --- stream layouts, from the data-role on each stream box --- */
.np--layout-presenter .np__stage>[data-role="presentation"],
.np--layout-presentation .np__stage>[data-role="presenter"]{display:none}

.np--layout-pip .np__stage{position:relative;display:block}
.np--layout-pip .np__stage>[data-role="presentation"]{width:100%}
.np--layout-pip .np__stage>[data-role="presenter"]{
  position:absolute;right:1rem;bottom:7rem;width:28%;min-width:8rem;
  transition:bottom var(--np-transition);
  border-radius:var(--np-radius);overflow:hidden;
  box-shadow:0 4px 16px rgba(0,0,0,.6);z-index:var(--np-z-pip);
}

.np--inactive.np--layout-pip .np__stage>[data-role="presenter"]{bottom:1rem}

@media (max-width:640px){
  .np--layout-side-by-side .np__stage{flex-direction:column}
}

/* --- intro and outro ---
   Over the content, shown by data-phase alone. Transparent, not display:none,
   so the waiting piece keeps decoding (see docs/browser-quirks.md#first-frame-latency). */
.np__stage>[data-bumper]{
  position:absolute;inset:0;z-index:var(--np-z-pip);
  background:#000;opacity:0;pointer-events:none;
}
.np__stage>[data-bumper] video{width:100%;height:100%;object-fit:contain}
.np[data-phase="intro"] .np__stage>[data-bumper="intro"],
.np[data-phase="outro"] .np__stage>[data-bumper="outro"]{opacity:1}
/* Audio only hides the stage; an intro with a picture still needs it. */
.np--audio-only:is([data-phase="intro"],[data-phase="outro"]) .np__stage{
  display:block;position:absolute;inset:0;
}

/* Skip intro: over the video, and it does not hide with the bar. */
button.np__skip{
  position:absolute;right:0;bottom:5.25rem;z-index:var(--np-z-bar);
  display:inline-flex;align-items:center;gap:.5rem;
  padding:.65rem .9rem .65rem 1.1rem;
  border:1px solid rgba(255,255,255,.35);border-right:0;
  border-radius:var(--np-radius) 0 0 var(--np-radius);
  background:rgba(0,0,0,.72);color:var(--np-color-control);
  font:inherit;font-size:.9375rem;cursor:pointer;
  transition:bottom var(--np-transition),background var(--np-transition);
}
button.np__skip:hover{background:rgba(0,0,0,.88)}
button.np__skip:focus-visible{outline:3px solid var(--np-color-focus);outline-offset:-3px}
button.np__skip svg{width:1.25rem;height:1.25rem;fill:currentColor;pointer-events:none}
.np--inactive button.np__skip{bottom:1.5rem}

/* --- accessibility --- */
.np__sr{
  position:absolute;width:1px;height:1px;padding:0;margin:-1px;
  overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;
}

@media (prefers-reduced-motion:reduce){
  .np *,.np *::before,.np *::after{transition-duration:.01ms!important}
}
/* Forced colours drop translucent backgrounds: borders keep controls visible. */
@media (forced-colors:active){
  button.np__btn,button.np__skip{border:1px solid ButtonText}
  .np__bar{background:Canvas}
}
`;

let injected = false;

/** Adds the styles once per document. */
export function injectStyles(doc: Document = document): void {
  if (injected || doc.getElementById('nanoplayer-styles')) return;
  const style = doc.createElement('style');
  style.id = 'nanoplayer-styles';
  style.textContent = CSS;
  doc.head.appendChild(style);
  injected = true;
}
