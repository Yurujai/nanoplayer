// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, playerError, type EngineFactory, type Manifest } from '@nanoplayer/core';
import { type AnalyticsConfig, type AnalyticsEvent } from '../src/index.js';

const engines: EngineFactory[] = [{
  name: 'fake', canPlay: () => 'probably',
  create: () => ({ element: null, async attach() {}, destroy() {}, pause() {}, setVolume() {}, setMuted() {} }) as never,
}];

const lecture: Manifest = {
  id: 'thermo-1',
  streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: 'cam.mp4', type: 'video/mp4' }] }],
};

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function mount(config: AnalyticsConfig | false = {}) {
  const batches: AnalyticsEvent[][] = [];
  const send = vi.fn((events: AnalyticsEvent[]) => { batches.push(events); });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const player = create(host, {
    manifest: lecture, engines, registry: false,
    plugins: config === false ? {} : { analytics: { send, ...config } },
  });
  await player.resolve();
  await settle();
  let now = 0;
  let paused = true;
  vi.spyOn(player, 'currentTime', 'get').mockImplementation(() => now);
  vi.spyOn(player, 'duration', 'get').mockReturnValue(100);
  vi.spyOn(player, 'paused', 'get').mockImplementation(() => paused);
  const bus = player.bus;
  const drive = {
    play: () => { paused = false; bus.emit('play', { at: now }); },
    pause: () => { paused = true; bus.emit('pause', { at: now }); },
    to: (t: number) => { now = t; bus.emit('time', { current: t, duration: 100 }); },
    seek: (t: number) => { now = t; bus.emit('seek:end', { at: t }); },
  };
  const leave = () => window.dispatchEvent(new Event('pagehide'));
  const sent = () => batches.flat();
  return { player, send, drive, leave, sent };
}

describe('analytics plugin', () => {
  it('stays silent without configuration: it has nowhere to send', async () => {
    const { drive, leave, send } = await mount(false);
    drive.play();
    leave();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends what is worth counting, not the per-second noise', async () => {
    const { drive, leave, sent } = await mount();
    drive.play();
    for (let t = 1; t <= 10; t++) drive.to(t);
    drive.pause();
    leave();
    const types = sent().map((e) => e.type);
    expect(types).toContain('play');
    expect(types).toContain('pause');
    expect(types).not.toContain('time');
    const pause = sent().find((e) => e.type === 'pause')!;
    expect(pause).toMatchObject({ video: 'thermo-1', position: 10, duration: 100 });
    expect(pause.session).toMatch(/.+/);
  });

  it('marks the milestones played through, not those jumped over', async () => {
    const { player, drive, leave, sent } = await mount();
    drive.play();
    drive.to(24); drive.to(25.5); drive.to(26);
    drive.seek(74);
    drive.to(75.5);
    player.bus.emit('ended', { at: 100 });
    leave();
    const milestones = sent().filter((e) => e.type === 'milestone').map((e) => e.data['percent']);
    expect(milestones, '50 was skipped').toEqual([25, 75, 100]);
  });

  it('closes with the time really watched, seeks and pauses not counted', async () => {
    const { drive, leave, sent } = await mount();
    drive.play();
    for (let t = 1; t <= 10; t++) drive.to(t);
    drive.seek(60);
    drive.to(61); drive.to(62);
    drive.pause();
    drive.to(63);
    leave();
    const end = sent().find((e) => e.type === 'session:end')!;
    expect(end.data['watched'], '0–10 and 60–62').toBe(12);
  });

  it('batches, and flushes on its own every few seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { drive, send } = await mount({ flushEvery: 5 });
    drive.play();
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a chosen list replaces the default one', async () => {
    const { drive, leave, sent } = await mount({ events: ['pause'] });
    drive.play();
    drive.pause();
    leave();
    expect(sent().map((e) => e.type)).toEqual(['pause', 'session:end']);
  });

  it('errors go as their code, without the cause, and with the context', async () => {
    const { player, leave, sent } = await mount({ context: { course: 'PHY-101' } });
    player.bus.emit('error', { error: playerError('media/network', 'lost', new Error('secret detail')) });
    leave();
    const error = sent().find((e) => e.type === 'error')!;
    expect(error.data).toEqual({ error: { code: 'media/network', message: 'lost', retryable: true } });
    expect(error.context).toEqual({ course: 'PHY-101' });
  });

  it('a sample of zero reports no session', async () => {
    const { drive, leave, send } = await mount({ sample: 0 });
    drive.play();
    leave();
    expect(send).not.toHaveBeenCalled();
  });

  it('to an endpoint, the last batch goes by beacon as the page leaves', async () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const player = create(host, {
      manifest: lecture, engines, registry: false,
      plugins: { analytics: { endpoint: 'https://stats.example/collect' } },
    });
    await player.resolve();
    await settle();
    player.bus.emit('play', { at: 0 });
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledWith('https://stats.example/collect', expect.any(Blob));
    const blob = (beacon.mock.calls[0] as unknown as [string, Blob])[1];
    expect(blob.type, 'CORS-safelisted, or it is refused cross-origin').toBe('text/plain;charset=utf-8');
    expect(JSON.parse(await blob.text())[0].type).toBe('play');
  });

  it('a beacon that throws falls back to fetch', async () => {
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: () => { throw new TypeError('refused'); } });
    const fetchMock = vi.fn(async () => new Response(''));
    vi.stubGlobal('fetch', fetchMock);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const player = create(host, {
      manifest: lecture, engines, registry: false,
      plugins: { analytics: { endpoint: 'https://stats.example/collect' } },
    });
    await player.resolve();
    await settle();
    player.bus.emit('play', { at: 0 });
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledWith('https://stats.example/collect', expect.objectContaining({ keepalive: true }));
  });
});
