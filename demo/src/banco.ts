/**
 * Banco de pruebas del núcleo.
 *
 * Usa la API pública tal cual la usaría un integrador: `createPlayer(...)` y
 * los métodos del ciclo de vida. Si algo aquí necesitase saltarse la API, sería
 * señal de que la API está mal.
 *
 * Sigue sin haber barra de controles ni layouts — eso es la Fase 2. Lo que se
 * ve son los botones del ciclo de vida en crudo, a propósito, porque lo
 * interesante de enseñar es justamente eso.
 */
import {
  createPlayer, type Manifest, type Player,
} from '@nanoplayer/core';
import { attachControls, type ControlBar } from '@nanoplayer/ui';
// Basta con importarlo: el plugin se auto-registra. El núcleo no lo conoce.
import '@nanoplayer/plugin-captions';
import { plugins, nativeEngineFactory } from '@nanoplayer/core';
import { enginesWithHls } from '@nanoplayer/engine-hls';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const MANIFIESTOS: Record<string, unknown> = {
  mono: {
    id: 'demo-mono',
    title: 'Un solo stream',
    duration: 40,
    streams: [
      { id: 'cam', role: 'presenter', label: 'Ponente', audio: true,
        sources: [{ src: 'media/presenter.mp4', type: 'video/mp4' }] },
    ],
  },
  dual: {
    id: 'demo-dual',
    title: 'Dos streams',
    duration: 40,
    streams: [
      { id: 'cam', role: 'presenter', label: 'Ponente', audio: true,
        sources: [{ src: 'media/presenter.mp4', type: 'video/mp4' }] },
      { id: 'slides', role: 'presentation', label: 'Diapositivas', audio: false,
        sources: [{ src: 'media/slides.mp4', type: 'video/mp4' }] },
    ],
    textTracks: [
      { src: 'media/es.vtt', lang: 'es', label: 'Español', kind: 'subtitles' },
      { src: 'media/en.vtt', lang: 'en', label: 'English', kind: 'subtitles' },
    ],
  },
  // Mismo contenido servido como HLS: el selector debe preferir hls.js donde
  // haya MSE, sin que nada más cambie.
  hls: {
    id: 'demo-hls',
    title: 'Dos streams por HLS',
    duration: 40,
    streams: [
      { id: 'cam', role: 'presenter', label: 'Ponente', audio: true,
        sources: [{ src: 'media/hls/presenter.m3u8',
                    type: 'application/vnd.apple.mpegurl' }] },
      { id: 'slides', role: 'presentation', label: 'Diapositivas', audio: false,
        sources: [{ src: 'media/hls/slides.m3u8',
                    type: 'application/vnd.apple.mpegurl' }] },
    ],
  },
  // Para ver que la validación no es decorativa: dos pistas de audio es
  // exactamente lo que S2 midió que rompe en iPhone.
  invalido: {
    id: 'demo-roto',
    streams: [
      { id: 'a', role: 'presenter', audio: true,
        sources: [{ src: 'media/presenter.mp4', type: 'video/mp4' }] },
      { id: 'b', role: 'presentation', audio: true,
        sources: [{ src: 'media/slides.mp4', type: 'video/mp4' }] },
    ],
  },
};

let player: Player | null = null;
let controles: ControlBar | null = null;
let peticiones = 0;

/* ------------------------------------------------------------------- log -- */

