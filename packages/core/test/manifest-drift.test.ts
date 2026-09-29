/**
 * Drift guard between the types and the validator. `Record<keyof X, ...>` makes
 * adding a field to a type break compilation until it is declared here as
 * validated or free, so the decision is always made on purpose.
 */
import { describe, expect, it } from 'vitest';
import type { Bumper, Manifest, Source, Stream, TextTrackDef } from '../src/manifest.js';
import { validateManifest } from '../src/validate.js';

type Status = 'validated' | 'free';

const MANIFEST: Record<keyof Manifest, Status> = {
  id: 'validated',
  streams: 'validated',
  intro: 'validated',
  outro: 'validated',
  duration: 'validated',
  annotations: 'validated',
  textTracks: 'validated',
  live: 'validated',
  liveWaitingImage: 'validated',
  title: 'free',   // optional text: any string will do
  poster: 'free',  // optional URL; if it fails, it degrades to black
};

const STREAM: Record<keyof Stream, Status> = {
  id: 'validated',
  role: 'validated',
  audio: 'validated',
  sources: 'validated',
  kind: 'validated',
  label: 'free',
  poster: 'free',
};

const SOURCE: Record<keyof Source, Status> = {
  src: 'validated',
  type: 'validated',
  height: 'validated',
  label: 'free',
};

const BUMPER: Record<keyof Bumper, Status> = {
  sources: 'validated',
};

const TEXT_TRACK: Record<keyof TextTrackDef, Status> = {
  src: 'validated',
  lang: 'validated',
  default: 'validated',
  kind: 'free',
  label: 'free',
};

describe('drift between types and validator', () => {
  it('every declared field has a decision', () => {
    for (const map of [MANIFEST, STREAM, SOURCE, BUMPER, TEXT_TRACK]) {
      for (const [field, status] of Object.entries(map)) {
        expect(status, `field "${field}"`).toMatch(/^(validated|free)$/);
      }
    }
  });

  it('"free" fields do not block validating a manifest', () => {
    // Warns if one became required without updating the map.
    const r = validateManifest({
      id: 'x',
      streams: [{
        id: 'a', role: 'presenter', audio: true,
        sources: [{ src: 'a.mp4', type: 'video/mp4' }],
      }],
    });
    expect(r.ok).toBe(true);
  });

  it('a manifest with EVERY field is still valid', () => {
    // `satisfies` keeps this object in step with the types.
    const complete = {
      id: 'lecture-1',
      title: 'Introduction to thermodynamics',
      poster: 'poster.jpg',
      duration: 3600,
      live: false,
      streams: [
        { id: 'cam', role: 'presenter', label: 'Speaker', audio: true,
          poster: 'cam.jpg',
          sources: [{ src: 'cam.m3u8', type: 'application/vnd.apple.mpegurl',
                      height: 1080, label: '1080p' }] },
        { id: 'slides', role: 'presentation', label: 'Slides', audio: false,
          sources: [{ src: 'slides.mp4', type: 'video/mp4' }] },
      ],
      intro: { sources: [{ src: 'intro.mp4', type: 'video/mp4' }] },
      outro: { sources: [{ src: 'outro.mp4', type: 'video/mp4' }] },
      annotations: [
        { kind: 'trim', start: 12, end: 3500 },
        { kind: 'chapter', start: 60, end: 900, title: 'First law' },
        { kind: 'h5p', start: 300, end: 330, data: { library: 'H5P.Blanks 1.14' } },
      ],
      textTracks: [
        { src: 'es.vtt', lang: 'es', label: 'Español', kind: 'subtitles', default: true },
        { src: 'en.vtt', lang: 'en', label: 'English', kind: 'subtitles' },
      ],
    } satisfies Manifest;

    const r = validateManifest(complete);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});
