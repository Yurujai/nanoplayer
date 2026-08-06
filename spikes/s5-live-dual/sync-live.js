/*
 * Spike S5 — sincronización de dos directos HLS independientes.
 *
 * Código desechable: sirve para responder una pregunta, no para reutilizarse.
 *
 * La pregunta: **¿puede el reproductor mantener juntos dos directos que salen
 * alineados de origen?** No si el origen los alinea —eso es trabajo del
 * servidor de emisión— sino si el navegador es capaz de no separarlos.
 *
 * Por qué hace falta medir dos cosas a la vez:
 *
 *   - `currentTime` es la posición dentro de la ventana de la lista. Cada flujo
 *     tiene su propia ventana, que empieza donde le toca y **se desplaza** al
 *     caducar segmentos. Comparar dos currentTime es comparar relojes sin
 *     origen común: puede dar cero estando desincronizados, o al revés.
 *
 *   - `playingDate` es la hora absoluta de la posición actual, y solo existe si
 *     la lista trae `EXT-X-PROGRAM-DATE-TIME`. Esa sí es comparable: dos
 *     posiciones con la misma hora son el mismo instante.
 *
 * Medir ambas es lo que permite responder qué se compra activando la etiqueta.
 */

const $ = (id) => document.getElementById(id);

const CFG = {
  // Cuántos segmentos por detrás del borde arranca hls.js. Es el parámetro que
  // más influye en si dos instancias empiezan juntas o separadas.
  liveSyncDurationCount: Number(new URLSearchParams(location.search).get('lsdc') ?? 3),
};

const flujos = [
  { id: 'presenter', el: $('vPresenter'), hls: null },
  { id: 'slides', el: $('vSlides'), hls: null },
];

const muestras = [];
let midiendo = false;
let arranque = null;

function log(txt) {
  const l = document.createElement('div');
  l.textContent = `${new Date().toLocaleTimeString()}  ${txt}`;
  $('registro').prepend(l);
  while ($('registro').childElementCount > 60) $('registro').lastElementChild?.remove();
}

/* ------------------------------------------------------------------ carga -- */

function crear(flujo) {
  const hls = new Hls({
    lowLatencyMode: false,
    liveSyncDurationCount: CFG.liveSyncDurationCount,
    enableWorker: true,
  });
  flujo.hls = hls;
  hls.attachMedia(flujo.el);
  hls.loadSource(`vivo/${flujo.id}.m3u8`);

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    const conPdt = hls.levels?.[0]?.details?.hasProgramDateTime;
    log(`${flujo.id}: lista cargada · PROGRAM-DATE-TIME: ${conPdt ? 'sí' : 'NO'}`);
    flujo.el.play().catch((e) => log(`${flujo.id}: play rechazado — ${e.name}`));
  });
  hls.on(Hls.Events.ERROR, (_e, d) => {
    if (d.fatal) log(`${flujo.id}: ERROR ${d.type} / ${d.details}`);
  });
  flujo.el.addEventListener('waiting', () => log(`${flujo.id}: sin búfer`));
}

/* ------------------------------------------------------------- medición --- */

/** Hora absoluta de la posición actual. `null` si la lista no trae la etiqueta. */
function horaDe(flujo) {
  const d = flujo.hls?.playingDate;
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
}

function medir() {
  const [a, b] = flujos;
  const ha = horaDe(a), hb = horaDe(b);

  // Deriva verdadera: diferencia de hora absoluta entre las dos posiciones.
  const porHora = (ha !== null && hb !== null) ? hb - ha : null;
  // Lo único que se podría comparar sin la etiqueta.
  const porTiempo = (b.el.currentTime - a.el.currentTime) * 1000;

  // Retraso respecto al directo: cuánto va por detrás de la hora real.
  const retraso = ha !== null ? Date.now() - ha : null;

  return { porHora, porTiempo, retraso, t: performance.now() };
}

function pintar(m) {
  const fmt = (v, u = 'ms') => v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(0)} ${u}`;
  $('porHora').textContent = fmt(m.porHora);
  $('porHora').className = 'val ' + (m.porHora === null ? ''
    : Math.abs(m.porHora) > 200 ? 'mal' : Math.abs(m.porHora) > 50 ? 'medio' : 'bien');
  $('porTiempo').textContent = fmt(m.porTiempo);
  $('retraso').textContent = m.retraso === null ? '—' : `${(m.retraso / 1000).toFixed(1)} s`;
  $('muestras').textContent = String(muestras.length);

  if (muestras.length > 1) {
    const abs = muestras.map((x) => Math.abs(x.porHora ?? 0)).sort((p, q) => p - q);
    $('mediana').textContent = `${abs[Math.floor(abs.length / 2)].toFixed(0)} ms`;
    $('maxima').textContent = `${abs[abs.length - 1].toFixed(0)} ms`;
  }
}

setInterval(() => {
  const m = medir();
  if (midiendo && m.porHora !== null) muestras.push(m);
  pintar(m);
}, 250);

/* --------------------------------------------------------------- controles */

$('btn-cargar').onclick = () => {
  if (!Hls.isSupported()) { log('hls.js no está soportado aquí'); return; }
  for (const f of flujos) crear(f);
  $('btn-cargar').disabled = true;
  $('btn-medir').disabled = false;
  $('btn-cortar').disabled = false;
  log(`liveSyncDurationCount = ${CFG.liveSyncDurationCount}`);
};

$('btn-medir').onclick = () => {
  midiendo = !midiendo;
  if (midiendo) { muestras.length = 0; arranque = performance.now(); log('midiendo…'); }
  else log(`medición parada tras ${((performance.now() - arranque) / 1000).toFixed(0)} s`);
  $('btn-medir').textContent = midiendo ? 'Parar medición' : 'Empezar medición';
};

/** Corta el búfer de un flujo para ver si recupera o se queda descolgado. */
$('btn-cortar').onclick = async () => {
  const f = flujos[1];
  log('cortando "slides" 3 s…');
  f.el.pause();
  await new Promise((r) => setTimeout(r, 3000));
  await f.el.play().catch(() => {});
  log('reanudado');
};

$('btn-borde').onclick = () => {
  for (const f of flujos) {
    const d = f.hls?.liveSyncPosition;
    if (typeof d === 'number') f.el.currentTime = d;
  }
  log('ambos llevados al borde del directo');
};
