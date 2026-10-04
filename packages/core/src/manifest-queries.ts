import type { Annotation, Manifest, Stream } from './manifest.js';

/** Audio-only is inferred from the MIME type unless the stream declares `kind`. */
export function isAudioOnly(stream: Stream): boolean {
  if (stream.kind !== undefined) return stream.kind === 'audio';
  return stream.sources.length > 0
    && stream.sources.every((s) => s.type.toLowerCase().startsWith('audio/'));
}

export function isAudioOnlyManifest(m: Manifest): boolean {
  return m.streams.every(isAudioOnly);
}

/** The stream that carries the audio and drives the sync clock. */
export function masterStream(m: Manifest): Stream {
  const s = m.streams.find((x) => x.audio);
  if (!s) throw new Error('The manifest has no master stream');
  return s;
}

export function slaveStreams(m: Manifest): Stream[] {
  return m.streams.filter((s) => !s.audio);
}

/** The role of a sign language interpreter's stream. */
export const INTERPRETER_ROLE = 'interpreter';

export function isInterpreter(stream: Stream): boolean {
  return stream.role === INTERPRETER_ROLE;
}

/**
 * The streams the layouts arrange: all but the interpreter, which goes over
 * the picture. One video and an interpreter is not a "side by side" choice.
 */
export function mainStreams(m: Manifest): Stream[] {
  return m.streams.filter((s) => !isInterpreter(s));
}

export function trimOf(m: Manifest): { start: number; end: number } | null {
  const t = m.annotations?.find((a): a is Extract<Annotation, { kind: 'trim' }> => a.kind === 'trim');
  return t ? { start: t.start, end: t.end } : null;
}
