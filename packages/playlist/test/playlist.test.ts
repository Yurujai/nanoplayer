// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create, type EngineFactory, type Manifest } from '@nanoplayer/core';
import { attachControls } from '@nanoplayer/ui';
import { createPlaylist } from '../src/index.js';

const engines: EngineFactory[] = [{
  name: 'fake', canPlay: () => 'probably',
  create: () => ({ element: null, async attach() {}, destroy() {}, pause() {}, setVolume() {}, setMuted() {} }) as never,
}];

const lecture = (n: number): Manifest => ({
  id: `lecture-${n}`, title: `Lecture ${n}`,
  streams: [{ id: 'cam', role: 'presenter', audio: true, sources: [{ src: `${n}.mp4`, type: 'video/mp4' }] }],
});

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="player"></div>';
  host = document.getElementById('player')!;
});

function playlist(options: Partial<Parameters<typeof createPlaylist>[1]> = {}) {
  const made: ReturnType<typeof create>[] = [];
  const list = createPlaylist('#player', {
    items: [lecture(1), lecture(2), { manifest: '/api/video/3', title: 'Lecture three' }],
    create: (el, manifest) => {
      const p = create(el, { manifest: manifest as never, engines, registry: false, lang: 'en' });
      vi.spyOn(p, 'play').mockResolvedValue();
      attachControls(p, { poster: false });
      made.push(p);
      return p;
    },
    ...options,
  });
  return { list, made };
}

describe('playlist', () => {
  it('starts on the first item, without playing it', () => {
    const { list, made } = playlist();
    expect(list.index).toBe(0);
    expect(made).toHaveLength(1);
    expect(made[0]!.play).not.toHaveBeenCalled();
  });

  it('next replaces the player and plays, leaving no trace of the old one', () => {
    const { list, made } = playlist();
    list.next();
    expect(list.index).toBe(1);
    expect(made).toHaveLength(2);
    expect(made[0]!.state).toBe('destroyed');
    expect(host.querySelectorAll('.np__bar')).toHaveLength(1);
    expect(made[1]!.play).toHaveBeenCalled();
  });

  it('moves on by itself when one ends, and stops at the last', () => {
    const { list, made } = playlist();
    made[0]!.bus.emit('ended', { at: 60 });
    expect(list.index).toBe(1);
    list.go(2);
    made[2]!.bus.emit('ended', { at: 60 });
    expect(list.index).toBe(2);
  });

  it('loop goes from the last back to the first', () => {
    const { list } = playlist({ loop: true });
    list.go(2);
    list.next();
    expect(list.index).toBe(0);
    list.previous();
    expect(list.index).toBe(2);
  });

  it('without autoAdvance the end is the end', () => {
    const { list, made } = playlist({ autoAdvance: false });
    made[0]!.bus.emit('ended', { at: 60 });
    expect(list.index).toBe(0);
  });

  it('lists every item by its title, in the settings menu', () => {
    playlist();
    const menu = host.querySelector('.np__btn--settings') as HTMLButtonElement;
    menu.click();
    const row = [...host.querySelectorAll('.np__menu [role="menuitem"]')]
      .find((el) => el.getAttribute('aria-label')?.startsWith('Playlist'));
    expect(row?.getAttribute('aria-label')).toBe('Playlist: 1. Lecture 1');
    (row as HTMLElement).click();
    const options = [...host.querySelectorAll('[role="menuitemradio"]')].map((o) => o.textContent?.replace('✓', ''));
    expect(options).toEqual(['1. Lecture 1', '2. Lecture 2', '3. Lecture three']);
  });

  it('keeps the viewer\'s focus in the player when the bar is replaced', () => {
    const { list } = playlist();
    host.focus();
    list.next();
    expect(host.contains(document.activeElement)).toBe(true);
  });

  it('says so when there is nothing to play', () => {
    expect(() => createPlaylist('#player', { items: [], create: () => { throw new Error('unused'); } }))
      .toThrow('at least one item');
  });
});
