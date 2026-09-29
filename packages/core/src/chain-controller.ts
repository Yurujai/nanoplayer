/**
 * Chains intro, content and outro: which piece is shown, when the next one
 * starts and how to switch without it showing. Anything about the content
 * itself goes to the player through `ChainHost`.
 */
import { CHAIN_LEAD_MS, CHAIN_WATCH_MS, firstFrame, type BumperPhase, type ChainPhase } from './chain.js';
import type { CoreEvents } from './core-events.js';
import { selectEngine, type EngineFactory, type MediaEngine } from './engine.js';
import { playerError, type PlayerError } from './errors.js';
import type { EventBus } from './events.js';
import type { Bumper, Manifest, Stream } from './manifest.js';

/** What the chain needs from the player. */
export interface ChainHost {
  readonly bus: EventBus<CoreEvents>;
  readonly container: HTMLElement;
  readonly engines: readonly EngineFactory[];
  readonly manifest: Manifest | null;
  readonly muted: boolean;
  readonly volume: number;
  readonly duration: number;
  readonly hasEngine: boolean;
  readonly isActive: boolean;
  master(): MediaEngine | null;
  contentEngines(): Iterable<MediaEngine>;
  playContent(): Promise<void>;
  pauseContent(): void;
  seekContent(seconds: number): void;
  /** Seconds left in the content, at the current rate. */
  contentRemaining(): number;
  /** The content ends with no outro after it: stop and remember the end. */
  contentEnded(): void;
  announceEnded(): void;
  reflectPlay(): void;
  reflectPause(): void;
  toPlayerError(error: unknown): PlayerError;
}

export class ChainController {
  #phase: ChainPhase = 'main';
  #bumpers = new Map<BumperPhase, { engine: MediaEngine; box: HTMLElement }>();
  /** Where a switch is heading, or `null`. While it lasts, no engine is in charge. */
  #switching: ChainPhase | null = null;
  /** Bumped to cancel a switch in flight. */
  #turn = 0;
  #watcher: ReturnType<typeof setInterval> | undefined;
  #unlocked = false;
  #chainEnded = false;

  constructor(private readonly host: ChainHost) {}

  get phase(): ChainPhase {
    return this.#phase;
  }

  /** Only the intro can be skipped; the outro never. */
  get canSkip(): boolean {
    return this.#phase === 'intro' && this.#switching === null;
  }

  get hasOutro(): boolean {
    return this.#bumpers.has('outro');
  }

  /**
   * Whether what the content reports counts: during the intro it is stopped
   * or starting behind, and during a switch its events describe a transition.
   */
  get contentCounts(): boolean {
    return this.#phase === 'main' && this.#switching === null;
  }

  get contentHidden(): boolean {
    return this.#phase !== 'main' || this.#switching === 'main';
  }

