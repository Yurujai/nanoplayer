/**
 * Registro de plugins.
 *
 * Separa tres conceptos que los reproductores suelen soldar, y cuya soldadura
 * es la razón de que activar una feature acabe obligando a forkear el proyecto:
 *
 * | Concepto     | Pregunta                          | Aquí                          |
 * |--------------|-----------------------------------|-------------------------------|
 * | Distribución | ¿Cómo llega el código?            | Bundle o paquete npm          |
 * | Registro     | ¿Cómo sabe el núcleo que existe?  | Auto-registro                 |
 * | Activación   | ¿Está encendido y con qué config? | Configuración en ejecución    |
 *
 * **Dependencia invertida:** el núcleo no importa ningún plugin. Cada plugin se
 * declara a sí mismo, así que uno de terceros solo necesita cargarse para
 * existir. Nunca hace falta un build propio para cambiar qué está activo.
 *
 * **Cada plugin se parte en dos**, y eso es lo que hace compatibles "todo
 * disponible" y "núcleo pequeño":
 *   - *manifiesto* — mínimo, siempre presente: id, dependencias y condición
 *   - *implementación* — diferida, se descarga solo cuando se necesita
 */
import type { CoreEvents } from './core-events.js';
import type { EventBus } from './events.js';
import type { Translate } from './i18n.js';
import type { Manifest } from './manifest.js';
import type { Player } from './player.js';
import type { UiSlots } from './slots.js';

/** Lo que un plugin recibe al activarse. */
export interface PluginContext {
  player: Player;
  bus: EventBus<CoreEvents>;
  /** Configuración que el integrador pasó para este plugin. */
  config: Record<string, unknown>;
  /**
   * Traduce una clave del catálogo compartido.
   *
   * Está aquí para que un plugin **no tenga que deducir el idioma por su
   * cuenta** ni traerse su propia tabla. Antes lo hacía el de subtítulos, y con
   * cinco plugins serían cinco formas distintas de mirar `documentElement.lang`
   * y cinco oportunidades de discrepar con la barra.
   *
   * El plugin registra sus cadenas con `strings.register()` al cargarse; quien
   * integra puede sobrescribirlas sin tocar el plugin.
   */
  t: Translate;
  /** Idioma resuelto, para pasárselo a `Intl`. */
  lang: string;
  /**
   * Ejecuta el callback cuando haya interfaz, ahora o más tarde.
   *
   * Los plugins se activan al resolver el manifiesto y la interfaz puede
   * montarse antes o después. Sin esto, cada plugin tendría que resolver ese
   * orden por su cuenta, y la mitad lo haría mal.
   */
  whenUi: (fn: (ui: UiSlots) => void) => void;
}

/** La parte pesada de un plugin. Se carga solo si toca activarlo. */
export interface PluginImpl {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(ctx: PluginContext): void | Promise<void>;
}

export interface PluginManifest {
  id: string;
  /** Ids de plugins que deben activarse antes que este. */
  dependsOn?: readonly string[];
  /**
   * Si debe activarse sin que el integrador diga nada.
   *
   * Recibe el manifiesto del vídeo, así que un plugin puede autoactivarse solo
   * cuando hace falta: subtítulos si hay pistas de texto, H5P si hay
   * anotaciones de ese tipo. El caso habitual no necesita configuración alguna.
   */
  activateWhen?: (manifest: Manifest | null) => boolean;
  /** Carga diferida de la implementación. */
  load: () => Promise<PluginImpl> | PluginImpl;
}

/** Qué dice la configuración sobre un plugin: encendido, apagado, o con ajustes. */
export type PluginConfig = boolean | Record<string, unknown>;

export interface ActivationResult {
  activated: string[];
  skipped: string[];
  failed: Array<{ id: string; error: unknown }>;
}

/**
 * Ordena por dependencias.
 *
 * Falla ruidosamente ante ciclos y dependencias ausentes en lugar de resolver
 * por orden de carga. La resolución implícita es donde estos sistemas se
 * pudren: funciona hasta que alguien reordena dos imports.
 */
export function topoSort(manifests: readonly PluginManifest[]): PluginManifest[] {
  const porId = new Map(manifests.map((m) => [m.id, m]));
  const salida: PluginManifest[] = [];
  const estado = new Map<string, 'visitando' | 'hecho'>();

  const visitar = (m: PluginManifest, camino: string[]): void => {
    const st = estado.get(m.id);
    if (st === 'hecho') return;
    if (st === 'visitando') {
      throw new Error(
        `Plugin dependency cycle: ${[...camino, m.id].join(' → ')}`,
      );
    }
    estado.set(m.id, 'visitando');
    for (const dep of m.dependsOn ?? []) {
      const d = porId.get(dep);
      if (!d) {
        throw new Error(
          `Plugin "${m.id}" depends on "${dep}", which is not registered`,
        );
      }
      visitar(d, [...camino, m.id]);
    }
    estado.set(m.id, 'hecho');
    salida.push(m);
  };

  for (const m of manifests) visitar(m, []);
  return salida;
}

