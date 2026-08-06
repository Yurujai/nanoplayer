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
    return { ok: false, errors: [{ path: '', message: 'El manifiesto debe ser un objeto' }], warnings };
  }

  if (!isStr(input['id'])) err('id', 'Requerido, cadena no vacía');
  if (input['duration'] !== undefined && (!isNum(input['duration']) || input['duration'] <= 0)) {
    err('duration', 'Debe ser un número positivo si se indica');
  }
  const duration = isNum(input['duration']) ? input['duration'] : undefined;
  const live = input['live'] === true;

  // --- streams ------------------------------------------------------------
  const streams = input['streams'];
  if (!Array.isArray(streams) || streams.length === 0) {
    err('streams', 'Requerido, al menos un stream');
  } else {
    const seen = new Set<string>();
    let withAudio = 0;

    streams.forEach((s: unknown, i: number) => {
      const at = `streams[${i}]`;
      if (!isObj(s)) return err(at, 'Debe ser un objeto');

      if (!isStr(s['id'])) err(`${at}.id`, 'Requerido, cadena no vacía');
      else if (seen.has(s['id'])) err(`${at}.id`, `Duplicado: "${s['id']}"`);
      else seen.add(s['id']);

      if (!isStr(s['role'])) err(`${at}.role`, 'Requerido, cadena no vacía');

      if (typeof s['audio'] !== 'boolean') err(`${at}.audio`, 'Requerido, booleano');
      else if (s['audio']) withAudio++;

      const sources = s['sources'];
      if (!Array.isArray(sources) || sources.length === 0) {
        err(`${at}.sources`, 'Requerido, al menos una fuente');
      } else {
        sources.forEach((src: unknown, j: number) => {
          const sat = `${at}.sources[${j}]`;
          if (!isObj(src)) return err(sat, 'Debe ser un objeto');
          if (!isStr(src['src'])) err(`${sat}.src`, 'Requerido, cadena no vacía');
          if (!isStr(src['type'])) err(`${sat}.type`, 'Requerido: el tipo MIME decide el motor');
          if (src['height'] !== undefined && (!isNum(src['height']) || src['height'] <= 0)) {
            err(`${sat}.height`, 'Debe ser un número positivo si se indica');
          }
        });
      }
    });

    // Regla central del modelo maestro/esclavo. Medido en los spikes:
    //   S1 — al stream con audio no se le puede alterar el playbackRate sin
    //        que se oiga, así que es forzosamente el maestro del reloj.
    //   S2 — iPhone no reproduce dos audios a la vez (dualAudio: false).
    if (withAudio === 0) {
      err('streams', 'Ningún stream lleva audio: falta el maestro del reloj de sincronización');
    } else if (withAudio > 1) {
      err('streams', `${withAudio} streams con audio. Debe haber exactamente uno: ` +
                     'reproducir dos pistas a la vez no funciona en iOS y deja la sincronización sin maestro');
    }
  }

  // --- anotaciones --------------------------------------------------------
  const annotations = input['annotations'];
  if (annotations !== undefined) {
    if (!Array.isArray(annotations)) {
      err('annotations', 'Debe ser un array si se indica');
    } else {
      let trims = 0;
      annotations.forEach((a: unknown, i: number) => {
        const at = `annotations[${i}]`;
        if (!isObj(a)) return err(at, 'Debe ser un objeto');
        if (!isStr(a['kind'])) return err(`${at}.kind`, 'Requerido: decide qué plugin la consume');

        if (!isNum(a['start']) || a['start'] < 0) {
          err(`${at}.start`, 'Requerido, segundos >= 0');
        }
        if (a['end'] !== undefined) {
          if (!isNum(a['end'])) err(`${at}.end`, 'Debe ser un número si se indica');
          else if (isNum(a['start']) && a['end'] <= a['start']) {
            err(`${at}.end`, 'Debe ser posterior a start');
          }
        }
        if (duration !== undefined && isNum(a['start']) && a['start'] > duration) {
          warn(`${at}.start`, `Fuera de la duración declarada (${duration}s)`);
        }

        if (a['kind'] === 'trim') {
          trims++;
          if (a['end'] === undefined) err(`${at}.end`, 'Un recorte necesita end');
          if (live) err(at, 'Un recorte no tiene sentido en un directo');
        }
        if (a['kind'] === 'chapter' && !isStr(a['title'])) {
          err(`${at}.title`, 'Un capítulo necesita título: es texto para lectores de pantalla');
        }
      });
      if (trims > 1) err('annotations', `${trims} recortes. Solo puede haber uno`);
    }
  }

  // --- pistas de texto ----------------------------------------------------
  const textTracks = input['textTracks'];
  if (textTracks !== undefined) {
    if (!Array.isArray(textTracks)) {
      err('textTracks', 'Debe ser un array si se indica');
    } else {
      let defaults = 0;
      textTracks.forEach((t: unknown, i: number) => {
        const at = `textTracks[${i}]`;
        if (!isObj(t)) return err(at, 'Debe ser un objeto');
        if (!isStr(t['src'])) err(`${at}.src`, 'Requerido, cadena no vacía');
        if (!isStr(t['lang'])) err(`${at}.lang`, 'Requerido: sin idioma no se puede ofrecer la pista');
        if (t['default'] === true) defaults++;
      });
      if (defaults > 1) err('textTracks', 'Solo una pista puede ser la de por defecto');
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, manifest: input as unknown as Manifest, warnings };
}

/** Envoltorio que lanza. Cómodo cuando un manifiesto inválido no es recuperable. */
export function parseManifest(input: unknown): Manifest {
  const r = validateManifest(input);
  if (!r.ok) {
    const detail = r.errors.map((e) => `  ${e.path || '(raíz)'}: ${e.message}`).join('\n');
    throw new Error(`Manifiesto inválido:\n${detail}`);
  }
  return r.manifest;
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
