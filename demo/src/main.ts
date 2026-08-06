/**
 * Banco de pruebas del núcleo.
 *
 * No es el reproductor: no hay barra de controles, ni layouts, ni accesibilidad
 * — eso es la Fase 2. Lo que hace es **cablear a mano** las piezas que ya
 * existen para poder verlas funcionar en un navegador de verdad y no solo en
 * tests unitarios.
 *
 * Lo que enseña, y que es justo lo diferencial del proyecto:
 *   - El ciclo de vida perezoso: hasta que no se pide, no se descarga nada.
 *   - Que soltar el motor y volver a engancharlo conserva la posición.
 *   - Que el bus de eventos lo cuenta todo, que es de donde colgará la analítica.
 */
import {
  EventBus, Lifecycle, NativeEngine, parseManifest,
  masterStream, slaveStreams,
  type CoreEvents, type Manifest, type MediaEngine, type Stream,
} from '@nanoplayer/core';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/* ------------------------------------------------------------ manifiestos -- */

const MANIFIESTOS: Record<string, unknown> = {
  mono: {
    id: 'demo-mono',
    title: 'Un solo stream',
    duration: 60,
    streams: [
      { id: 'cam', role: 'presenter', label: 'Ponente', audio: true,
        sources: [{ src: '/media/presenter.mp4', type: 'video/mp4' }] },
    ],
  },
  dual: {
    id: 'demo-dual',
    title: 'Dos streams',
    duration: 60,
    streams: [
      { id: 'cam', role: 'presenter', label: 'Ponente', audio: true,
        sources: [{ src: '/media/presenter.mp4', type: 'video/mp4' }] },
      { id: 'slides', role: 'presentation', label: 'Diapositivas', audio: false,
        sources: [{ src: '/media/slides.mp4', type: 'video/mp4' }] },
    ],
  },
  // Para ver que la validación no es decorativa: dos pistas de audio es
  // exactamente lo que S2 midió que rompe en iPhone.
  invalido: {
    id: 'demo-roto',
    streams: [
      { id: 'a', role: 'presenter', audio: true,
        sources: [{ src: '/media/presenter.mp4', type: 'video/mp4' }] },
      { id: 'b', role: 'presentation', audio: true,
        sources: [{ src: '/media/slides.mp4', type: 'video/mp4' }] },
    ],
  },
};

/* ------------------------------------------------------------- instancia -- */

class Demo {
  readonly bus = new EventBus<CoreEvents>();
  readonly lc = new Lifecycle(this.bus);
  #manifest: Manifest | null = null;
  #engines = new Map<string, MediaEngine>();
  #peticiones = 0;

  constructor() {
    this.bus.onAny((type, payload) => log(type, payload));
    this.bus.on('state:change', () => pintarEstado());
  }

