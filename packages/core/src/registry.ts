/**
 * Coordinación entre reproductores de una misma página.
 *
 * Nace de un caso real: una página con **32 reproductores** en la que cada
 * instancia pedía sus metadatos y empezaba a bufferear al cargar, tumbando los
 * servidores de la aplicación. El integrador tuvo que envolver el reproductor
 * en JavaScript propio para arreglarlo.
 *
 * Aquí eso es comportamiento por defecto y no un parche del integrador. Tres
 * mecanismos:
 *
 *   1. **Reproducción exclusiva** — al arrancar uno, se pausan los demás.
 *   2. **Presupuesto de recursos** — como mucho N instancias con motor
 *      enganchado; al pasarse, se suelta el que lleva más tiempo sin usarse.
 *      S2 midió el techo del navegador en 17 elementos `<video>` simultáneos en
 *      WebKit y 18 en Blink, y ese límite es del motor, no del hardware.
 *   3. **Resolución por visibilidad** — lo que no está en pantalla no pide su
 *      manifiesto. Con 32 reproductores, solo unos pocos se ven.
 */
import type { Player } from './player.js';
import type { Unsubscribe } from './events.js';

export interface RegistryOptions {
  /** Al reproducir uno, pausar los demás. Activado por defecto. */
  exclusive?: boolean;
  /**
   * Máximo de reproductores con motor enganchado a la vez.
   *
   * `0` o ausente lo desactiva. Conviene dejar margen bajo el techo del
   * navegador: un reproductor dual-stream consume dos elementos, no uno.
   */
  maxAttached?: number;
  /** Resolver el manifiesto al entrar en el viewport. */
  resolveWhenVisible?: boolean;
  /** Margen de anticipación del observador de visibilidad. */
  rootMargin?: string;
  /** Inyectables para las pruebas. */
  now?: () => number;
  createObserver?: (cb: IntersectionObserverCallback, options: IntersectionObserverInit)
    => IntersectionObserver;
}

interface Entrada {
  player: Player;
  ultimoUso: number;
  desatar: Unsubscribe[];
}

export class PlayerRegistry {
  readonly #entradas = new Map<Player, Entrada>();
  readonly #opts: Required<Pick<RegistryOptions, 'exclusive' | 'maxAttached' | 'resolveWhenVisible' | 'rootMargin'>>;
  readonly #ahora: () => number;
  #observer: IntersectionObserver | null = null;
  readonly #porElemento = new WeakMap<Element, Player>();

  constructor(options: RegistryOptions = {}) {
    this.#opts = {
      exclusive: options.exclusive ?? true,
      maxAttached: options.maxAttached ?? 0,
      resolveWhenVisible: options.resolveWhenVisible ?? false,
      rootMargin: options.rootMargin ?? '200px',
    };
    this.#ahora = options.now ?? (() => Date.now());

