// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create, type EngineFactory, type Manifest, type Player } from '@nanoplayer/core';
import { PlayedSegments, type Statement, type XapiConfig } from '../src/index.js';

const engines: EngineFactory[] = [{
  name: 'fake', canPlay: () => 'probably',
  create: () => ({ element: null, async attach() {}, destroy() {}, pause() {}, setVolume() {}, setMuted() {} }) as never,
}];

const lecture: Manifest = {
  id: 'thermo-1',
  title: 'Thermodynamics',
  streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
};

const ext = (name: string) => `https://w3id.org/xapi/video/extensions/${name}`;
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { document.body.innerHTML = ''; });

async function mount(config: XapiConfig | false = {}) {
  const statements: Statement[] = [];
  const send = vi.fn((s: Statement) => { statements.push(s); });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const player = create(host, {
    manifest: lecture, engines, registry: false, lang: 'en',
    plugins: config === false ? {} : { xapi: { send, ...config } },
  });
  await player.resolve();
  await settle();
  let now = 0;
  vi.spyOn(player, 'currentTime', 'get').mockImplementation(() => now);
  vi.spyOn(player, 'duration', 'get').mockReturnValue(100);
  const bus = player.bus;
  const drive = {
    play: () => bus.emit('play', { at: now }),
    pause: () => bus.emit('pause', { at: now }),
    to: (t: number) => { now = t; bus.emit('time', { current: t, duration: 100 }); },
    seek: (to: number) => { const from = now; bus.emit('seek:start', { from, to }); now = to; },
  };
  const verbs = () => statements.map((s) => (s['verb'] as { display: { 'en-US': string } }).display['en-US']);
  const last = (verb: string) => [...statements].reverse()
    .find((s) => (s['verb'] as { display: { 'en-US': string } }).display['en-US'] === verb) as
    { result: { extensions: Record<string, unknown>; completion?: boolean; duration?: string };
      object: { id: string; definition: Record<string, unknown> };
      context: { extensions: Record<string, unknown>; contextActivities: unknown } } | undefined;
  return { player, statements, send, drive, verbs, last };
}

describe('xAPI plugin', () => {
  it('stays silent without configuration: it has nowhere to report', async () => {
    const { drive, send } = await mount(false);
    drive.play();
    expect(send).not.toHaveBeenCalled();
  });

  it('reports play and pause, with the video profile\'s activity and context', async () => {
    const { drive, verbs, last } = await mount();
    drive.play();
    drive.to(30);
    drive.pause();
    expect(verbs()).toEqual(['initialized', 'played', 'paused']);
    const paused = last('paused')!;
    expect(paused.object.id).toBe('urn:nanoplayer:video:thermo-1');
    expect(paused.object.definition).toMatchObject({
      type: 'https://w3id.org/xapi/video/activity-type/video', name: { en: 'Thermodynamics' },
    });
    expect(paused.result.extensions).toEqual({
      [ext('time')]: 30, [ext('progress')]: 0.3, [ext('played-segments')]: '0[.]30',
    });
    expect(paused.context.contextActivities).toEqual({ category: [{ id: 'https://w3id.org/xapi/video' }] });
    expect(paused.context.extensions[ext('length')]).toBe(100);
  });

  it('a seek closes one segment and opens another; skipped time is not progress', async () => {
    const { drive, last } = await mount();
    drive.play();
    drive.to(10);
    drive.seek(80);
    drive.to(90);
    drive.pause();
    expect(last('seeked')!.result.extensions).toEqual({ [ext('time-from')]: 10, [ext('time-to')]: 80 });
    expect(last('paused')!.result.extensions).toMatchObject({
      [ext('played-segments')]: '0[.]10[,]80[.]90', [ext('progress')]: 0.2,
    });
  });

  it('completes once enough has really been watched, and only once', async () => {
    const { drive, verbs, last } = await mount({ completionThreshold: 0.5 });
    drive.play();
    drive.to(49);
    expect(verbs()).not.toContain('completed');
    drive.to(51);
    drive.to(60);
    expect(verbs().filter((v) => v === 'completed')).toHaveLength(1);
    expect(last('completed')!.result).toMatchObject({ completion: true, duration: 'PT100S' });
  });

  it('jumping to the end does not complete it', async () => {
    const { player, drive, verbs } = await mount();
    drive.play();
    drive.to(5);
    drive.seek(99);
    drive.to(100);
    player.bus.emit('ended', { at: 100 });
    expect(verbs()).not.toContain('completed');
  });

  it('says it terminated when the page goes away', async () => {
    const { drive, verbs, last } = await mount();
    drive.play();
    drive.to(20);
    window.dispatchEvent(new Event('pagehide'));
    expect(verbs().at(-1)).toBe('terminated');
    expect(last('terminated')!.result.extensions[ext('played-segments')]).toBe('0[.]20');
  });

  it('the intro is not the lecture', async () => {
    const { player, drive, send } = await mount();
    vi.spyOn(player, 'phase', 'get').mockReturnValue('intro');
    drive.play();
    expect(send).not.toHaveBeenCalled();
  });

  it('posts to an LRS endpoint with the xAPI headers, and its failures stay quiet', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('LRS down'); });
    vi.stubGlobal('fetch', fetchMock);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const player: Player = create(host, {
      manifest: lecture, engines, registry: false,
      plugins: { xapi: { endpoint: 'https://lrs.example/xapi/', auth: 'Basic abc', actor: { mbox: 'mailto:s@example.org' } } },
    });
    await player.resolve();
    await settle();
    player.bus.emit('play', { at: 0 });
    await settle();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://lrs.example/xapi/statements');
    expect(init.keepalive).toBe(true);
    expect(init.headers).toMatchObject({ 'X-Experience-API-Version': '1.0.3', Authorization: 'Basic abc' });
    expect(JSON.parse(init.body as string).actor).toEqual({ mbox: 'mailto:s@example.org' });
    vi.unstubAllGlobals();
  });
});

describe('played segments', () => {
  it('counts each second once, however often it was watched', () => {
    const s = new PlayedSegments();
    s.start(0); s.end(30);
    s.start(10); s.end(40);
    expect(s.progress(100)).toBe(0.4);
    expect(s.format()).toBe('0[.]30[,]10[.]40');
  });
});
