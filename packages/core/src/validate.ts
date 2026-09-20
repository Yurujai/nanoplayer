/**
 * Validación del manifiesto, escrita a mano y sin dependencias.
 *
 * Sin librería de esquemas, y **no por ahorrar kilobytes** — hay opciones que
 * pesan poco. Por dos motivos que no dependen del tamaño:
 *
 *   1. Cero dependencias en tiempo de ejecución. Esto acaba incrustado en
 *      aplicaciones ajenas, y los conflictos de versiones los paga quien
 *      integra, no quien publica.
 *   2. Los mensajes de error llevan razonamiento de dominio dentro. Un
 *      validador genérico diría "esperaba 1, recibí 2"; aquí interesa explicar
 *      *por qué* dos pistas de audio rompen en iOS.
 *
 * El riesgo real de hacerlo a mano es que los tipos y las comprobaciones se
 * separen con el tiempo. Se ataca de frente con el guardián de deriva de
 * `test/manifest-drift.test.ts`, que deja de compilar si se añade un campo sin
 * decidir qué hacer con él.
 *
 * Las reglas no son burocracia: varias codifican lo medido en los spikes, y
 * saltarse cualquiera de ellas produce un reproductor que falla en runtime en
 * un dispositivo concreto y no en el de quien lo integra.
 */
import type { Annotation, Manifest, Source, Stream } from './manifest.js';

