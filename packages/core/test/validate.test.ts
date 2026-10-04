import { describe, expect, it } from 'vitest';
import { masterStream, slaveStreams, trimOf } from '../src/manifest-queries.js';
import { parseManifest, validateManifest } from '../src/validate.js';

/** A valid dual-stream manifest, with one-off overrides. */
const dual = (over: Record<string, unknown> = {}) => ({
  id: 'lecture-1',
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
  it('accepts a well-formed dual-stream', () => {
    const r = validateManifest(dual());
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('accepts a single stream', () => {
    const r = validateManifest({
      id: 'x',
      streams: [{ id: 'a', role: 'presenter', audio: true,
                  sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects anything that is not an object', () => {
    for (const bad of [null, 42, 'x', []]) {
      expect(validateManifest(bad).ok).toBe(false);
    }
  });

  it('takes thumbnails as the URL of a WebVTT file', () => {
    expect(validateManifest(dual({ thumbnails: 'thumbs.vtt' })).ok).toBe(true);
    expect(pathsOf(validateManifest(dual({ thumbnails: '' })))).toContain('thumbnails');
    expect(pathsOf(validateManifest(dual({ thumbnails: { src: 'thumbs.vtt' } })))).toContain('thumbnails');
  });

  it('requires an id and at least one stream', () => {
    expect(pathsOf(validateManifest({}))).toEqual(
      expect.arrayContaining(['id', 'streams']),
    );
    expect(pathsOf(validateManifest({ id: 'x', streams: [] })))
      .toContain('streams');
  });

  it('rejects two streams with audio', () => {
    const m = dual();
    (m.streams[1] as { audio: boolean }).audio = true;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(pathsOf(r)).toContain('streams');
    if (!r.ok) expect(r.errors.some((e) => /iOS/.test(e.message))).toBe(true);
  });

  it('rejects no stream carrying audio', () => {
    const m = dual();
    (m.streams[0] as { audio: boolean }).audio = false;
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => /master/.test(e.message))).toBe(true);
  });

  it('rejects duplicate stream ids', () => {
    const m = dual();
    (m.streams[1] as { id: string }).id = 'cam';
    expect(pathsOf(validateManifest(m))).toContain('streams[1].id');
  });

  it('requires each source\'s MIME type, which picks the engine', () => {
    const m = dual();
    (m.streams[0] as { sources: unknown[] }).sources = [{ src: 'a.mp4' }];
    expect(pathsOf(validateManifest(m))).toContain('streams[0].sources[0].type');
  });

  const bumper = (src: string) => ({ sources: [{ src, type: 'video/mp4' }] });

  it('accepts intro and outro separately, together or neither', () => {
    for (const over of [
      {},
      { intro: bumper('intro.mp4') },
      { outro: bumper('outro.mp4') },
      { intro: bumper('intro.mp4'), outro: bumper('outro.mp4') },
    ]) {
      const r = validateManifest(dual(over));
      expect(r.ok, JSON.stringify(over)).toBe(true);
      expect(r.warnings).toEqual([]);
    }
  });

  it('requires sources in the intro and outro', () => {
    expect(pathsOf(validateManifest(dual({ intro: {} })))).toContain('intro.sources');
    expect(pathsOf(validateManifest(dual({ outro: { sources: [] } })))).toContain('outro.sources');
  });

  it('validates intro and outro sources like a stream\'s', () => {
    const r = validateManifest(dual({
      intro: { sources: [{ src: 'intro.mp4' }] },
      outro: { sources: [{ type: 'video/mp4', height: -1 }] },
    }));
    expect(pathsOf(r)).toEqual(expect.arrayContaining([
      'intro.sources[0].type', 'outro.sources[0].src', 'outro.sources[0].height',
    ]));
  });

  it('rejects intro and outro in a live stream', () => {
    expect(pathsOf(validateManifest(dual({ live: true, intro: bumper('intro.mp4') }))))
      .toEqual(['intro']);
    expect(pathsOf(validateManifest(dual({ live: true, outro: bumper('outro.mp4') }))))
      .toEqual(['outro']);
  });

  it('rejects an intro or outro that is not an object', () => {
    const r = validateManifest(dual({ intro: 'intro.mp4', outro: [] }));
    expect(pathsOf(r)).toEqual(expect.arrayContaining(['intro', 'outro']));
  });

  it('accepts trim, chapter and interactive content together', () => {
    const r = validateManifest(dual({
      annotations: [
        { kind: 'trim', start: 30, end: 3400 },
        { kind: 'chapter', start: 60, title: 'Introduction' },
        { kind: 'h5p', start: 120, data: { library: 'H5P.Blanks 1.14' } },
      ],
    }));
    expect(r.ok).toBe(true);
  });

  it('rejects a trim with no end or reversed', () => {
    expect(pathsOf(validateManifest(dual({ annotations: [{ kind: 'trim', start: 30 }] }))))
      .toContain('annotations[0].end');
    expect(pathsOf(validateManifest(dual({ annotations: [{ kind: 'trim', start: 90, end: 30 }] }))))
      .toContain('annotations[0].end');
  });

  it('rejects more than one trim', () => {
    const r = validateManifest(dual({
      annotations: [
        { kind: 'trim', start: 10, end: 20 },
        { kind: 'trim', start: 30, end: 40 },
      ],
    }));
    expect(pathsOf(r)).toContain('annotations');
  });

  it('rejects trimming a live stream', () => {
    const r = validateManifest(dual({
      live: true, annotations: [{ kind: 'trim', start: 10, end: 20 }],
    }));
    expect(r.ok).toBe(false);
  });

  it('requires a chapter title, since it is accessible text', () => {
    expect(pathsOf(validateManifest(dual({ annotations: [{ kind: 'chapter', start: 5 }] }))))
      .toContain('annotations[0].title');
  });

  it('warns, without failing, about an annotation past the duration', () => {
    const r = validateManifest(dual({ annotations: [{ kind: 'chapter', start: 9999, title: 'x' }] }));
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.path)).toContain('annotations[0].start');
  });

  it('lets an unknown kind through: its plugin will handle it', () => {
    const r = validateManifest(dual({
      annotations: [{ kind: 'poll', start: 10, data: {} }],
    }));
    expect(r.ok).toBe(true);
  });

  it('requires src and language in text tracks', () => {
    const r = validateManifest(dual({ textTracks: [{ src: 'a.vtt' }] }));
    expect(pathsOf(r)).toContain('textTracks[0].lang');
  });

  it('rejects two tracks marked as default', () => {
    const r = validateManifest(dual({
      textTracks: [
        { src: 'es.vtt', lang: 'es', default: true },
        { src: 'en.vtt', lang: 'en', default: true },
      ],
    }));
    expect(pathsOf(r)).toContain('textTracks');
  });

  it('collects every error instead of stopping at the first', () => {
    const r = validateManifest({ streams: [{ role: 'presenter' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(2);
  });
});

describe('helpers', () => {
  it('parseManifest throws with the paths in the message', () => {
    expect(() => parseManifest({})).toThrow(/streams/);
  });

  it('parseManifest returns the manifest if valid', () => {
    expect(parseManifest(dual()).id).toBe('lecture-1');
  });

  it('splits master and slaves', () => {
    const m = parseManifest(dual());
    expect(masterStream(m).id).toBe('cam');
    expect(slaveStreams(m).map((s) => s.id)).toEqual(['slides']);
  });

  it('extracts the trim, or null if none', () => {
    expect(trimOf(parseManifest(dual()))).toBeNull();
    const m = parseManifest(dual({ annotations: [{ kind: 'trim', start: 30, end: 90 }] }));
    expect(trimOf(m)).toEqual({ start: 30, end: 90 });
  });
});
