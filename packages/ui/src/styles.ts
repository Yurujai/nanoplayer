/**
 * Estilos de la interfaz, como cadena.
 *
 * Se inyectan desde JavaScript para que el caso `<script>` siga siendo una sola
 * etiqueta. Quien tenga build propio puede desactivarlo e importar el CSS.
 *
 * **Todo lo personalizable son variables CSS**, y esa es la API de theming: se
 * puede rediseñar el reproductor entero sin forkear el proyecto. Nada de Shadow
 * DOM — las relaciones ARIA no cruzan bien esa frontera y obligaría a exponer
 * un `::part` por cada elemento para poder darle estilo desde fuera.
 */
export const CSS = `
.np{
  /* --- API de theming: sobrescribe estas variables y ya --- */
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

  position:relative;
  background:var(--np-color-bg);
  font-family:var(--np-font);
  color:var(--np-color-control);
  overflow:hidden;
  line-height:1;
}
.np:focus-visible{outline:3px solid var(--np-color-focus);outline-offset:2px}
.np__stage{display:flex;width:100%}
.np__stage>[data-stream]{position:relative;flex:1;min-width:0}
.np__stage video{display:block;width:100%;height:auto}

/* --- barra de controles --- */
.np__bar{
  position:absolute;left:0;right:0;bottom:0;
  display:flex;flex-direction:column;gap:.25rem;
  padding:2.5rem .6rem .5rem;
  background:var(--np-gradient);
  transition:opacity var(--np-transition),transform var(--np-transition);
}
.np--inactive .np__bar{opacity:0;transform:translateY(.5rem);pointer-events:none}
/* Nunca ocultar la barra si el foco está dentro: quien navega con teclado
   perdería de vista el control que está usando. */
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
.np__plugins{display:inline-flex;align-items:center}

/* --- deslizadores ---
   Son <input type="range"> nativos a propósito: traen teclado, gestos táctiles
   y anuncio de valores. Reimplementarlos con un div y role="slider" es donde se
   pierde a quien usa lector de pantalla. */
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

/* --- menú de ajustes --- */
.np__menu-anchor{position:relative;display:inline-flex}
.np__menu{
  position:absolute;right:0;bottom:calc(100% + .5rem);
  min-width:12rem;max-width:min(18rem,90vw);
  /* La altura real la fija el JS al abrir, según el hueco sobre la barra. */
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
  white-space:nowrap;   /* "Lado a lado" partía en dos líneas */
}
.np__menu-item--parent>span:first-child{white-space:nowrap}
.np__menu-chevron{font-size:1.15em;line-height:1}
.np__menu-tick{width:1rem;flex:0 0 1rem;color:var(--np-color-accent)}
.np__menu-back{
  border-bottom:1px solid rgba(255,255,255,.14)!important;
  border-radius:0!important;margin-bottom:.2rem;font-weight:600;
}

/* --- disposición de los streams ---
   Todo por CSS, apoyándose en el data-role que el Player pone en cada caja. */
.np--layout-presenter .np__stage>[data-role="presentation"],
.np--layout-presentation .np__stage>[data-role="presenter"]{display:none}

.np--layout-pip .np__stage{position:relative;display:block}
.np--layout-pip .np__stage>[data-role="presentation"]{width:100%}
.np--layout-pip .np__stage>[data-role="presenter"]{
  position:absolute;right:1rem;bottom:5rem;width:28%;min-width:8rem;
  border-radius:var(--np-radius);overflow:hidden;
  box-shadow:0 4px 16px rgba(0,0,0,.6);z-index:1;
}

/* En pantallas estrechas, lado a lado deja dos vídeos ilegibles. */
@media (max-width:640px){
  .np--layout-side-by-side .np__stage{flex-direction:column}
}

/* --- accesibilidad --- */
.np__sr{
  position:absolute;width:1px;height:1px;padding:0;margin:-1px;
  overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;
}

/* Quien pide menos movimiento no debería recibir transiciones. */
@media (prefers-reduced-motion:reduce){
  .np *,.np *::before,.np *::after{transition-duration:.01ms!important}
}
/* En alto contraste, los fondos translúcidos desaparecen: hacen falta bordes. */
@media (forced-colors:active){
  button.np__btn{border:1px solid ButtonText}
  .np__bar{background:Canvas}
}
`;

let inyectado = false;

/** Mete los estilos una vez por documento. */
export function injectStyles(doc: Document = document): void {
  if (inyectado || doc.getElementById('nanoplayer-styles')) return;
  const style = doc.createElement('style');
  style.id = 'nanoplayer-styles';
  style.textContent = CSS;
  doc.head.appendChild(style);
  inyectado = true;
}
