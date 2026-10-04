// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { Player, strings } from '@nanoplayer/core';
import { VolumeControl } from '../src/volume-control.js';
import '../src/strings.js';

const t = strings.translator('en');
const MANIFEST = {
  id: 'x', streams: [{ id: 'a', role: 'presenter', audio: true, sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
};

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

const mount = (options: Record<string, unknown> = {}) => {
  const player = new Player({ container: host, manifest: MANIFEST, ...options });
  const control = new VolumeControl(document, player, t);
  host.appendChild(control.element);
  const slider = control.element.querySelector('input')!;
  const button = control.element.querySelector('button')!;
  return { player, control, slider, button };
};

describe('volume control', () => {
  it('shows the fill at full volume from the start, not only once moved', () => {
    const { slider } = mount();
    expect(slider.value).toBe('1');
    expect(slider.style.getPropertyValue('--np-progress')).toBe('100%');
    expect(slider.getAttribute('aria-valuetext')).toBe('100%');
  });

  it('a muted start shows as muted', () => {
    const { slider, button } = mount({ muted: true });
    expect(slider.value).toBe('0');
    expect(button.getAttribute('aria-label')).toBe('Unmute');
  });

  it('follows changes made elsewhere, as autoplay muting the player', () => {
    const { player, slider, button } = mount();
    player.setMuted(true);
    expect(slider.value).toBe('0');
    expect(button.getAttribute('aria-label')).toBe('Unmute');
    player.setMuted(false);
    player.setVolume(0.4);
    expect(slider.value).toBe('0.4');
    expect(slider.style.getPropertyValue('--np-progress')).toBe('40%');
  });

  it('unmuting goes back to the volume there was', () => {
    const { player, control } = mount();
    player.setVolume(0.6);
    player.setMuted(true);
    control.toggleMute();
    expect(player.muted).toBe(false);
    expect(player.volume).toBe(0.6);
  });
});
