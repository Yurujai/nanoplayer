/**
 * Plugin registry. The core imports no plugin: each one registers itself, so a
 * third-party plugin only needs to be loaded. A plugin is split in two: a small
 * manifest (id, dependencies, condition) always present, and an implementation
 * loaded only when it activates. Activation is runtime configuration, never a
 * custom build.
 */
import type { CoreEvents } from './core-events.js';
import type { EventBus } from './events.js';
import type { Translate } from './i18n.js';
import type { Manifest } from './manifest.js';
import type { Player } from './player.js';
import type { UiSlots } from './slots.js';

/** What a plugin receives when activated. */
export interface PluginContext {
  player: Player;
  bus: EventBus<CoreEvents>;
  /** The configuration the integrator passed for this plugin. */
  config: Record<string, unknown>;
  /**
   * Translates a key from the shared catalogue, so a plugin never works out the
   * language on its own. Plugins register their strings with `strings.register()`.
   */
  t: Translate;
  /** The resolved language, for `Intl`. */
  lang: string;
  /** Runs the callback when there is a UI, now or later. */
  whenUi: (fn: (ui: UiSlots) => void) => void;
}

/** A plugin's heavy part, loaded only when it activates. */
export interface PluginImpl {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(ctx: PluginContext): void | Promise<void>;
}

export interface PluginManifest {
  id: string;
  /** Plugin ids that must activate before this one. */
  dependsOn?: readonly string[];
  /** Whether it activates without configuration, from the video's manifest (e.g. captions if there are tracks). */
  activateWhen?: (manifest: Manifest | null) => boolean;
  /** Deferred load of the implementation. */
  load: () => Promise<PluginImpl> | PluginImpl;
}

/** On, off, or on with settings. */
export type PluginConfig = boolean | Record<string, unknown>;

export interface ActivationResult {
  activated: string[];
  skipped: string[];
  failed: Array<{ id: string; error: unknown }>;
}

/** Orders by dependencies, failing loudly on cycles and missing dependencies. */
export function topoSort(manifests: readonly PluginManifest[]): PluginManifest[] {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const output: PluginManifest[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (m: PluginManifest, path: string[]): void => {
    const st = state.get(m.id);
    if (st === 'done') return;
    if (st === 'visiting') {
      throw new Error(
        `Plugin dependency cycle: ${[...path, m.id].join(' → ')}`,
      );
    }
    state.set(m.id, 'visiting');
    for (const dep of m.dependsOn ?? []) {
      const d = byId.get(dep);
      if (!d) {
        throw new Error(
          `Plugin "${m.id}" depends on "${dep}", which is not registered`,
        );
      }
      visit(d, [...path, m.id]);
    }
    state.set(m.id, 'done');
    output.push(m);
  };

  for (const m of manifests) visit(m, []);
  return output;
}

export class PluginRegistry {
  readonly #manifests = new Map<string, PluginManifest>();
  // Per player: keyed by plugin id alone, only the page's first player got
  // captions (test: "each player activates its own plugins").
  readonly #active = new Map<Player, Map<string, { impl: PluginImpl; ctx: PluginContext }>>();

  /** Self-registration: called by the plugin, not the core. */
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

  /** Plugins active in any player on the page. */
  get active(): string[] {
    const ids = new Set<string>();
    for (const byId of this.#active.values()) for (const id of byId.keys()) ids.add(id);
    return [...ids];
  }

  activeFor(player: Player): string[] {
    return [...(this.#active.get(player)?.keys() ?? [])];
  }

  /** Explicit configuration wins over the automatic condition. */
  resolveActive(
    config: Record<string, PluginConfig>,
    manifest: Manifest | null,
  ): PluginManifest[] {
    const chosen: PluginManifest[] = [];
    for (const m of this.#manifests.values()) {
      const explicit = config[m.id];
      if (explicit === false) continue;
      const activate = explicit !== undefined || (m.activateWhen?.(manifest) ?? false);
      if (activate) chosen.push(m);
    }

    // Pull in the dependencies of what was chosen, even if not asked for.
    const byId = new Map(this.#manifests.entries());
    const seen = new Set(chosen.map((m) => m.id));
    const queue = [...chosen];
    while (queue.length) {
      const m = queue.pop()!;
      for (const dep of m.dependsOn ?? []) {
        if (seen.has(dep)) continue;
        const d = byId.get(dep);
        if (!d) continue;   // topoSort reports it with a better message
        seen.add(dep);
        chosen.push(d);
        queue.push(d);
      }
    }
    return topoSort(chosen);
  }

  /**
   * Loads and activates what applies. A failing plugin does not stop the others;
   * the failure is returned, not swallowed.
   */
  async activate(
    player: Player,
    config: Record<string, PluginConfig> = {},
    manifest: Manifest | null = null,
  ): Promise<ActivationResult> {
    const result: ActivationResult = { activated: [], skipped: [], failed: [] };
    const order = this.resolveActive(config, manifest);
    const chosen = new Set(order.map((m) => m.id));

    for (const id of this.#manifests.keys()) {
      if (!chosen.has(id)) result.skipped.push(id);
    }

    let active = this.#active.get(player);
    if (!active) {
      active = new Map();
      this.#active.set(player, active);
      player.on('destroy', () => { void this.deactivate(player); });
    }

    for (const m of order) {
      if (active.has(m.id)) continue;
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
        active.set(m.id, { impl, ctx });
        result.activated.push(m.id);
      } catch (error) {
        result.failed.push({ id: m.id, error });
      }
    }
    return result;
  }

  /** In reverse activation order, because of dependencies. */
  async deactivate(player: Player): Promise<void> {
    const active = this.#active.get(player);
    if (!active) return;
    this.#active.delete(player);
    for (const [, entry] of [...active].reverse()) {
      try {
        await entry.impl.deactivate?.(entry.ctx);
      } catch {
        // A failure deactivating one must not stop the rest.
      }
    }
  }

  async deactivateAll(): Promise<void> {
    for (const player of [...this.#active.keys()]) await this.deactivate(player);
  }
}

/** The global registry plugins register themselves in when loaded. */
export const plugins = new PluginRegistry();
