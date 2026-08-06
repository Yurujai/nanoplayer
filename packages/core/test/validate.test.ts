import { describe, expect, it } from 'vitest';
import {
  masterStream, parseManifest, slaveStreams, trimOf, validateManifest,
} from '../src/validate.js';

/** Manifiesto dual-stream válido, con sobrescrituras puntuales. */
const dual = (over: Record<string, unknown> = {}) => ({
  id: 'clase-1',
  duration: 3600,
  streams: [
    { id: 'cam', role: 'presenter', audio: true,
      sources: [{ src: 'cam.mp4', type: 'video/mp4' }] },
    { id: 'slides', role: 'presentation', audio: false,
      sources: [{ src: 'slides.mp4', type: 'video/mp4' }] },
  ],
  ...over,
});

const pathsOf = (r: ReturnType<typeof validateManifest>) =>
  r.ok ? [] : r.errors.map((e) => e.path);

describe('validateManifest', () => {
  it('acepta un dual-stream bien formado', () => {
    const r = validateManifest(dual());
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('acepta un mono-stream', () => {
    const r = validateManifest({
      id: 'x',
      streams: [{ id: 'a', role: 'presenter', audio: true,
                  sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
    });
    expect(r.ok).toBe(true);
  });

  it('rechaza lo que no es un objeto', () => {
    for (const bad of [null, 42, 'x', []]) {
      expect(validateManifest(bad).ok).toBe(false);
    }
  });

  it('exige id y al menos un stream', () => {
    expect(pathsOf(validateManifest({}))).toEqual(
      expect.arrayContaining(['id', 'streams']),
    );
    expect(pathsOf(validateManifest({ id: 'x', streams: [] })))
      .toContain('streams');
  });

  // --- la regla que codifica los hallazgos de S1 y S2 ---------------------

  it('rechaza dos streams con audio', () => {
    const m = dual();
    (m.streams[1] as { audio: boolean }).audio = true;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(pathsOf(r)).toContain('streams');
    if (!r.ok) expect(r.errors.some((e) => /iOS/.test(e.message))).toBe(true);
  });

  it('rechaza que ningún stream lleve audio', () => {
    const m = dual();
    (m.streams[0] as { audio: boolean }).audio = false;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /maestro/.test(e.message))).toBe(true);
  });

  it('rechaza ids de stream duplicados', () => {
    const m = dual();
    (m.streams[1] as { id: string }).id = 'cam';
    expect(pathsOf(validateManifest(m))).toContain('streams[1].id');
  });

  it('exige el tipo MIME de cada fuente, que es lo que elige el motor', () => {
    const m = dual();
    (m.streams[0] as { sources: unknown[] }).sources = [{ src: 'a.mp4' }];
    expect(pathsOf(validateManifest(m))).toContain('streams[0].sources[0].type');
  });

  // --- anotaciones --------------------------------------------------------

  it('acepta recorte, capítulo y contenido interactivo juntos', () => {
    const r = validateManifest(dual({
      annotations: [
        { kind: 'trim', start: 30, end: 3400 },
        { kind: 'chapter', start: 60, title: 'Introducción' },
        { kind: 'h5p', start: 120, data: { library: 'H5P.Blanks 1.14' } },
      ],
    }));
    expect(r.ok).toBe(true);
  });

  it('rechaza un recorte sin fin o invertido', () => {
    expect(pathsOf(validateManifest(dual({ annotations: [{ kind: 'trim', start: 30 }] }))))
      .toContain('annotations[0].end');
    expect(pathsOf(validateManifest(dual({ annotations: [{ kind: 'trim', start: 90, end: 30 }] }))))
      .toContain('annotations[0].end');
  });

  it('rechaza más de un recorte', () => {
    const r = validateManifest(dual({
      annotations: [
        { kind: 'trim', start: 10, end: 20 },
        { kind: 'trim', start: 30, end: 40 },
      ],
    }));
    expect(pathsOf(r)).toContain('annotations');
  });

  it('rechaza recortar un directo', () => {
    const r = validateManifest(dual({
      live: true, annotations: [{ kind: 'trim', start: 10, end: 20 }],
    }));
    expect(r.ok).toBe(false);
  });

  it('exige título en los capítulos, porque es texto accesible', () => {
    expect(pathsOf(validateManifest(dual({ annotations: [{ kind: 'chapter', start: 5 }] }))))
      .toContain('annotations[0].title');
  });

  it('avisa, sin fallar, de una anotación fuera de la duración', () => {
    const r = validateManifest(dual({ annotations: [{ kind: 'chapter', start: 9999, title: 'x' }] }));
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.path)).toContain('annotations[0].start');
  });

  it('deja pasar un kind desconocido: lo resolverá su plugin', () => {
    const r = validateManifest(dual({
      annotations: [{ kind: 'encuesta', start: 10, data: {} }],
    }));
    expect(r.ok).toBe(true);
  });

  // --- pistas de texto ----------------------------------------------------

  it('exige src e idioma en las pistas de texto', () => {
    const r = validateManifest(dual({ textTracks: [{ src: 'a.vtt' }] }));
    expect(pathsOf(r)).toContain('textTracks[0].lang');
  });

  it('rechaza dos pistas marcadas por defecto', () => {
    const r = validateManifest(dual({
      textTracks: [
        { src: 'es.vtt', lang: 'es', default: true },
        { src: 'en.vtt', lang: 'en', default: true },
      ],
    }));
    expect(pathsOf(r)).toContain('textTracks');
  });

  it('acumula todos los errores en vez de parar en el primero', () => {
    const r = validateManifest({ streams: [{ role: 'presenter' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(2);
  });
});

describe('helpers', () => {
  it('parseManifest lanza con las rutas dentro del mensaje', () => {
    expect(() => parseManifest({})).toThrow(/streams/);
  });

  it('parseManifest devuelve el manifiesto si es válido', () => {
    expect(parseManifest(dual()).id).toBe('clase-1');
  });

  it('separa maestro y esclavos', () => {
    const m = parseManifest(dual());
    expect(masterStream(m).id).toBe('cam');
    expect(slaveStreams(m).map((s) => s.id)).toEqual(['slides']);
  });

  it('extrae el recorte, o null si no hay', () => {
    expect(trimOf(parseManifest(dual()))).toBeNull();
    const m = parseManifest(dual({ annotations: [{ kind: 'trim', start: 30, end: 90 }] }));
    expect(trimOf(m)).toEqual({ start: 30, end: 90 });
  });
});
