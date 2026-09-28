/**
 * Demo de vídeo: el reproductor tal cual lo vería quien lo integre.
 *
 * Lo único propio de la demo es poder cambiar de manifiesto —mono o dual, con
 * o sin cabecera y cola— sin recargar. Se hace como lo haría un integrador:
 * destruir el reproductor y crear otro, conservando la posición.
 */
import { create, type Manifest, type Player } from '@nanoplayer/core';
import { attachControls, type ControlBar } from '@nanoplayer/ui';
// Importarlos basta: los plugins se auto-registran y el núcleo no los conoce.
import '@nanoplayer/plugin-captions';
import '@nanoplayer/plugin-chapters';

// La página cuelga de /video/ y los medios de la raíz de la web.
const MEDIOS = '../media/';
const TITULO = 'Introduction to thermodynamics';

function manifiesto(dual: boolean, cadena: boolean): Manifest {
  return {
    id: `demo-${dual ? 'dual' : 'mono'}${cadena ? '-cadena' : ''}`,
    title: TITULO,
    duration: 40,
    poster: `${MEDIOS}poster.jpg`,
    streams: [
      { id: 'speaker', role: 'presenter', label: 'Speaker', audio: true,
        sources: [{ src: `${MEDIOS}presenter.mp4`, type: 'video/mp4', height: 540 }] },
      ...(dual ? [
        { id: 'slides', role: 'presentation', label: 'Slides', audio: false,
          sources: [{ src: `${MEDIOS}slides.mp4`, type: 'video/mp4', height: 540 }] },
      ] : []),
    ],
    ...(cadena ? {
      intro: { sources: [{ src: `${MEDIOS}intro.mp4`, type: 'video/mp4' }] },
      outro: { sources: [{ src: `${MEDIOS}outro.mp4`, type: 'video/mp4' }] },
    } : {}),
    textTracks: [
      { src: `${MEDIOS}en.vtt`, lang: 'en', label: 'English', kind: 'subtitles' },
      { src: `${MEDIOS}es.vtt`, lang: 'es', label: 'Español', kind: 'subtitles' },
    ],
    annotations: [
      { kind: 'chapter', start: 0, end: 12, title: 'Welcome' },
      { kind: 'chapter', start: 12, end: 28, title: 'The first law' },
      { kind: 'chapter', start: 28, title: 'Wrap-up' },
    ],
  };
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

let player: Player | null = null;
let controles: ControlBar | null = null;

/**
 * Monta un reproductor nuevo con las opciones elegidas.
 *
 * Si el anterior ya había arrancado, el nuevo sigue por donde iba y **sin
 * repetir la cabecera**: activarla a mitad de clase no debería devolver a
 * nadie al principio.
 */
async function montar(): Promise<void> {
  const dual = $<HTMLInputElement>('#modo-dual').checked;
  const cadena = $<HTMLInputElement>('#cadena').checked;
  const desde = player && player.state !== 'idle' ? player.currentTime : 0;
  const sonaba = !!player && !player.paused;

  controles?.destroy();
  player?.destroy();
  // Un contenedor limpio: el anterior guarda clases y atributos de la barra.
  const nuevo = document.createElement('div');
  nuevo.id = 'player';
  nuevo.className = 'reproductor';
  $('#player').replaceWith(nuevo);

  player = create(nuevo, { manifest: manifiesto(dual, cadena), lang: 'en' });
  controles = attachControls(player, { label: TITULO });

  if (desde > 0 || sonaba) {
    await player.resolve();
    player.skipIntro();
    player.seek(desde);
    if (sonaba) await player.play().catch(() => {});
  }
}

for (const sel of ['#modo-mono', '#modo-dual', '#cadena']) {
  $(sel).addEventListener('change', () => { void montar(); });
}
void montar();