  get manifest() { return this.#manifest; }
  get engines() { return this.#engines; }
  get peticiones() { return this.#peticiones; }

  /** idle → resolved. Aquí es donde se paga la primera petición de red. */
  async resolver(clave: string): Promise<void> {
    this.lc.transition('resolving');
    this.bus.emit('manifest:resolve:start', {});
    try {
      // En el reproductor real esto sería un fetch; aquí basta con contarlo
      // para que se vea cuántas peticiones cuesta cada estado.
      this.#peticiones++;
      await new Promise((r) => setTimeout(r, 150));
      const m = parseManifest(MANIFIESTOS[clave]);
      this.#manifest = m;
      this.lc.transition('resolved');
      this.bus.emit('manifest:resolve:ok', { manifest: m });
    } catch (error) {
      this.lc.transition('idle');
      log('manifest:resolve:fail', { message: String(error) });
      throw error;
    }
  }

  /** resolved → attached. Se crean los `<video>` y empieza a bajar vídeo. */
  async enganchar(): Promise<void> {
    const m = this.#manifest;
    if (!m) return;
    this.lc.transition('attaching');
    this.bus.emit('engine:attach:start', {});

    const escenario = $('#escenario');
    escenario.innerHTML = '';

    try {
      for (const stream of m.streams) {
        const caja = document.createElement('div');
        caja.className = 'stream';
        caja.innerHTML = `<span class="etiqueta">${stream.label ?? stream.id}` +
          `${stream.audio ? ' · audio' : ''}</span>`;
        escenario.appendChild(caja);

        const engine = new NativeEngine();
        this.#engines.set(stream.id, engine);
        await engine.attach(caja, stream, {
          startAt: this.lc.resumeAt,
          // Solo el maestro lleva audio: S2 midió que iPhone no reproduce dos
          // pistas a la vez, así que el modelo lo impone desde el principio.
          muted: !stream.audio,
          callbacks: this.#callbacks(stream),
        });
      }
      this.lc.transition('attached');
      this.bus.emit('engine:attach:ok', {
        engine: 'native', resumeAt: this.lc.resumeAt,
      });
    } catch (error) {
      this.lc.transition('resolved');
      log('engine:attach:fail', { message: String(error) });
    }
  }

  #callbacks(stream: Stream) {
    return {
      onTime: (current: number, duration: number) => {
        if (stream.audio) {
          this.bus.emit('time', { current, duration });
          pintarDeriva(this);
        }
      },
      onPlay: () => { if (stream.audio) this.bus.emit('play', { at: this.tiempo }); },
      onPause: () => { if (stream.audio) this.bus.emit('pause', { at: this.tiempo }); },
      onEnded: () => { if (stream.audio) this.bus.emit('ended', { at: this.tiempo }); },
      onStallStart: () => this.bus.emit('stall:start', { stream: stream.id }),
      onStallEnd: (durationMs: number) =>
        this.bus.emit('stall:end', { stream: stream.id, durationMs }),
      onError: (error: unknown) => log('error', error),
    };
  }

  get tiempo(): number {
    const m = this.#manifest;
    if (!m) return 0;
    return this.#engines.get(masterStream(m).id)?.currentTime ?? 0;
  }

  async reproducir(): Promise<void> {
    for (const e of this.#engines.values()) await e.play().catch(() => {});
    if (this.lc.can('active')) this.lc.transition('active');
  }

  pausar(): void {
    for (const e of this.#engines.values()) e.pause();
    if (this.lc.can('attached')) this.lc.transition('attached');
  }

  /**
   * attached → resolved. Suelta los decodificadores conservando la posición.
   *
   * Es la transición que hace posible una página con muchos reproductores: S2
   * midió el techo del navegador en 17 elementos simultáneos (WebKit) y 18
   * (Blink), así que sin soltar no se sostiene.
   */
  desalojar(): void {
    if (this.lc.state === 'active') this.pausar();
    this.lc.rememberPosition(this.tiempo);
    for (const e of this.#engines.values()) e.destroy();
    this.#engines.clear();
    $('#escenario').innerHTML = '<p class="vacio">Motor soltado. ' +
      'Cero elementos &lt;video&gt; en el DOM, posición conservada.</p>';
    this.lc.transition('resolved');
    this.bus.emit('engine:detach', { at: this.lc.resumeAt });
  }

  reiniciar(): void {
    if (this.lc.hasEngine) {
      if (this.lc.state === 'active') this.pausar();
      for (const e of this.#engines.values()) e.destroy();
      this.#engines.clear();
      this.lc.transition('resolved');
    }
    if (this.lc.state === 'resolved') this.lc.transition('idle');
    this.#manifest = null;
    this.#peticiones = 0;
    $('#escenario').innerHTML = '<p class="vacio">Estado <code>idle</code>: ' +
      'solo el póster. Ni una petición de red.</p>';
  }
}

/* ------------------------------------------------------------------- UI --- */

let demo = new Demo();

function log(type: string, payload: unknown): void {
  const linea = document.createElement('div');
  linea.className = 'ev';
  const corto = JSON.stringify(payload, (k, v) =>
    (k === 'manifest' ? '…' : typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
  linea.innerHTML = `<span class="t">${type}</span> <span class="p">${corto}</span>`;
  const cont = $('#eventos');
  cont.prepend(linea);
  while (cont.childElementCount > 120) cont.lastElementChild?.remove();
}

function pintarEstado(): void {
  const s = demo.lc.state;
  $('#estado').textContent = s;
  $('#estado').dataset['s'] = s;
  $('#resumeAt').textContent = demo.lc.resumeAt.toFixed(2) + ' s';
  $('#peticiones').textContent = String(demo.peticiones);
  $('#videos').textContent = String(document.querySelectorAll('#escenario video').length);

  const set = (sel: string, on: boolean) => { $<HTMLButtonElement>(sel).disabled = !on; };
  set('#btn-resolver', s === 'idle');
  set('#btn-enganchar', s === 'resolved');
  set('#btn-play', s === 'attached');
  set('#btn-pause', s === 'active');
  set('#btn-desalojar', s === 'attached' || s === 'active');
}

/**
 * Deriva entre el maestro y los esclavos.
 *
 * Aquí se ve el hueco que llena la Fase 3: sin sincronizador, dos vídeos con
 * framerates distintos se separan solos. El spike S1 midió que con corrección
 * la mediana queda en 9.8 ms; sin ella, esto crece sin freno.
 */
function pintarDeriva(d: Demo): void {
  const m = d.manifest;
  if (!m || d.engines.size < 2) { $('#deriva').textContent = '—'; return; }
  const maestro = d.engines.get(masterStream(m).id);
  if (!maestro) return;
  const derivas = slaveStreams(m)
    .map((s) => d.engines.get(s.id))
    .filter((e): e is MediaEngine => !!e)
    .map((e) => e.currentTime - maestro.currentTime);
  if (!derivas.length) return;
  const peor = derivas.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
  const ms = peor * 1000;
  const el = $('#deriva');
  el.textContent = (ms >= 0 ? '+' : '') + ms.toFixed(0) + ' ms';
  el.className = Math.abs(ms) > 33 ? 'val mal' : 'val bien';
}

$('#btn-resolver').addEventListener('click', () => {
  const clave = $<HTMLSelectElement>('#fuente').value;
  demo.resolver(clave).catch(() => {});
});
$('#btn-enganchar').addEventListener('click', () => { demo.enganchar(); });
$('#btn-play').addEventListener('click', () => { demo.reproducir(); });
$('#btn-pause').addEventListener('click', () => { demo.pausar(); });
$('#btn-desalojar').addEventListener('click', () => { demo.desalojar(); });
$('#btn-reiniciar').addEventListener('click', () => {
  demo.reiniciar();
  $('#eventos').innerHTML = '';
  pintarEstado();
});
$('#fuente').addEventListener('change', () => {
  demo.reiniciar();
  pintarEstado();
});

pintarEstado();
setInterval(() => {
  $('#videos').textContent = String(document.querySelectorAll('#escenario video').length);
}, 500);