  currentEngine(): MediaEngine | null {
    if (this.#phase === 'main') return this.host.master();
    return this.#bumpers.get(this.#phase)?.engine ?? null;
  }

  start(manifest: Manifest): void {
    if (manifest.intro) this.#setPhase('intro');
  }

  async attachIntro(manifest: Manifest): Promise<void> {
    if (manifest.intro && this.#phase === 'intro') await this.#attachBumper('intro', manifest.intro);
  }

  /**
   * Attached at start-up even if it is an hour away: the price of unlocking it
   * within the user's gesture. see docs/browser-quirks.md#ios-per-element-autoplay
   */
  async attachOutro(manifest: Manifest): Promise<void> {
    if (manifest.outro) await this.#attachBumper('outro', manifest.outro);
  }

  /**
   * Returns `true` if the chain has handled play —a bumper, or a switch in
   * flight— and `false` if the content should play.
   */
  async play(): Promise<boolean> {
    if (this.#switching) return true;
    this.#unlock();

    // Replaying a finished chain goes back to the content, without the intro.
    if (this.#chainEnded) {
      this.#chainEnded = false;
      this.#bumpers.get('outro')?.engine.seek(0);
      this.#setPhaseAndEmit('main', false);
      this.host.seekContent(0);
    }

    if (this.#phase !== 'main') {
      const bumper = this.#bumpers.get(this.#phase);
      if (bumper) {
        bumper.engine.setMuted(this.host.muted);
        await bumper.engine.play();
        this.watch();
        return true;
      }
      this.#setPhaseAndEmit('main', false);
    }
    return false;
  }

  /** Pausing mid-switch cancels it; resuming lets the watcher fire it again. */
  pause(): void {
    this.#cancelSwitch();
    clearInterval(this.#watcher);
    for (const { engine } of this.#bumpers.values()) engine.pause();
  }

  /** Same path as the early switch: the intro stays visible until the content has a frame. */
  skipIntro(): void {
    if (!this.canSkip) return;
    if (!this.host.hasEngine) {
      this.#setPhaseAndEmit('main', true);
      return;
    }
    void this.#switchTo('main', true);
  }

  /** Returns `true` if the chain has handled the seek and the content must not seek. */
  seek(seconds: number): boolean {
    if (this.#phase === 'outro') {
      // The outro cannot be skipped forward; seeking back returns to the content.
      if (seconds < this.host.duration) this.#backFromOutro(seconds);
      return true;
    }
    if (this.#switching === 'outro') {
      const wasPlaying = this.host.isActive;
      this.#cancelSwitch();
      if (wasPlaying) void this.host.playContent().then(() => this.watch());
    }
    return false;
  }

  /** Returns `true` if the chain takes over the content's end. */
  onContentEnd(): boolean {
    if (!this.hasOutro) return false;
    if (!this.#switching) void this.#switchTo('outro', false);
    return true;
  }

  /** At the trim's end, the content stops on its last frame and the outro enters over it. */
  onTrimEnd(): boolean {
    if (!this.onContentEnd()) return false;
    this.host.pauseContent();
    return true;
  }

  setMuted(muted: boolean): void {
    if (!this.#switching) this.currentEngine()?.setMuted(muted);
  }

  setVolume(volume: number): void {
    for (const { engine } of this.#bumpers.values()) engine.setVolume(volume);
  }

  /** Bumpers keep no position, but the phase is kept: the same bumper restarts. */
  release(): void {
    clearInterval(this.#watcher);
    this.#turn++;
    this.#switching = null;
    this.#unlocked = false;
    for (const { engine, box } of this.#bumpers.values()) {
      engine.destroy();
      box.remove();
    }
    this.#bumpers.clear();
  }

  /**
   * A timer, not `timeupdate`: that fires at ~4 Hz, and 250 ms between events
   * would often miss the 600 ms lead (test: chain.test.ts).
   */
  watch(): void {
    clearInterval(this.#watcher);
    if (!this.#next()) return;
    this.#watcher = setInterval(() => {
      const next = this.#next();
      if (!next || this.#switching || this.currentEngine()?.paused !== false) return;
      const r = this.#remaining();
      if (Number.isFinite(r) && r * 1000 <= CHAIN_LEAD_MS) void this.#switchTo(next, false);
    }, CHAIN_WATCH_MS);
  }

  /**
   * A broken bumper is skipped and the content goes on. Reported through
   * `chain:unavailable`, not `error`, which the UI treats as fatal.
   */
  async #attachBumper(phase: BumperPhase, bumper: Bumper): Promise<void> {
    const stream: Stream = { id: phase, role: phase, audio: true, sources: bumper.sources };
    const box = document.createElement('div');
    box.dataset['bumper'] = phase;
    let engine: MediaEngine | null = null;
    try {
      const factory = selectEngine(this.host.engines, stream);
      if (!factory) {
        throw playerError('engine/unsupported', `No engine can play the ${phase}`);
      }
      this.host.container.appendChild(box);
      engine = factory.create();
      await engine.attach(box, stream, {
        // Muted until revealed. see docs/browser-quirks.md#ios-single-audio
        muted: phase === 'outro' || this.host.muted,
        playsInline: true,
        callbacks: this.#bumperCallbacks(phase),
      });
      engine.setVolume(this.host.volume);
      this.#bumpers.set(phase, { engine, box });
    } catch (error) {
      engine?.destroy();
      box.remove();
      this.#dropBumper(phase, error);
      if (phase === 'intro') this.#setPhaseAndEmit('main', false);
    }
  }

  #dropBumper(phase: BumperPhase, error: unknown): void {
    const b = this.#bumpers.get(phase);
    if (b) {
      b.engine.destroy();
      b.box.remove();
      this.#bumpers.delete(phase);
    }
    this.host.bus.emit('chain:unavailable', { phase, error: this.host.toPlayerError(error) });
  }

  /** A single attribute: the UI shows pieces off it, so flipping it is the instant switch. */
  #setPhase(phase: ChainPhase): void {
    this.#phase = phase;
    this.host.container.dataset['phase'] = phase;
  }

  #setPhaseAndEmit(phase: ChainPhase, skipped: boolean): void {
    const from = this.#phase;
    if (from === phase) return;
    this.#setPhase(phase);
    this.host.bus.emit('chain:phase', { from, to: phase, skipped });
  }

  #cancelSwitch(): void {
    const target = this.#switching;
    if (!target) return;
    this.#turn++;
    this.#switching = null;
    if (target === 'main') {
      this.host.pauseContent();
    } else {
      const e = this.#bumpers.get(target)?.engine;
      e?.pause();
      e?.seek(0);
    }
  }

  #backFromOutro(seconds: number): void {
    const outro = this.#bumpers.get('outro')?.engine;
    const wasPlaying = !!outro && !outro.paused;
    this.#chainEnded = false;
    // Phase first, so the outro's pause does not count as a user pause.
    this.#setPhaseAndEmit('main', false);
    outro?.pause();
    outro?.seek(0);
    this.host.master()?.setMuted(this.host.muted);
    this.host.seekContent(seconds);
    if (wasPlaying) void this.host.playContent().then(() => this.watch());
  }

  /**
   * A `play()` + `pause()` inside the user's gesture authorises the later
   * pieces, which start from a timer. Not needed on Safari 26.5 (S6 §5); kept
   * until measured on older iOS. see docs/browser-quirks.md#ios-per-element-autoplay
   */
  #unlock(): void {
    if (this.#unlocked) return;
    this.#unlocked = true;
    const later: MediaEngine[] = [];
    if (this.#phase === 'intro') later.push(...this.host.contentEngines());
    const outro = this.#bumpers.get('outro')?.engine;
    if (outro && this.#phase !== 'outro') later.push(outro);
    for (const e of later) {
      if (!e.paused) continue;
      const t = e.currentTime;
      e.setMuted(true);
      const p = e.play();
      e.pause();
      e.seek(t);
      void p.catch(() => {});
    }
  }

  #next(): ChainPhase | null {
    if (this.#phase === 'intro') return 'main';
    if (this.#phase === 'main' && this.#bumpers.has('outro')) return 'outro';
    return null;
  }

  #remaining(): number {
    if (this.#phase === 'main') return this.host.contentRemaining();
    const e = this.#bumpers.get(this.#phase)?.engine;
    return e ? e.duration - e.currentTime : NaN;
  }

  /**
   * The incoming piece starts muted behind the outgoing one, and the switch
   * waits for its first frame, not for `play()` to resolve.
   * see docs/browser-quirks.md#first-frame-latency and #ios-single-audio
   */
  async #switchTo(target: ChainPhase, skipped: boolean): Promise<void> {
    if (this.#switching || target === this.#phase || !this.host.manifest) return;
    const origin = this.#phase;
    const turn = ++this.#turn;
    this.#switching = target;
    clearInterval(this.#watcher);

    let incoming: MediaEngine | null;
    try {
      if (target === 'main') {
        this.host.master()?.setMuted(true);
        await this.host.playContent();
        incoming = this.host.master();
      } else {
        incoming = this.#bumpers.get(target)?.engine ?? null;
        if (incoming) {
          incoming.setMuted(true);
          incoming.seek(0);
          await incoming.play();
        }
      }
      if (incoming) await firstFrame(incoming);
    } catch (error) {
      if (turn !== this.#turn) return;
      this.#switching = null;
      if (target === 'main') {
        this.host.bus.emit('error', { error: this.host.toPlayerError(error) });
        return;
      }
      this.#dropBumper('outro', error);
      this.#endContent();
      return;
    }
    if (turn !== this.#turn) return;

    this.#switching = null;
    this.#setPhaseAndEmit(target, skipped);
    incoming?.setMuted(this.host.muted);
    if (origin === 'main') {
      this.host.pauseContent();
    } else {
      this.#bumpers.get(origin)?.engine.pause();
    }
    // Skipping a paused intro starts the content, whose `onPlay` arrived while it did not count.
    if (incoming && !incoming.paused && !this.host.isActive) this.host.reflectPlay();
    if (!incoming) {
      if (target === 'outro') this.#endContent();
      return;
    }
    this.watch();
  }

  /** The content's own `ended`: no outro follows, or it was lost. */
  #endContent(): void {
    if (this.#phase === 'outro') this.#chainEnded = true;
    else this.host.contentEnded();
    this.host.announceEnded();
  }

  #bumperCallbacks(phase: BumperPhase) {
    const counts = () => this.#phase === phase && this.#switching === null;
    return {
      onTime: (current: number, duration: number) => {
        if (counts()) this.host.bus.emit('chain:time', { phase, current, duration });
      },
      onPlay: () => { if (counts()) this.host.reflectPlay(); },
      onPause: () => { if (counts()) this.host.reflectPause(); },
      onEnded: () => {
        if (this.#phase !== phase) return;
        // Safety net for an intro shorter than the lead.
        if (phase === 'intro') void this.#switchTo('main', false);
        else if (!this.#switching) this.#endContent();
      },
      onError: (error: PlayerError) => {
        this.#dropBumper(phase, error);
        if (this.#phase !== phase) return;
        if (phase === 'intro') void this.#switchTo('main', false);
        else this.#endContent();
      },
    };
  }
}