export interface ValidationIssue {
  /** Ruta tipo `streams[1].sources[0].src`, para poder ir al sitio. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; manifest: Manifest; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateManifest(input: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const warn = (path: string, message: string) => warnings.push({ path, message });

  if (!isObj(input)) {
    return { ok: false, errors: [{ path: '', message: 'The manifest must be an object' }], warnings };
  }

  if (!isStr(input['id'])) err('id', 'Required, non-empty string');
  if (input['liveWaitingImage'] !== undefined && !isStr(input['liveWaitingImage'])) {
    err('liveWaitingImage', 'Must be a non-empty string if present');
  }
  if (input['liveWaitingImage'] !== undefined && input['live'] !== true) {
    warn('liveWaitingImage', 'Only used for live streams: `live: true` is missing');
  }
  if (input['duration'] !== undefined && (!isNum(input['duration']) || input['duration'] <= 0)) {
    err('duration', 'Must be a positive number if present');
  }
  const duration = isNum(input['duration']) ? input['duration'] : undefined;
  const live = input['live'] === true;

  // --- streams ------------------------------------------------------------
  const streams = input['streams'];
  if (!Array.isArray(streams) || streams.length === 0) {
    err('streams', 'Required, at least one stream');
  } else {
    const seen = new Set<string>();
    let withAudio = 0;

    streams.forEach((s: unknown, i: number) => {
      const at = `streams[${i}]`;
      if (!isObj(s)) return err(at, 'Must be an object');

      if (!isStr(s['id'])) err(`${at}.id`, 'Required, non-empty string');
      else if (seen.has(s['id'])) err(`${at}.id`, `Duplicate: "${s['id']}"`);
      else seen.add(s['id']);

      if (!isStr(s['role'])) err(`${at}.role`, 'Required, non-empty string');

      if (typeof s['audio'] !== 'boolean') err(`${at}.audio`, 'Required, boolean');
      else if (s['audio']) withAudio++;

      if (s['kind'] !== undefined && s['kind'] !== 'video' && s['kind'] !== 'audio') {
        err(`${at}.kind`, 'Must be either "video" or "audio"');
      }
      // Un stream sin imagen que además no lleva sonido no reproduce nada.
      if (s['kind'] === 'audio' && s['audio'] === false) {
        err(at, 'An audio-only stream with `audio: false` contributes nothing');
      }

      const sources = s['sources'];
      if (!Array.isArray(sources) || sources.length === 0) {
        err(`${at}.sources`, 'Required, at least one source');
      } else {
        sources.forEach((src: unknown, j: number) => {
          const sat = `${at}.sources[${j}]`;
          if (!isObj(src)) return err(sat, 'Must be an object');
          if (!isStr(src['src'])) err(`${sat}.src`, 'Required, non-empty string');
          if (!isStr(src['type'])) err(`${sat}.type`, 'Required: the MIME type decides the engine');
          if (src['height'] !== undefined && (!isNum(src['height']) || src['height'] <= 0)) {
            err(`${sat}.height`, 'Must be a positive number if present');
          }
        });
      }
    });

    // Regla central del modelo maestro/esclavo. Medido en los spikes:
    //   S1 — al stream con audio no se le puede alterar el playbackRate sin
    //        que se oiga, así que es forzosamente el maestro del reloj.
    //   S2 — iPhone no reproduce dos audios a la vez (dualAudio: false).
    if (withAudio === 0) {
      err('streams', 'No stream carries audio: the synchronisation clock master is missing');
    } else if (withAudio > 1) {
      err('streams', `${withAudio} streams with audio. There must be exactly one: ` +
                     'playing two tracks at once does not work on iOS and leaves ' +
                     'the synchronisation without a master');
    }
  }

  // --- anotaciones --------------------------------------------------------
  const annotations = input['annotations'];
  if (annotations !== undefined) {
    if (!Array.isArray(annotations)) {
      err('annotations', 'Must be an array if present');
    } else {
      let trims = 0;
      annotations.forEach((a: unknown, i: number) => {
        const at = `annotations[${i}]`;
        if (!isObj(a)) return err(at, 'Must be an object');
        if (!isStr(a['kind'])) return err(`${at}.kind`, 'Required: it decides which plugin consumes it');

        if (!isNum(a['start']) || a['start'] < 0) {
          err(`${at}.start`, 'Required, seconds >= 0');
        }
        if (a['end'] !== undefined) {
          if (!isNum(a['end'])) err(`${at}.end`, 'Must be a number if present');
          else if (isNum(a['start']) && a['end'] <= a['start']) {
            err(`${at}.end`, 'Must be later than start');
          }
        }
        if (duration !== undefined && isNum(a['start']) && a['start'] > duration) {
          warn(`${at}.start`, `Outside the declared duration (${duration}s)`);
        }

        if (a['kind'] === 'trim') {
          trims++;
          if (a['end'] === undefined) err(`${at}.end`, 'A trim needs end');
          if (live) err(at, 'A trim makes no sense on a live stream');
        }
        if (a['kind'] === 'chapter' && !isStr(a['title'])) {
          err(`${at}.title`, 'A chapter needs a title: it is text for screen readers');
        }
      });
      if (trims > 1) err('annotations', `${trims} trims. There can only be one`);
    }
  }

  // --- pistas de texto ----------------------------------------------------
  const textTracks = input['textTracks'];
  if (textTracks !== undefined) {
    if (!Array.isArray(textTracks)) {
      err('textTracks', 'Must be an array if present');
    } else {
      let defaults = 0;
      textTracks.forEach((t: unknown, i: number) => {
        const at = `textTracks[${i}]`;
        if (!isObj(t)) return err(at, 'Must be an object');
        if (!isStr(t['src'])) err(`${at}.src`, 'Required, non-empty string');
        if (!isStr(t['lang'])) err(`${at}.lang`, 'Required: without a language the track cannot be offered');
        if (t['default'] === true) defaults++;
      });
      if (defaults > 1) err('textTracks', 'Only one track can be the default');
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, manifest: input as unknown as Manifest, warnings };
}

/** Envoltorio que lanza. Cómodo cuando un manifiesto inválido no es recuperable. */
export function parseManifest(input: unknown): Manifest {
  const r = validateManifest(input);
  if (!r.ok) {
    const detail = r.errors.map((e) => `  ${e.path || '(root)'}: ${e.message}`).join('\n');
    throw new Error(`Invalid manifest:\n${detail}`);
  }
  return r.manifest;
}

/**
 * Si un stream es de solo sonido.
 *
 * Se deduce del tipo MIME salvo que el manifiesto lo diga explícitamente, así
 * que el caso habitual —una fuente `audio/mpeg`— no necesita configuración.
 */
export function isAudioOnly(stream: Stream): boolean {
  if (stream.kind !== undefined) return stream.kind === 'audio';
  return stream.sources.length > 0
    && stream.sources.every((s) => s.type.toLowerCase().startsWith('audio/'));
}

/** Si el manifiesto entero es de solo sonido: ni un stream trae imagen. */
export function isAudioOnlyManifest(m: Manifest): boolean {
  return m.streams.every(isAudioOnly);
}

/** El stream maestro: el que lleva el audio y gobierna el reloj. */
export function masterStream(m: Manifest): Stream {
  const s = m.streams.find((x) => x.audio);
  if (!s) throw new Error('El manifiesto no tiene stream maestro');
  return s;
}

/** Los streams que persiguen al maestro. */
export function slaveStreams(m: Manifest): Stream[] {
  return m.streams.filter((s) => !s.audio);
}

/** El recorte declarado, si lo hay. */
export function trimOf(m: Manifest): { start: number; end: number } | null {
  const t = m.annotations?.find((a): a is Extract<Annotation, { kind: 'trim' }> => a.kind === 'trim');
  return t ? { start: t.start, end: t.end } : null;
}

export type { Source, Stream };
