/**
 * Hand-written manifest validation, with no runtime dependency: messages carry
 * domain reasoning (why two audio tracks break iOS), and
 * `test/manifest-drift.test.ts` keeps types and checks from drifting apart.
 */
import type { Manifest } from './manifest.js';

export interface ValidationIssue {
  /** A path like `streams[1].sources[0].src`, to find the spot. */
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
  if (input['thumbnails'] !== undefined && !isStr(input['thumbnails'])) {
    err('thumbnails', 'Must be the URL of a WebVTT file if present');
  }
  if (input['duration'] !== undefined && (!isNum(input['duration']) || input['duration'] <= 0)) {
    err('duration', 'Must be a positive number if present');
  }
  const duration = isNum(input['duration']) ? input['duration'] : undefined;
  const live = input['live'] === true;

  const checkSources = (sources: unknown, at: string) => {
    if (!Array.isArray(sources) || sources.length === 0) {
      return err(at, 'Required, at least one source');
    }
    sources.forEach((src: unknown, j: number) => {
      const sat = `${at}[${j}]`;
      if (!isObj(src)) return err(sat, 'Must be an object');
      if (!isStr(src['src'])) err(`${sat}.src`, 'Required, non-empty string');
      if (!isStr(src['type'])) err(`${sat}.type`, 'Required: the MIME type decides the engine');
      if (src['height'] !== undefined && (!isNum(src['height']) || src['height'] <= 0)) {
        err(`${sat}.height`, 'Must be a positive number if present');
      }
    });
  };

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
      if (s['kind'] === 'audio' && s['audio'] === false) {
        err(at, 'An audio-only stream with `audio: false` contributes nothing');
      }

      checkSources(s['sources'], `${at}.sources`);
    });

    // A sign language interpreter goes over a video with the lecture's sound:
    // it never carries that sound, there is one, and there is something to interpret.
    const interpreters = streams.filter((s: unknown) => isObj(s) && s['role'] === 'interpreter');
    if (interpreters.length > 1) err('streams', `${interpreters.length} interpreter streams. There can only be one`);
    streams.forEach((s: unknown, i: number) => {
      if (isObj(s) && s['role'] === 'interpreter' && s['audio'] === true) {
        err(`streams[${i}].audio`, 'The interpreter stream cannot carry the sound: the lecture\'s stream does');
      }
    });
    if (interpreters.length > 0 && interpreters.length === streams.length) {
      err('streams', 'An interpreter stream needs a stream with the lecture to interpret');
    }

    // Exactly one audio stream: it is the clock master (S1), and iPhone cannot
    // play two. see docs/browser-quirks.md#ios-single-audio
    if (withAudio === 0) {
      err('streams', 'No stream carries audio: the synchronisation clock master is missing');
    } else if (withAudio > 1) {
      err('streams', `${withAudio} streams with audio. There must be exactly one: ` +
                     'playing two tracks at once does not work on iOS and leaves ' +
                     'the synchronisation without a master');
    }
  }

  // --- intro and outro ----------------------------------------------------
  // Rejected on live streams: the broadcast moves on during the intro, and
  // nothing guarantees it ends for the outro (S6 §7).
  for (const key of ['intro', 'outro'] as const) {
    const b = input[key];
    if (b === undefined) continue;
    if (live) err(key, key === 'intro'
      ? 'An intro is not allowed on a live stream: the broadcast keeps moving while it plays'
      : 'An outro is not allowed on a live stream: nothing guarantees the broadcast ends');
    if (!isObj(b)) {
      err(key, 'Must be an object with `sources` if present');
      continue;
    }
    checkSources(b['sources'], `${key}.sources`);
  }

  // --- annotations --------------------------------------------------------
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

  // --- text tracks --------------------------------------------------------
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

/** Throwing wrapper, for when an invalid manifest is not recoverable. */
export function parseManifest(input: unknown): Manifest {
  const r = validateManifest(input);
  if (!r.ok) {
    const detail = r.errors.map((e) => `  ${e.path || '(root)'}: ${e.message}`).join('\n');
    throw new Error(`Invalid manifest:\n${detail}`);
  }
  return r.manifest;
}