function log(type: string, payload: unknown): void {
  // La deriva llega a ~30 Hz; en el registro ahogaría todo lo demás.
  if (type === 'sync:drift' || type === 'time') return;
  const linea = document.createElement('div');
  linea.className = 'ev';
  const corto = JSON.stringify(payload, (k, v) =>
    (k === 'manifest' ? '…' : typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
  linea.innerHTML = `<span class="t">${type}</span> <span class="p">${corto ?? ''}</span>`;
  const cont = $('#eventos');
  cont.prepend(linea);
  while (cont.childElementCount > 120) cont.lastElementChild?.remove();
}

/* --------------------------------------------------------------- creación -- */

function crear(clave: string): Player {
  const p = createPlayer({
    container: $('#player'),
    manifest: MANIFIESTOS[clave] as Manifest,
    // Registrar hls.js delante basta para que gane donde puede. El selector
    // decide con `canPlay`, no con condicionales repartidos.
    engines: enginesWithHls(nativeEngineFactory),
  });

  p.bus.onAny((type, payload) => log(type, payload));
  p.on('engine:attach:ok', ({ engine }) => log('motor elegido', { engine }));
  p.on('state:change', pintar);
  p.on('time', pintar);

  p.on('sync:drift', ({ drift, action }) => {
    const ms = drift * 1000;
    const el = $('#deriva');
    el.textContent = (ms >= 0 ? '+' : '') + ms.toFixed(0) + ' ms';
    el.className = 'val ' + (Math.abs(ms) > 33 ? 'mal' : 'bien');
    $('#accion').textContent = action;
  });

  return p;
}

function limpiarEscenario(mensaje: string): void {
  controles?.destroy();
  controles = null;
  $('#escenario').innerHTML =
    `<p class="vacio">${mensaje}</p><div id="player"></div>`;
}

/* ------------------------------------------------------------------- UI --- */

function pintar(): void {
  const s = player?.state ?? 'idle';
  $('#estado').textContent = s;
  $('#estado').dataset['s'] = s;
  $('#resumeAt').textContent = (player?.resumeAt ?? 0).toFixed(2) + ' s';
  $('#peticiones').textContent = String(peticiones);
  $('#videos').textContent = String(document.querySelectorAll('#escenario video').length);
  $('#tiempo').textContent = (player?.currentTime ?? 0).toFixed(2) + ' s';

  const on = (sel: string, v: boolean) => { $<HTMLButtonElement>(sel).disabled = !v; };
  on('#btn-resolver', s === 'idle');
  on('#btn-enganchar', s === 'resolved');
  on('#btn-play', s === 'attached');
  on('#btn-pause', s === 'active');
  on('#btn-desalojar', s === 'attached' || s === 'active');
  on('#btn-seek', s === 'attached' || s === 'active');
}

$('#btn-resolver').addEventListener('click', async () => {
  player ??= crear($<HTMLSelectElement>('#fuente').value);
  peticiones++;
  await player.resolve().catch(() => {});
  pintar();
});

$('#btn-enganchar').addEventListener('click', async () => {
  $('#escenario').querySelector('.vacio')?.remove();
  await player?.attach().catch(() => {});
  // La barra se monta después de enganchar, cuando ya hay streams que envolver.
  if (player && !controles) {
    controles = attachControls(player, { lang: 'es' });
    const res = await plugins.activate(player, {}, player.manifest);
    log('plugins:activados', { activados: res.activated, omitidos: res.skipped });
  }
  pintar();
});

$('#btn-play').addEventListener('click', async () => {
  await player?.play().catch(() => {});
  pintar();
});

$('#btn-pause').addEventListener('click', () => { player?.pause(); pintar(); });

$('#btn-seek').addEventListener('click', () => {
  player?.seek(Math.random() * 30);
  pintar();
});

$('#btn-desalojar').addEventListener('click', () => {
  player?.detach();
  limpiarEscenario('Motor soltado. Cero elementos &lt;video&gt; en el DOM, ' +
    'posición conservada.');
  pintar();
});

$('#btn-reiniciar').addEventListener('click', () => {
  player?.destroy();
  player = null;
  peticiones = 0;
  $('#eventos').innerHTML = '';
  $('#deriva').textContent = '—';
  $('#deriva').className = 'val';
  $('#accion').textContent = '—';
  limpiarEscenario('Estado <code>idle</code>: solo el póster. Ni una petición de red.');
  pintar();
});

$('#fuente').addEventListener('change', () => {
  $<HTMLButtonElement>('#btn-reiniciar').click();
});

/**
 * Desincroniza los esclavos a mano para ver cómo se recuperan.
 *
 * Es la forma de hacer visible el sincronizador: 400 ms está por encima del
 * umbral de salto duro de Blink (500 ms no, 200 ms de WebKit sí), así que
 * según el motor se verá una corrección suave o un salto.
 */
$('#btn-sync').addEventListener('click', () => {
  const esclavos = [...document.querySelectorAll<HTMLVideoElement>('#escenario video')]
    .filter((v) => v.muted);
  for (const v of esclavos) v.currentTime = Math.max(0, v.currentTime - 0.4);
  log('demo:desincronizado', { streams: esclavos.length, ms: -400 });
});

pintar();
setInterval(pintar, 500);
