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

function factoria(fallan: string[] = []) {
  const orden: string[] = [];
  const factory: EngineFactory = {
    name: 'falso', canPlay: () => 'probably',
    create: () => {
      let id = '';
      return {
        async attach(_c: HTMLElement, s: Stream) { id = s.id; if (fallan.includes(s.id)) throw new Error('no'); },
        async play() { orden.push(id); },
        pause: vi.fn(), destroy: vi.fn(),
      } as never;
    },
  };
  return { factory, orden };
}

let container: HTMLElement;
beforeEach(() => { document.body.innerHTML = ''; container = document.createElement('div'); });

describe('ContentSet', () => {
  it('reproduce el maestro antes que los demás', async () => {
    const { factory, orden } = factoria();
    const c = new ContentSet({ container, engines: [factory], bus: new EventBus<CoreEvents>() });
    await c.attach(stream('slides'), {}, false);
    await c.attach(stream('cam', true), {}, false);
    await c.play('cam');
    expect(orden).toEqual(['cam', 'slides']);
  });

  it('si un flujo falla, su caja se va salvo que se pida conservarla', async () => {
    const { factory } = factoria(['cam']);
    const c = new ContentSet({ container, engines: [factory], bus: new EventBus<CoreEvents>() });
    await expect(c.attach(stream('cam', true), {}, false)).rejects.toThrow();
    expect(container.querySelector('[data-stream]')).toBeNull();
    await expect(c.attach(stream('cam', true), {}, true)).rejects.toThrow();
    expect(container.querySelector('[data-stream="cam"]'), 'en directo, el hueco del aviso').not.toBeNull();
  });

  it('soltar quita motores y cajas', async () => {
    const { factory } = factoria();
    const c = new ContentSet({ container, engines: [factory], bus: new EventBus<CoreEvents>() });
    await c.attach(stream('cam', true), {}, false);
    c.release();
    expect(c.engine('cam')).toBeNull();
    expect(container.children).toHaveLength(0);
  });
});
