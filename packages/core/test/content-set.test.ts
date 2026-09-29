// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentSet } from '../src/content-set.js';
import type { CoreEvents } from '../src/core-events.js';
import type { EngineFactory } from '../src/engine.js';
import { EventBus } from '../src/events.js';
import type { Stream } from '../src/manifest.js';

const stream = (id: string, audio = false): Stream => ({
  id, role: audio ? 'presenter' : 'presentation', audio,
  sources: [{ src: `${id}.mp4`, type: 'video/mp4' }],
});

function fakeFactory(failing: string[] = []) {
  const order: string[] = [];
  const factory: EngineFactory = {
    name: 'fake', canPlay: () => 'probably',
    create: () => {
      let id = '';
      return {
        async attach(_c: HTMLElement, s: Stream) { id = s.id; if (failing.includes(s.id)) throw new Error('no'); },
        async play() { order.push(id); },
        pause: vi.fn(), destroy: vi.fn(),
      } as never;
    },
  };
  return { factory, order };
}

let container: HTMLElement;
beforeEach(() => { document.body.innerHTML = ''; container = document.createElement('div'); });

describe('ContentSet', () => {
  it('plays the master before the others', async () => {
    const { factory, order } = fakeFactory();
    const c = new ContentSet({ container, engines: [factory], bus: new EventBus<CoreEvents>() });
    await c.attach(stream('slides'), {}, false);
    await c.attach(stream('cam', true), {}, false);
    await c.play('cam');
    expect(order).toEqual(['cam', 'slides']);
  });

  it('removes a failed stream\'s box unless asked to keep it', async () => {
    const { factory } = fakeFactory(['cam']);
    const c = new ContentSet({ container, engines: [factory], bus: new EventBus<CoreEvents>() });
    await expect(c.attach(stream('cam', true), {}, false)).rejects.toThrow();
    expect(container.querySelector('[data-stream]')).toBeNull();
    await expect(c.attach(stream('cam', true), {}, true)).rejects.toThrow();
    expect(container.querySelector('[data-stream="cam"]'), 'live, the slot for the notice').not.toBeNull();
  });

  it('release removes engines and boxes', async () => {
    const { factory } = fakeFactory();
    const c = new ContentSet({ container, engines: [factory], bus: new EventBus<CoreEvents>() });
    await c.attach(stream('cam', true), {}, false);
    c.release();
    expect(c.engine('cam')).toBeNull();
    expect(container.children).toHaveLength(0);
  });
});
