// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '../src/manifest.js';
import { Player } from '../src/player.js';
import {
  PluginRegistry, topoSort, type PluginManifest,
} from '../src/plugins.js';

const MANIFIESTO = {
  id: 'x', duration: 60,
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: 'a.mp4', type: 'video/mp4' }] }],
  textTracks: [{ src: 'es.vtt', lang: 'es' }],
} as unknown as Manifest;

let player: Player;

/** Plugin de mentira que registra cuándo se activa. */
const plug = (
  id: string,
  extra: Partial<PluginManifest> = {},
  traza: string[] = [],
): PluginManifest => ({
  id,
  load: () => ({
    activate: () => { traza.push(`activar:${id}`); },
    deactivate: () => { traza.push(`desactivar:${id}`); },
  }),
  ...extra,
});

beforeEach(() => {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  document.body.appendChild(container);
  player = new Player({ container, manifest: MANIFIESTO as never });
});

describe('topoSort', () => {
  it('coloca las dependencias antes que quien las usa', () => {
    const orden = topoSort([
      plug('b', { dependsOn: ['a'] }),
      plug('a'),
      plug('c', { dependsOn: ['b'] }),
    ]).map((m) => m.id);
    expect(orden).toEqual(['a', 'b', 'c']);
  });

  it('denuncia los ciclos con el camino completo', () => {
    // Nada de resolución implícita por orden de carga: es donde estos sistemas
    // se pudren, porque funcionan hasta que alguien reordena dos imports.
    expect(() => topoSort([
      plug('a', { dependsOn: ['b'] }),
      plug('b', { dependsOn: ['a'] }),
    ])).toThrow(/Ciclo de dependencias/);
  });

  it('denuncia una dependencia que no existe', () => {
    expect(() => topoSort([plug('a', { dependsOn: ['fantasma'] })]))
      .toThrow(/depende de "fantasma"/);
  });

  it('acepta dependencias compartidas sin duplicar', () => {
    const orden = topoSort([
      plug('b', { dependsOn: ['base'] }),
      plug('c', { dependsOn: ['base'] }),
      plug('base'),
    ]).map((m) => m.id);
    expect(orden[0]).toBe('base');
    expect(orden).toHaveLength(3);
  });
});