    if (this.#opts.resolveWhenVisible) {
      const crear = options.createObserver
        ?? ((cb, o) => new IntersectionObserver(cb, o));
      try {
        this.#observer = crear(
          (entries) => this.#alVerse(entries),
          { rootMargin: this.#opts.rootMargin },
        );
      } catch {
        // Sin IntersectionObserver se pierde la optimización, no la corrección:
        // el resto de mecanismos sigue funcionando.
        this.#observer = null;
      }
    }
  }

  get size(): number {
    return this.#entradas.size;
  }

  /** Cuántos tienen motor enganchado ahora mismo. */
  get attachedCount(): number {
    let n = 0;
    for (const { player } of this.#entradas.values()) {
      if (player.state === 'attached' || player.state === 'active') n++;
    }
    return n;
  }

  players(): Player[] {
    return [...this.#entradas.keys()];
  }

  register(player: Player): Unsubscribe {
    if (this.#entradas.has(player)) return () => this.unregister(player);

    const desatar: Unsubscribe[] = [];
    const entrada: Entrada = { player, ultimoUso: this.#ahora(), desatar };
    this.#entradas.set(player, entrada);

    desatar.push(player.on('play', () => {
      entrada.ultimoUso = this.#ahora();
      if (this.#opts.exclusive) this.#pausarLosDemas(player);
      this.#aplicarPresupuesto(player);
    }));

    desatar.push(player.on('engine:attach:ok', () => {
      entrada.ultimoUso = this.#ahora();
      this.#aplicarPresupuesto(player);
    }));

    desatar.push(player.on('destroy', () => this.unregister(player)));

    if (this.#observer) {
      this.#porElemento.set(player.container, player);
      this.#observer.observe(player.container);
    }

    return () => this.unregister(player);
  }

  unregister(player: Player): void {
    const entrada = this.#entradas.get(player);
    if (!entrada) return;
    for (const off of entrada.desatar) off();
    this.#entradas.delete(player);
    this.#observer?.unobserve(player.container);
  }

  /** Pausa todos los reproductores registrados. */
  pauseAll(): void {
    for (const { player } of this.#entradas.values()) {
      if (player.state === 'active') player.pause();
    }
  }

  /** Suelta el motor de todos: útil al ocultar una pestaña o desmontar una vista. */
  detachAll(): void {
    for (const { player } of this.#entradas.values()) player.detach();
  }

  destroy(): void {
    for (const player of [...this.#entradas.keys()]) this.unregister(player);
    this.#observer?.disconnect();
    this.#observer = null;
  }

  /* --------------------------------------------------------------- interno */

  #pausarLosDemas(salvo: Player): void {
    for (const { player } of this.#entradas.values()) {
      if (player !== salvo && player.state === 'active') player.pause();
    }
  }

  /**
   * Suelta motores hasta volver dentro del presupuesto.
   *
   * Actúa **después** de enganchar, no antes, así que se puede sobrepasar el
   * límite en uno durante un instante. Es un compromiso consciente: interceptar
   * antes obligaría a que `attach()` conociera al registro, y con techos de 17 y
   * 18 elementos, excederse en uno no rompe nada.
   *
   * Nunca desaloja al que acaba de pedir ni al que está reproduciendo: quitarle
   * el motor a un vídeo en marcha es exactamente lo que no debe pasar.
   */
  #aplicarPresupuesto(recienUsado: Player): void {
    const max = this.#opts.maxAttached;
    if (max <= 0) return;

    let sobran = this.attachedCount - max;
    if (sobran <= 0) return;

    const candidatos = [...this.#entradas.values()]
      .filter((e) => e.player !== recienUsado
        && (e.player.state === 'attached' || e.player.state === 'active'))
      .sort((a, b) => a.ultimoUso - b.ultimoUso);

    // Primero los que no están reproduciendo; solo si no hay más remedio, los
    // que sí. Dentro de cada grupo, el que lleva más tiempo sin usarse.
    const ordenados = [
      ...candidatos.filter((e) => e.player.state !== 'active'),
      ...candidatos.filter((e) => e.player.state === 'active'),
    ];

    for (const e of ordenados) {
      if (sobran <= 0) break;
      e.player.detach();
      sobran--;
    }
  }

  #alVerse(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const player = this.#porElemento.get(entry.target);
      if (!player || player.state !== 'idle') continue;
      void player.resolve().catch(() => {
        // El fallo ya viaja por el bus del propio reproductor; aquí solo se
        // evita que una promesa rechazada quede sin capturar.
      });
    }
  }
}

/* ------------------------------------------------------------------------- */

export interface BatchResolverOptions {
  /** Milisegundos que se espera para juntar peticiones. */
  windowMs?: number;
  /** Tope de elementos por lote. */
  maxBatch?: number;
}

/**
 * Convierte un resolutor por lotes en uno individual.
 *
 * Es la pieza que ataca de frente el problema original: con 32 reproductores en
 * una página, `fetchMany` recibe las 32 claves de una vez y hace **una sola
 * petición** a la API en lugar de 32.
 *
 * Además deduplica: dos reproductores del mismo vídeo comparten la respuesta.
 *
 * ```ts
 * const resolver = createBatchResolver(async (ids) => {
 *   const r = await fetch('/api/videos?ids=' + ids.join(','));
 *   return r.json();            // { [id]: manifiesto }
 * });
 * ```
 */
export function createBatchResolver(
  fetchMany: (srcs: string[]) => Promise<Record<string, unknown>>,
  options: BatchResolverOptions = {},
): (src: string) => Promise<unknown> {
  const windowMs = options.windowMs ?? 10;
  const maxBatch = options.maxBatch ?? 50;

  let pendientes = new Map<string, Array<{
    resolve: (v: unknown) => void; reject: (e: unknown) => void;
  }>>();
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  const vaciar = () => {
    temporizador = null;
    const lote = pendientes;
    pendientes = new Map();
    if (lote.size === 0) return;

    const claves = [...lote.keys()];
    fetchMany(claves).then(
      (resultado) => {
        for (const [src, esperando] of lote) {
          const valor = resultado[src];
          for (const p of esperando) {
            if (valor === undefined) {
              p.reject(new Error(`El lote no devolvió nada para "${src}"`));
            } else {
              p.resolve(valor);
            }
          }
        }
      },
      (error) => {
        for (const esperando of lote.values()) {
          for (const p of esperando) p.reject(error);
        }
      },
    );
  };

  return (src) => new Promise((resolve, reject) => {
    const ya = pendientes.get(src);
    // Deduplicación: dos reproductores del mismo vídeo no generan dos entradas.
    if (ya) { ya.push({ resolve, reject }); return; }
    pendientes.set(src, [{ resolve, reject }]);

    if (pendientes.size >= maxBatch) {
      if (temporizador) clearTimeout(temporizador);
      vaciar();
      return;
    }
    temporizador ??= setTimeout(vaciar, windowMs);
  });
}
