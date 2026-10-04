/**
 * The site's manifest reference shows these files as the complete example.
 * Adding a field to the types breaks this until the example shows it, so the
 * documentation cannot fall behind.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Manifest, Source, Stream, TextTrackDef } from '../src/manifest.js';
import { validateManifest } from '../src/validate.js';

const read = (name: string): Record<string, unknown> => JSON.parse(readFileSync(
  new URL(`../../../demo/public/manifest/${name}`, import.meta.url), 'utf8'));

const examples = [read('example.json'), read('live.json')];

const MANIFEST: Record<keyof Manifest, true> = {
  id: true, title: true, poster: true, duration: true, streams: true, intro: true, outro: true,
  annotations: true, textTracks: true, thumbnails: true, live: true, liveWaitingImage: true,
};
const STREAM: Record<keyof Stream, true> = {
  id: true, role: true, label: true, kind: true, audio: true, sources: true, poster: true,
};
const SOURCE: Record<keyof Source, true> = { src: true, type: true, height: true, label: true };
const TEXT_TRACK: Record<keyof TextTrackDef, true> = {
  src: true, lang: true, label: true, kind: true, default: true,
};

const streams = examples.flatMap((m) => m['streams'] as Record<string, unknown>[]);
const sources = streams.flatMap((s) => s['sources'] as Record<string, unknown>[]);
const tracks = examples.flatMap((m) => (m['textTracks'] ?? []) as Record<string, unknown>[]);
const used = (objects: Record<string, unknown>[]) => new Set(objects.flatMap((o) => Object.keys(o)));

describe('manifest examples on the site', () => {
  it('are valid, without a warning', () => {
    for (const example of examples) {
      const r = validateManifest(example);
      expect(r.ok, JSON.stringify(r.ok ? [] : r.errors)).toBe(true);
      expect(r.warnings).toEqual([]);
    }
  });

  it('between them show every field', () => {
    const missing = (fields: object, objects: Record<string, unknown>[]) =>
      Object.keys(fields).filter((f) => !used(objects).has(f));
    expect(missing(MANIFEST, examples), 'manifest').toEqual([]);
    expect(missing(STREAM, streams), 'stream').toEqual([]);
    expect(missing(SOURCE, sources), 'source').toEqual([]);
    expect(missing(TEXT_TRACK, tracks), 'text track').toEqual([]);
  });

  it('show every annotation kind a plugin consumes', () => {
    const kinds = new Set(examples.flatMap((m) =>
      ((m['annotations'] ?? []) as Array<{ kind: string }>).map((a) => a.kind)));
    expect([...kinds].sort()).toEqual(['chapter', 'h5p', 'trim']);
  });
});
