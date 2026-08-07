/**
 * Guardián de deriva entre los tipos y el validador.
 *
 * El punto débil de validar a mano es que alguien añada un campo a `Manifest` y
 * se olvide de comprobarlo: los tipos lo aceptan, el validador lo ignora y el
 * fallo aparece en runtime, en el navegador de otro.
 *
 * Estos mapas usan `Record<keyof X, ...>`, así que **añadir un campo a un tipo
 * rompe la compilación** hasta que se declare aquí explícitamente si se valida
 * o no. No comprueba que la validación sea correcta —para eso están los tests
 * de comportamiento— pero sí que la decisión se haya tomado a conciencia.
 */
import { describe, expect, it } from 'vitest';
import type { Manifest, Source, Stream, TextTrackDef } from '../src/manifest.js';
import { validateManifest } from '../src/validate.js';

type Estado = 'validado' | 'libre';

const MANIFEST: Record<keyof Manifest, Estado> = {
  id: 'validado',
  streams: 'validado',
  duration: 'validado',
  annotations: 'validado',
  textTracks: 'validado',
  live: 'validado',
  liveWaitingImage: 'validado',
  title: 'libre',   // texto opcional: cualquier cadena sirve
  poster: 'libre',  // URL opcional; si falla, se degrada a fondo negro
};

const STREAM: Record<keyof Stream, Estado> = {
  id: 'validado',
  role: 'validado',
  audio: 'validado',
  sources: 'validado',
  kind: 'validado',
  label: 'libre',
  poster: 'libre',
};

const SOURCE: Record<keyof Source, Estado> = {
  src: 'validado',
  type: 'validado',
  height: 'validado',
  label: 'libre',
};

const TEXT_TRACK: Record<keyof TextTrackDef, Estado> = {
  src: 'validado',
  lang: 'validado',
  default: 'validado',
  kind: 'libre',
  label: 'libre',
};

describe('deriva entre tipos y validador', () => {
  it('cada campo declarado tiene una decisión tomada', () => {
    for (const mapa of [MANIFEST, STREAM, SOURCE, TEXT_TRACK]) {
      for (const [campo, estado] of Object.entries(mapa)) {
        expect(estado, `campo "${campo}"`).toMatch(/^(validado|libre)$/);
      }
    }
  });

  it('los campos "libres" no impiden validar un manifiesto', () => {
    // Si alguno pasara a ser obligatorio sin actualizar el mapa, esto avisa.
    const r = validateManifest({
      id: 'x',
      streams: [{
        id: 'a', role: 'presenter', audio: true,
        sources: [{ src: 'a.mp4', type: 'video/mp4' }],
      }],
    });
    expect(r.ok).toBe(true);
  });

  it('un manifiesto con TODOS los campos sigue siendo válido', () => {
    // Ejercita cada campo de cada tipo. `satisfies` obliga a que este objeto
    // siga encajando con los tipos: si cambian, falla al compilar.
    const completo = {
      id: 'clase-1',
      title: 'Introducción a la termodinámica',
      poster: 'poster.jpg',
      duration: 3600,
      live: false,
      streams: [
        { id: 'cam', role: 'presenter', label: 'Ponente', audio: true,
          poster: 'cam.jpg',
          sources: [{ src: 'cam.m3u8', type: 'application/vnd.apple.mpegurl',
                      height: 1080, label: '1080p' }] },
        { id: 'slides', role: 'presentation', label: 'Diapositivas', audio: false,
          sources: [{ src: 'slides.mp4', type: 'video/mp4' }] },
      ],
      annotations: [
        { kind: 'trim', start: 12, end: 3500 },
        { kind: 'chapter', start: 60, end: 900, title: 'Primer principio' },
        { kind: 'h5p', start: 300, end: 330, data: { library: 'H5P.Blanks 1.14' } },
      ],
      textTracks: [
        { src: 'es.vtt', lang: 'es', label: 'Español', kind: 'subtitles', default: true },
        { src: 'en.vtt', lang: 'en', label: 'English', kind: 'subtitles' },
      ],
    } satisfies Manifest;

    const r = validateManifest(completo);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});
