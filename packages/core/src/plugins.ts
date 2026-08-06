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
import type { Manifest } from './manifest.js';
import type { Player } from './player.js';

/** Lo que un plugin recibe al activarse. */
export interface PluginContext {
  player: Player;
  bus: EventBus<CoreEvents>;
  /** Configuración que el integrador pasó para este plugin. */
  config: Record<string, unknown>;
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
        `Ciclo de dependencias entre plugins: ${[...camino, m.id].join(' → ')}`,
      );
    }
    estado.set(m.id, 'visitando');
    for (const dep of m.dependsOn ?? []) {
      const d = porId.get(dep);
      if (!d) {
        throw new Error(
          `El plugin "${m.id}" depende de "${dep}", que no está registrado`,
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
  readonly #activos = new Map<string, { impl: PluginImpl; ctx: PluginContext }>();

  /** Auto-registro: lo llama el propio plugin, no el núcleo. */
  register(manifest: PluginManifest): void {
    if (this.#manifests.has(manifest.id)) {
      throw new Error(`Ya hay un plugin registrado con id "${manifest.id}"`);
    }
    this.#manifests.set(manifest.id, manifest);
  }

  has(id: string): boolean {
    return this.#manifests.has(id);
  }

  get registered(): string[] {
    return [...this.#manifests.keys()];
  }

  get active(): string[] {
    return [...this.#activos.keys()];
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

    for (const m of orden) {
      if (this.#activos.has(m.id)) continue;
      try {
        const cfg = config[m.id];
        const ctx: PluginContext = {
          player,
          bus: player.bus,
          config: (typeof cfg === 'object' && cfg !== null) ? cfg : {},
        };
        const impl = await m.load();
        await impl.activate(ctx);
        this.#activos.set(m.id, { impl, ctx });
        resultado.activated.push(m.id);
      } catch (error) {
        resultado.failed.push({ id: m.id, error });
      }
    }
    return resultado;
  }

  /** Desactiva en orden inverso al de activación, por las dependencias. */
  async deactivateAll(): Promise<void> {
    for (const id of [...this.#activos.keys()].reverse()) {
      const entrada = this.#activos.get(id);
      this.#activos.delete(id);
      try {
        await entrada?.impl.deactivate?.(entrada.ctx);
      } catch {
        // Un fallo al desactivar no puede impedir desactivar el resto.
      }
    }
  }
}

/** Registro global: donde los plugins se auto-registran al cargarse. */
export const plugins = new PluginRegistry();
