/**
 * The player: orchestrates manifest, lifecycle, engines and sync. Headless on
 * purpose; the controls are built on top of this API. Constructing a `Player`
 * downloads nothing, not even the manifest.
 */
import type { ChainPhase } from './chain.js';
import { ChainController, type ChainHost } from './chain-controller.js';
import type { CoreEvents } from './core-events.js';
import {
  AUTO_QUALITY, type AudioTrackInfo, type EngineFactory, type MediaEngine, type QualityInfo,
} from './engine.js';
import { playerError, type PlayerError } from './errors.js';
import { strings, type Catalogues, type Translate } from './i18n.js';
import { EventBus, type Unsubscribe } from './events.js';
import { Lifecycle } from './lifecycle.js';
import type { LiveStatus, RetryPolicy } from './live.js';
import { LiveBroadcast } from './live-broadcast.js';
import { LiveEdge } from './live-edge.js';
import type { Manifest, Stream } from './manifest.js';
import { ContentSet } from './content-set.js';
import { StallCoordinator } from './stall-coordinator.js';
import { TrimTimeline, type TrimRange } from './trim-timeline.js';
import { nativeEngineFactory } from './native-engine.js';
import type { UiSlots } from './slots.js';
import type { PlayerState } from './state.js';
import type { SyncProfile } from './sync.js';
import {
  isAudioOnlyManifest, masterStream, trimOf,
} from './manifest-queries.js';
import { validateManifest } from './validate.js';

/** Fetches the manifest. Replaceable to batch requests. */
export type ManifestResolver = (src: string) => Promise<unknown>;

export interface PlayerOptions {
  /** Where the media elements are mounted. */
  container: HTMLElement;
  /** A loaded manifest, or a URL to fetch it from. */
  manifest: Manifest | Record<string, unknown> | string;
  /** Available engines, in order of preference: on equal confidence the first wins. */
  engines?: readonly EngineFactory[];
  /**
   * How to fetch a manifest by URL. The extension point for resolving many in
   * one request: 32 players on a page become one call instead of 32.
   */
  manifestResolver?: ManifestResolver;
  /**
   * Poster, available **without resolving the manifest**: showing one that
   * lives only inside the manifest would need the very request `idle` avoids.
   */
  poster?: string;
  muted?: boolean;
  volume?: number;
  /** Sync profile. Detected from the engine by default. */
  syncProfile?: SyncProfile;
  /** Delay between retries while a live stream is not broadcasting yet. */
  liveRetry?: RetryPolicy;
  /**
   * UI language. Defaults to the container document's `lang`, then `es`.
   * Resolved here, not in the controls, so plugins do not each work it out.
   */
  lang?: string;
  /** Own strings, which override those registered by each package. */
  strings?: Catalogues;
}

const defaultResolver: ManifestResolver = async (src) => {
  const res = await fetch(src);
  if (!res.ok) {
    throw playerError('manifest/fetch', `${res.status} ${res.statusText} requesting ${src}`);
  }
  return res.json();
};

export class Player {
  readonly bus = new EventBus<CoreEvents>();
  readonly #lc = new Lifecycle(this.bus);
  readonly #opts: PlayerOptions;
  readonly #engines: readonly EngineFactory[];

  #manifest: Manifest | null = null;
  readonly #content: ContentSet;
  #ui: UiSlots | null = null;
  readonly #broadcast: LiveBroadcast;
  readonly #edge = new LiveEdge(() => this.master);
  readonly #t: Translate;
  readonly #stalls = new StallCoordinator(() => this.#content.entries());
  #timelineCache = new TrimTimeline(null);
  #timelineFor: Manifest | null = null;
  /** A preloaded manifest, validated only once. */
  #provisional: Manifest | null = null;
  #provisionalChecked = false;
  /** Avoids repeating `ended` on every `time` past the trim's end. */
  #trimEndAnnounced = false;

  readonly #chain: ChainController;
  /** What the user asked for, applied to each piece when it is revealed. */
  #muted: boolean;
  /** Survives an eviction: reapplied on attach. */
  #volume: number;