describe('registro y activación', () => {
  it('el plugin se auto-registra; el núcleo no lo importa', () => {
    const r = new PluginRegistry();
    r.register(plug('subtitulos'));
    expect(r.has('subtitulos')).toBe(true);
    expect(r.registered).toEqual(['subtitulos']);
  });

  it('rechaza dos plugins con el mismo id', () => {
    const r = new PluginRegistry();
    r.register(plug('a'));
    expect(() => r.register(plug('a'))).toThrow(/id "a"/);
  });

  it('activar es configuración, nunca un build', async () => {
    const r = new PluginRegistry();
    r.register(plug('chromecast'));
    const res = await r.activate(player, { chromecast: true });
    expect(res.activated).toEqual(['chromecast']);
  });

  it('lo no configurado ni autoactivable se queda fuera', async () => {
    const r = new PluginRegistry();
    r.register(plug('chromecast'));
    const res = await r.activate(player, {});
    expect(res.activated).toEqual([]);
    expect(res.skipped).toEqual(['chromecast']);
  });

  it('la configuración del plugin llega a su contexto', async () => {
    const r = new PluginRegistry();
    let recibida: unknown;
    r.register({
      id: 'h5p',
      load: () => ({ activate: (ctx) => { recibida = ctx.config; } }),
    });
    await r.activate(player, { h5p: { library: 'H5P.Blanks 1.14' } });
    expect(recibida).toEqual({ library: 'H5P.Blanks 1.14' });
  });

  // --- activación por condición ------------------------------------------

  it('se autoactiva si el manifiesto lo justifica', async () => {
    // El caso habitual no necesita configuración: los subtítulos se encienden
    // solos porque el vídeo trae pistas de texto.
    const r = new PluginRegistry();
    r.register(plug('subtitulos', {
      activateWhen: (m) => (m?.textTracks?.length ?? 0) > 0,
    }));
    const res = await r.activate(player, {}, MANIFIESTO);
    expect(res.activated).toEqual(['subtitulos']);
  });

  it('no se autoactiva si el manifiesto no lo justifica', async () => {
    const r = new PluginRegistry();
    r.register(plug('h5p', {
      activateWhen: (m) => (m?.annotations ?? []).some((a) => a.kind === 'h5p'),
    }));
    const res = await r.activate(player, {}, MANIFIESTO);
    expect(res.activated).toEqual([]);
  });

  it('un false explícito gana a la condición automática', async () => {
    const r = new PluginRegistry();
    r.register(plug('subtitulos', { activateWhen: () => true }));
    const res = await r.activate(player, { subtitulos: false }, MANIFIESTO);
    expect(res.activated).toEqual([]);
  });

  // --- dependencias -------------------------------------------------------

  it('arrastra las dependencias aunque no se pidieran', async () => {
    const traza: string[] = [];
    const r = new PluginRegistry();
    r.register(plug('base', {}, traza));
    r.register(plug('encima', { dependsOn: ['base'] }, traza));

    const res = await r.activate(player, { encima: true });
    expect(res.activated).toEqual(['base', 'encima']);
    expect(traza).toEqual(['activar:base', 'activar:encima']);
  });

  // --- aislamiento de fallos ---------------------------------------------

  it('un plugin que revienta no impide activar los demás', async () => {
    // Son código de terceros: que uno falle no puede dejar al reproductor sin
    // subtítulos y sin barra de progreso a la vez.
    const r = new PluginRegistry();
    r.register({ id: 'roto', load: () => ({ activate: () => { throw new Error('boom'); } }) });
    r.register(plug('sano'));

    const res = await r.activate(player, { roto: true, sano: true });
    expect(res.activated).toEqual(['sano']);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]!.id).toBe('roto');
  });

  it('un fallo al cargar la implementación se recoge igual', async () => {
    const r = new PluginRegistry();
    r.register({ id: 'lento', load: async () => { throw new Error('404'); } });
    const res = await r.activate(player, { lento: true });
    expect(res.failed[0]!.id).toBe('lento');
    expect(res.activated).toEqual([]);
  });

  // --- carga diferida -----------------------------------------------------

  it('no carga la implementación de lo que no se activa', async () => {
    // Es lo que hace compatibles "todo disponible" y "núcleo pequeño": H5P no
    // se descarga si el vídeo no trae anotaciones H5P.
    const load = vi.fn(() => ({ activate: () => {} }));
    const r = new PluginRegistry();
    r.register({ id: 'pesado', load });
    await r.activate(player, {});
    expect(load).not.toHaveBeenCalled();

    await r.activate(player, { pesado: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('activar dos veces no reactiva lo ya activo', async () => {
    const traza: string[] = [];
    const r = new PluginRegistry();
    r.register(plug('a', {}, traza));
    await r.activate(player, { a: true });
    await r.activate(player, { a: true });
    expect(traza).toEqual(['activar:a']);
  });

  // --- desactivación ------------------------------------------------------

  it('desactiva en orden inverso, por las dependencias', async () => {
    const traza: string[] = [];
    const r = new PluginRegistry();
    r.register(plug('base', {}, traza));
    r.register(plug('encima', { dependsOn: ['base'] }, traza));
    await r.activate(player, { encima: true });
    traza.length = 0;

    await r.deactivateAll();
    expect(traza).toEqual(['desactivar:encima', 'desactivar:base']);
    expect(r.active).toEqual([]);
  });

  it('un fallo al desactivar no impide desactivar el resto', async () => {
    const traza: string[] = [];
    const r = new PluginRegistry();
    r.register({ id: 'malo', load: () => ({
      activate: () => {}, deactivate: () => { throw new Error('boom'); },
    }) });
    r.register(plug('bueno', {}, traza));
    await r.activate(player, { malo: true, bueno: true });
    traza.length = 0;

    await r.deactivateAll();
    expect(traza).toContain('desactivar:bueno');
    expect(r.active).toEqual([]);
  });
});
