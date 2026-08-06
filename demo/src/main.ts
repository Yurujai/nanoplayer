/**
 * El reproductor, tal cual.
 *
 * Sin botones de ciclo de vida ni instrumentación: esto es lo que vería quien
 * lo integre en su web, y son literalmente las tres líneas que promete el
 * objetivo O5.
 *
 * A medida que aparezcan plugins nuevos se irán añadiendo aquí, para tener un
 * sitio donde verlos funcionar juntos y no cada uno por su cuenta.
 */
import { create } from '@nanoplayer/core';
import { attachControls } from '@nanoplayer/ui';
// Importarlo basta: el plugin se auto-registra y el núcleo no lo conoce.
import '@nanoplayer/plugin-captions';

const MANIFIESTO = {
  id: 'clase-termodinamica',
  title: 'Introducción a la termodinámica',
  duration: 40,
  poster: 'media/poster.jpg',
  streams: [
    { id: 'ponente', role: 'presenter', label: 'Ponente', audio: true,
      sources: [{ src: 'media/presenter.mp4', type: 'video/mp4', height: 540 }] },
    { id: 'diapositivas', role: 'presentation', label: 'Diapositivas', audio: false,
      sources: [{ src: 'media/slides.mp4', type: 'video/mp4', height: 540 }] },
  ],
  textTracks: [
    { src: 'media/es.vtt', lang: 'es', label: 'Español', kind: 'subtitles' },
    { src: 'media/en.vtt', lang: 'en', label: 'English', kind: 'subtitles' },
  ],
  annotations: [
    { kind: 'chapter', start: 0, end: 12, title: 'Presentación' },
    { kind: 'chapter', start: 12, end: 28, title: 'Primer principio' },
    { kind: 'chapter', start: 28, title: 'Cierre' },
  ],
};

const player = create('#player', { manifest: MANIFIESTO });
attachControls(player, { lang: 'es', label: MANIFIESTO.title });

/* ------------------------------------------------------------------------- */
/* El resto de esta página es solo para poder observar lo que hace el núcleo   */
/* por dentro. No forma parte de lo que necesitaría un integrador.             */

const $ = (sel: string) => document.querySelector<HTMLElement>(sel)!;

const marcar = (sel: string, ok: boolean, texto: string) => {
  const el = $(sel);
  el.textContent = texto;
  el.className = 'dato ' + (ok ? 'si' : 'no');
};

function actualizar(): void {
  marcar('#d-estado', player.state === 'active', player.state);
  const videos = document.querySelectorAll('#player video').length;
  marcar('#d-videos', videos === 0, String(videos));
  marcar('#d-plugins', true,
    (window as unknown as { __plugins?: string[] }).__plugins?.join(', ') || '—');
}

player.bus.onAny((tipo) => {
  if (tipo === 'time' || tipo === 'sync:drift') return;
  const li = document.createElement('li');
  li.textContent = tipo;
  const ul = $('#eventos');
  ul.prepend(li);
  while (ul.childElementCount > 8) ul.lastElementChild?.remove();
  actualizar();
});

player.on('state:change', actualizar);
setInterval(actualizar, 700);
actualizar();

// Exponer lo activo, solo para el panel informativo de la derecha.
import('@nanoplayer/core').then(({ plugins }) => {
  player.on('manifest:resolve:ok', () => {
    setTimeout(() => {
      (window as unknown as { __plugins?: string[] }).__plugins = plugins.active;
      actualizar();
    }, 50);
  });
});