export class PluginRegistry {
  readonly #manifests = new Map<string, PluginManifest>();
  /*
   * Lo activo, **por reproductor**. Antes era un solo mapa por id de plugin, y
   * en cuanto un plugin se activaba para el primer reproductor de la página ya
   * no se activaba para ninguno más: con varios reproductores, solo el primero
   * tenía subtítulos. Cada reproductor lleva su propia instancia de cada plugin.
   */
  readonly #activos = new Map<Player, Map<string, { impl: PluginImpl; ctx: PluginContext }>>();

  /** Auto-registro: lo llama el propio plugin, no el núcleo. */
  register(manifest: PluginManifest): void {
    if (this.#manifests.has(manifest.id)) {
      throw new Error(`A plugin with id "${manifest.id}" is already registered`);
    }
    this.#manifests.set(manifest.id, manifest);
  }

  has(id: string): boolean {
    return this.#manifests.has(id);
  }

  get registered(): string[] {
    return [...this.#manifests.keys()];
  }

  /** Los plugins activos en algún reproductor de la página. */
  get active(): string[] {
    const ids = new Set<string>();
    for (const porId of this.#activos.values()) for (const id of porId.keys()) ids.add(id);
    return [...ids];
  }

  /** Los plugins activos en un reproductor concreto. */
  activeFor(player: Player): string[] {
    return [...(this.#activos.get(player)?.keys() ?? [])];
  }

  /**
   * Decide qué plugins deben estar activos.
   *
   * La configuración explícita manda sobre la condición automática: si alguien
   * escribe `chromecast: false`, no se activa aunque su condición diga que sí.
   */
  resolveActive(
    config: Record<string, PluginConfig>,
    manifest: Manifest | null,
  ): PluginManifest[] {
    const elegidos: PluginManifest[] = [];
    for (const m of this.#manifests.values()) {
      const explicito = config[m.id];
      if (explicito === false) continue;
      const activar = explicito !== undefined || (m.activateWhen?.(manifest) ?? false);
      if (activar) elegidos.push(m);
    }

    // Arrastrar las dependencias de lo elegido, aunque no se pidieran.
    const porId = new Map(this.#manifests.entries());
    const vistos = new Set(elegidos.map((m) => m.id));
    const cola = [...elegidos];
    while (cola.length) {
      const m = cola.pop()!;
      for (const dep of m.dependsOn ?? []) {
        if (vistos.has(dep)) continue;
        const d = porId.get(dep);
        if (!d) continue;   // topoSort lo denunciará con un mensaje mejor
        vistos.add(dep);
        elegidos.push(d);
        cola.push(d);
      }
    }
    return topoSort(elegidos);
  }

  /**
   * Carga y activa los plugins que correspondan.
   *
   * Un plugin que falla **no impide que se activen los demás**: son código de
   * terceros, y que uno reviente no puede dejar el reproductor sin subtítulos
   * y sin barra de progreso a la vez. El fallo se devuelve, no se traga.
   */
  async activate(
    player: Player,
    config: Record<string, PluginConfig> = {},
    manifest: Manifest | null = null,
  ): Promise<ActivationResult> {
    const resultado: ActivationResult = { activated: [], skipped: [], failed: [] };
    const orden = this.resolveActive(config, manifest);
    const elegidos = new Set(orden.map((m) => m.id));

    for (const id of this.#manifests.keys()) {
      if (!elegidos.has(id)) resultado.skipped.push(id);
    }

    let activos = this.#activos.get(player);
    if (!activos) {
      activos = new Map();
      this.#activos.set(player, activos);
      // Al destruir el reproductor, sus plugins se van con él: si no, el
      // registro los retendría para siempre, y al reproductor con ellos.
      player.on('destroy', () => { void this.deactivate(player); });
    }

    for (const m of orden) {
      if (activos.has(m.id)) continue;
      try {
        const cfg = config[m.id];
        const ctx: PluginContext = {
          player,
          bus: player.bus,
          config: (typeof cfg === 'object' && cfg !== null) ? cfg : {},
          t: player.t,
          lang: player.lang,
          whenUi: (fn) => {
            if (player.ui) fn(player.ui);
            else player.bus.once('ui:ready', () => { if (player.ui) fn(player.ui); });
          },
        };
        const impl = await m.load();
        await impl.activate(ctx);
        activos.set(m.id, { impl, ctx });
        resultado.activated.push(m.id);
      } catch (error) {
        resultado.failed.push({ id: m.id, error });
      }
    }
    return resultado;
  }

  /** Desactiva los plugins de un reproductor, en orden inverso por las dependencias. */
  async deactivate(player: Player): Promise<void> {
    const activos = this.#activos.get(player);
    if (!activos) return;
    this.#activos.delete(player);
    for (const [, entrada] of [...activos].reverse()) {
      try {
        await entrada.impl.deactivate?.(entrada.ctx);
      } catch {
        // Un fallo al desactivar no puede impedir desactivar el resto.
      }
    }
  }

  /** Desactiva los plugins de todos los reproductores. */
  async deactivateAll(): Promise<void> {
    for (const player of [...this.#activos.keys()]) await this.deactivate(player);
  }
}

/** Registro global: donde los plugins se auto-registran al cargarse. */
export const plugins = new PluginRegistry();
