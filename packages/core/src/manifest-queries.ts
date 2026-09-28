/**
 * Consultas sobre un manifiesto ya validado: qué stream manda, cuál es solo
 * audio, qué recorte trae. Van aparte de la validación porque no validan nada.
 */
import type { Annotation, Manifest, Stream } from './manifest.js';

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