  constructor(options: PlayerOptions) {
    this.#opts = options;
    this.#muted = options.muted === true;
    this.#volume = options.volume ?? 1;
    this.#engines = options.engines ?? [nativeEngineFactory];
    this.#content = new ContentSet({
      container: options.container,
      engines: this.#engines,
      bus: this.bus,
      ...(options.syncProfile ? { syncProfile: options.syncProfile } : {}),
    });
    this.#broadcast = new LiveBroadcast({
      bus: this.bus,
      ...(options.liveRetry ? { retry: options.liveRetry } : {}),
      reconnect: (id) => { void this.#retry(id); },
    });
    // The container's document, not the global one: inside an iframe its own lang rules.
    const lang = options.lang
      ?? options.container.ownerDocument.documentElement.lang;
    this.#t = strings.translator(lang || '', options.strings);
    this.#chain = new ChainController(this.#chainHost());
  }

  #chainHost(): ChainHost {
    const player = this;
    return {
      bus: this.bus,
      container: this.#opts.container,
      engines: this.#engines,
      get manifest() { return player.#manifest; },
      get muted() { return player.#muted; },
      get volume() { return player.#volume; },
      get duration() { return player.duration; },
      get hasEngine() { return player.#lc.hasEngine; },
      get isActive() { return player.#lc.state === 'active'; },
      master: () => this.master,
      contentEngines: () => this.#content.engines(),
      playContent: () => (this.#manifest ? this.#playContent(this.#manifest) : Promise.resolve()),
      pauseContent: () => this.#content.pause(),
      seekContent: (seconds) => this.#seekContent(seconds),
      contentRemaining: () => this.#contentRemaining(),
      contentEnded: () => {
        this.#trimEndAnnounced = !!this.#timeline().range;
        this.pause();
      },
      announceEnded: () => {
        this.bus.emit('time', { current: this.duration, duration: this.duration });
        this.bus.emit('ended', { at: this.duration });
      },
      reflectPlay: () => this.#reflectPlay(),
      reflectPause: () => this.#reflectPause(),
      toPlayerError: (error) => this.#toPlayerError(error, 'engine/failed'),
    };
  }

  /** Translates a key from the shared catalogue, for the UI and plugins alike. */
  get t(): Translate { return this.#t; }

  /** Resolved language; the one to pass to `Intl`. */
  get lang(): string { return this.#t.lang; }

  /** Where the media are mounted; the registry observes its visibility. */
  get container(): HTMLElement { return this.#opts.container; }

  /**
   * UI slots, if a UI is mounted. The core does not depend on the UI layer;
   * plugins use `whenUi()` so arrival order does not matter.
   */
  get ui(): UiSlots | null { return this.#ui; }

  /** Called by the UI layer when it mounts. */
  setUi(slots: UiSlots | null): void {
    this.#ui = slots;
    if (slots) this.bus.emit('ui:ready', {});
  }

  get state(): PlayerState { return this.#lc.state; }
  get manifest(): Manifest | null { return this.#manifest; }

  /** Poster URL, if known, without resolving anything. */
  get poster(): string | undefined {
    return this.#opts.poster || this.#known()?.poster;
  }

  /** The resolved manifest or, if it came preloaded, that one validated once. */
  #known(): Manifest | null {
    if (this.#manifest) return this.#manifest;
    if (!this.#provisionalChecked) {
      this.#provisionalChecked = true;
      const src = this.#opts.manifest;
      if (typeof src === 'object') {
        const r = validateManifest(src);
        if (r.ok) this.#provisional = r.manifest;
      }
    }
    return this.#provisional;
  }
  get resumeAt(): number { return this.#lc.resumeAt; }

  /** Engine of the stream carrying the audio: the one that drives the clock. */
  get master(): MediaEngine | null {
    if (!this.#manifest) return null;
    return this.#content.engine(masterStream(this.#manifest).id);
  }

  /** Broadcast status of the whole set. `unknown` if not live. */
  get liveStatus(): LiveStatus {
    return this.#broadcast.overall;
  }

  liveStatusOf(streamId: string): LiveStatus {
    return this.#broadcast.status(streamId);
  }

  /** Image while waiting for a live stream. Falls back to the poster. */
  get liveWaitingImage(): string | undefined {
    return this.#known()?.liveWaitingImage || this.poster;
  }

  /** Whether there is no picture: the UI keeps the poster up instead of a black box. */
  get audioOnly(): boolean {
    const m = this.#known();
    return m ? isAudioOnlyManifest(m) : false;
  }

  /* ---------------------------------------------------------------- live -- */

  /** How far back a live stream can go, in seconds. */
  get dvrWindow(): number {
    return this.#edge.window;
  }

  get liveEdge(): number {
    return this.#edge.edge;
  }

  get behindLive(): number {
    return this.#manifest?.live ? this.#edge.behind(this.currentTime) : 0;
  }

  get atLiveEdge(): boolean {
    return !!this.#manifest?.live && this.#edge.isAtEdge(this.currentTime);
  }

  seekToLive(): void {
    if (!this.#manifest?.live) return;
    const target = this.#edge.seekTarget;
    if (target !== null) this.seek(target);
  }

  /* ---------------------------------------------------------------- trim -- */

  /** Read from the unresolved manifest if needed, so the bar can show the trimmed duration early. */
  #timeline(): TrimTimeline {
    const m = this.#known();
    if (m !== this.#timelineFor) {
      this.#timelineFor = m;
      this.#timelineCache = new TrimTimeline(m ? trimOf(m) : null);
    }
    return this.#timelineCache;
  }

  /** Media time to visible time, for the UI and plugins, which get manifest times. */
  toVisibleTime(media: number): number {
    return this.#timeline().toVisible(media);
  }

  /** Visible time to media time, clamped to the trim. */
  toMediaTime(visible: number): number {
    return this.#timeline().toMedia(visible);
  }

  get trim(): TrimRange | null {
    const r = this.#timeline().range;
    return r ? { ...r } : null;
  }

  get currentTime(): number {
    // The switch to the outro is early, so the master stops a little short of the end.
    if (this.#chain.phase === 'outro') return this.duration;
    const m = this.master;
    return m ? this.toVisibleTime(m.currentTime) : this.#lc.resumeAt;
  }

  get duration(): number {
    const trimmed = this.#timeline().duration;
    if (trimmed !== null) return trimmed;
    // The engine reports 0 until it has metadata, which on iOS is the first play.
    // see docs/browser-quirks.md#ios-no-preload
    const fromEngine = this.master?.duration ?? 0;
    return fromEngine > 0 ? fromEngine : this.#manifest?.duration ?? 0;
  }

  get paused(): boolean { return this.#chain.currentEngine()?.paused ?? true; }

  get phase(): ChainPhase { return this.#chain.phase; }

  /** Only the intro can be skipped; the outro never. */
  get canSkip(): boolean { return this.#chain.canSkip; }

  on<K extends keyof CoreEvents & string>(
    type: K, fn: (payload: CoreEvents[K]) => void,
  ): Unsubscribe {
    return this.bus.on(type, fn);
  }

  /* ------------------------------------------------------- idle → resolved */

  /** Fetches and validates the manifest: the only request until play. */
  async resolve(): Promise<Manifest> {
    if (this.#manifest) return this.#manifest;
    this.#lc.transition('resolving');
    this.bus.emit('manifest:resolve:start', {});

    try {
      const src = this.#opts.manifest;
      const raw = typeof src === 'string'
        ? await (this.#opts.manifestResolver ?? defaultResolver)(src)
        : src;

      const r = validateManifest(raw);
      if (!r.ok) {
        const detail = r.errors.map((e) => `${e.path || '(root)'}: ${e.message}`).join('; ');
        throw playerError('manifest/invalid', `Invalid manifest — ${detail}`);
      }
      this.#manifest = r.manifest;
      this.#chain.start(r.manifest);
      this.#lc.transition('resolved');
      this.bus.emit('manifest:resolve:ok', { manifest: r.manifest });
      return r.manifest;
    } catch (error) {
      this.#lc.transition('idle');
      const pe = this.#toPlayerError(error, 'manifest/fetch');
      this.bus.emit('manifest:resolve:fail', { error: pe });
      this.bus.emit('error', { error: pe });
      throw pe;
    }
  }

  /* --------------------------------------------------- resolved → attached */

  /** Creates the engines and their elements. Video starts downloading here. */
  async attach(): Promise<void> {
    const m = this.#manifest ?? await this.resolve();
    if (this.#lc.hasEngine) return;

    this.#lc.transition('attaching');
    this.bus.emit('engine:attach:start', {});

    try {
      let engineName = 'native';
      const failed: string[] = [];

      await this.#chain.attachIntro(m);

      for (const stream of m.streams) {
        try {
          engineName = await this.#attachStream(stream);
          if (m.live) this.#broadcast.markLive(stream.id);
        } catch (error) {
          // Live, one stream not broadcasting does not block the others; on
          // demand a missing source means incomplete content.
          if (!m.live) throw error;
          failed.push(stream.id);
          this.#broadcast.markUnavailable(stream.id);
          this.#broadcast.retryLater(stream.id);
        }
      }

      if (m.live && failed.length === m.streams.length) {
        this.#lc.transition('resolved');
        this.bus.emit('engine:attach:fail', {
          error: playerError('media/network',
            'The live stream is not broadcasting yet', undefined),
        });
        return;
      }

      await this.#chain.attachOutro(m);

      this.#content.mountSync(m);
      this.#lc.transition('attached');
      this.bus.emit('engine:attach:ok', {
        engine: engineName, resumeAt: this.#lc.resumeAt,
      });
    } catch (error) {
      this.#releaseEngines();
      this.#lc.transition('resolved');
      const pe = this.#toPlayerError(error, 'engine/failed');
      this.bus.emit('engine:attach:fail', { error: pe });
      this.bus.emit('error', { error: pe });
      throw pe;
    }
  }

  async #attachStream(stream: Stream): Promise<string> {
    const engine = await this.#content.attach(stream, {
      // `resumeAt` is visible time; with a trim, this makes a cold attach start at `start`.
      startAt: this.toMediaTime(this.#lc.resumeAt),
      // Behind an intro the content waits muted until revealed.
      muted: this.#muted || !stream.audio || this.#chain.phase === 'intro',
      playsInline: true,
      callbacks: this.#callbacks(stream),
    }, this.#manifest?.live === true);
    if (stream.audio) this.#content.engine(stream.id)?.setVolume(this.#volume);
    return engine;
  }

  async #retry(streamId: string): Promise<void> {
    const stream = this.#manifest?.streams.find((s) => s.id === streamId);
    if (this.#lc.isDestroyed || !this.#manifest?.live || !stream) return;
    // Evicted: no point retrying until someone attaches again.
    if (!this.#lc.hasEngine && this.#lc.state !== 'resolved') return;

    try {
      await this.#attachStream(stream);
      this.#broadcast.markLive(stream.id);
      if (this.#lc.state === 'resolved') {
        this.#lc.transition('attaching');
        this.#lc.transition('attached');
      }
      this.#content.mountSync(this.#manifest);
      if (this.#lc.state === 'active' || this.#stalls.playing) {
        await this.#content.engine(stream.id)?.play().catch(() => {});
      }
    } catch {
      this.#broadcast.markUnavailable(stream.id);
      this.#broadcast.retryLater(stream.id);
    }
  }

  /* ---------------------------------------------------- attached → resolved */

  /**
   * Releases the engines, keeping the position, so a page can hold more players
   * than decoders. see docs/browser-quirks.md#decoder-limit
   */
  detach(): void {
    if (!this.#lc.hasEngine) return;
    if (this.#lc.state === 'active') {
      this.pause();
      // `pause` is async (with hls.js it arrives a turn later) and the state
      // machine forbids `active` → `resolved`, so the step is closed by hand.
      if (this.#lc.state === 'active') this.#lc.transition('attached');
    }
    const at = this.currentTime;
    this.#lc.rememberPosition(at);
    this.#releaseEngines();
    this.#lc.transition('resolved');
    this.bus.emit('engine:detach', { at });
  }

  #releaseEngines(): void {
    this.#broadcast.cancelRetries();
    this.#content.release();
    this.#chain.release();
    // Otherwise a stream stalled at release leaves the set stalled forever.
    this.#stalls.reset();
    this.#trimEndAnnounced = false;
  }

  /* ------------------------------------------------------------- playback */

  async play(): Promise<void> {
    if (!this.#lc.hasEngine) await this.attach();
    const m = this.#manifest;
    if (!m) return;
    if (await this.#chain.play()) return;
    await this.#playContent(m);
    this.#chain.watch();
  }

  async #playContent(m: Manifest): Promise<void> {
    // Like a <video> at its end, play after the trim's end restarts.
    if (this.#trimEndAnnounced) {
      this.#trimEndAnnounced = false;
      this.seek(0);
    }

    // State and event come from the engine's `onPlay`, which knows it really started.
    await this.#content.play(masterStream(m).id);
  }

  pause(): void {
    this.#chain.pause();
    this.#stalls.userPaused();
    this.#content.pause();
  }

  /** Skips the intro. The outro cannot be skipped, hence no `skipOutro()`. */
  skipIntro(): void {
    this.#chain.skipIntro();
  }

  /** `seconds` is visible time, clamped to the trim if any. */
  seek(seconds: number): void {
    if (this.#chain.seek(seconds)) return;
    this.#seekContent(seconds);
  }

  #seekContent(seconds: number): void {
    const master = this.master;
    if (!master) {
      this.#lc.rememberPosition(Math.max(0, Math.min(this.duration || seconds, seconds)));
      return;
    }
    const target = Math.max(0, seconds);
    if (this.#timeline().range && target < this.duration) this.#trimEndAnnounced = false;
    const from = this.toVisibleTime(master.currentTime);
    this.bus.emit('seek:start', { from, to: target });
    master.seek(this.toMediaTime(target));
    // Slaves snap: chasing a seek with smooth correction would take visible seconds.
    this.#content.align();
    this.bus.emit('seek:end', { at: target });
  }

  get volume(): number { return this.#volume; }
  get muted(): boolean { return this.#muted; }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.#volume = Math.min(1, Math.max(0, volume));
    this.master?.setVolume(this.#volume);
    this.#chain.setVolume(this.#volume);
    this.bus.emit('volumechange', { volume: this.#volume, muted: this.#muted });
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    this.#chain.setMuted(muted);
    this.bus.emit('volumechange', { volume: this.#volume, muted });
  }

  /** The content's audio tracks; empty where the engine cannot switch them. */
  get audioTracks(): AudioTrackInfo[] {
    return this.master?.getAudioTracks?.() ?? [];
  }

  get audioTrack(): string | null {
    return this.master?.getAudioTrack?.() ?? null;
  }

  setAudioTrack(id: string): void {
    this.master?.setAudioTrack?.(id);
  }

  /** The master's qualities; empty where the engine cannot choose them. */
  get qualities(): QualityInfo[] {
    return this.master?.getQualities?.() ?? [];
  }

  /** `AUTO_QUALITY`, a quality id, or `null` with nothing to choose. */
  get quality(): string | null {
    return this.master?.getQuality?.() ?? null;
  }

  get playingQuality(): string | null {
    return this.master?.getPlayingQuality?.() ?? null;
  }

  get autoQuality(): boolean {
    return this.master?.autoQuality === true;
  }

  /**
   * Applies to every content stream. The others have their own ladders, so
   * each takes its tallest quality not above the master's: slides in 1080p
   * next to a 360p presenter would spend the bandwidth the viewer just saved.
   */
  setQuality(id: string): void {
    const master = this.master;
    if (!master?.setQuality) return;
    master.setQuality(id);
    const height = master.getQualities?.().find((q) => q.id === id)?.height ?? null;
    for (const engine of this.#content.engines()) {
      if (engine === master || !engine.setQuality) continue;
      if (id === AUTO_QUALITY) {
        if (engine.autoQuality) engine.setQuality(AUTO_QUALITY);
        continue;
      }
      const match = closestQuality(engine.getQualities?.() ?? [], height);
      if (match) engine.setQuality(match.id);
    }
  }

  setPlaybackRate(rate: number): void {
    // Master only: the sync loop sets the slaves' rate relative to it.
    this.master?.setPlaybackRate(rate);
    this.bus.emit('ratechange', { rate });
  }

  destroy(): void {
    if (this.#lc.isDestroyed) return;
    this.#broadcast.reset();
    this.#releaseEngines();
    this.#lc.destroy();
    this.bus.clear();
  }

  /** Seconds left in the content, up to the trim's end if any. */
  #contentRemaining(): number {
    const m = this.master;
    if (!m) return NaN;
    const end = this.#timeline().range?.end ?? m.duration;
    return (end - m.currentTime) / (m.getPlaybackRate() || 1);
  }

  #reflectPlay(): void {
    if (this.#lc.can('active')) this.#lc.transition('active');
    this.bus.emit('play', { at: this.currentTime });
  }

  #reflectPause(): void {
    if (this.#lc.state === 'active') this.#lc.transition('attached');
    this.bus.emit('pause', { at: this.currentTime });
  }

  /* ------------------------------------------------------------- internal */

  /**
   * Playback state follows the media element, not what this object expected:
   * otherwise a browser-initiated pause leaves the button showing the wrong state.
   */
  #callbacks(stream: Stream) {
    const isMaster = stream.audio;
    const counts = () => this.#chain.contentCounts;
    return {
      onTime: (current: number, duration: number) => {
        if (!isMaster || this.#chain.contentHidden) return;
        // The player enforces the trim's end: the file goes on and the engine
        // does not know. Checked here since seeks, rate and stalls break a timer.
        const trim = this.#timeline().range;
        if (trim && current >= trim.end) {
          if (this.#chain.onTrimEnd()) return;
          if (!this.#trimEndAnnounced) {
            this.#trimEndAnnounced = true;
            this.pause();
            this.bus.emit('time', { current: this.duration, duration: this.duration });
            this.bus.emit('ended', { at: this.duration });
          }
          return;
        }
        this.bus.emit('time', {
          current: this.toVisibleTime(current),
          duration: this.duration || duration,
        });
      },
      onPlay: () => {
        if (!isMaster || !counts()) return;
        this.#reflectPlay();
      },
      // Separates initial buffering, which is normal, from a mid-playback stall.
      onPlaying: () => { if (isMaster) this.#stalls.markPlaying(); },
      onPause: () => {
        if (!isMaster || !counts()) return;
        this.#stalls.markNotPlaying();
        this.#reflectPause();
      },
      onEnded: () => {
        if (!isMaster || this.#chain.phase !== 'main') return;
        // Safety net in case the watcher did not switch to the outro early.
        if (this.#chain.onContentEnd()) return;
        if (counts()) this.bus.emit('ended', { at: this.currentTime });
      },
      onSeeked: (at: number) => {
        if (isMaster && counts()) this.bus.emit('seek:end', { at: this.toVisibleTime(at) });
      },
      onStallStart: () => {
        if (!counts()) return;
        this.bus.emit('stall:start', { stream: stream.id });
        this.#stalls.stallStarted(stream.id);
      },
      onStallEnd: (durationMs: number) => {
        if (!counts() && !this.#stalls.isStalled(stream.id)) return;
        this.bus.emit('stall:end', { stream: stream.id, durationMs });
        this.#stalls.stallEnded(stream.id);
      },
      onQualities: () => {
        if (!isMaster) return;
        this.bus.emit('quality:change', {
          qualities: this.qualities, selected: this.quality, playing: this.playingQuality,
        });
      },
      onAudioTracks: () => {
        if (!isMaster) return;
        this.bus.emit('audio:tracks', { tracks: this.audioTracks, active: this.audioTrack });
      },
      onError: (error: PlayerError) => {
        this.bus.emit('error', { error });
        // A network failure on a stream that did broadcast is an interruption.
        if (this.#manifest?.live && error.retryable) {
          this.#broadcast.markUnavailable(stream.id);
        }
      },
    };
  }

  #toPlayerError(error: unknown, fallback: PlayerError['code']): PlayerError {
    if (error && typeof error === 'object' && 'code' in error && 'retryable' in error) {
      return error as PlayerError;
    }
    return playerError(fallback, error instanceof Error ? error.message : String(error), error);
  }
}

/** The tallest quality not above `height`, or else the shortest one. */
function closestQuality(qualities: QualityInfo[], height: number | null): QualityInfo | null {
  const known = qualities.filter((q) => q.height !== null)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  if (known.length === 0 || height === null) return null;
  return known.find((q) => (q.height ?? 0) <= height) ?? known[known.length - 1]!;
}

/** Public API entry point. */
export function createPlayer(options: PlayerOptions): Player {
  return new Player(options);
}
