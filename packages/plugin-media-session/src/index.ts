/**
 * Media Session plugin: the lock screen, the control centre, headphones and
 * media keys drive the player, and show its title, chapter and poster. Above
 * all for mobile, where lectures are listened to with the screen off.
 *
 * The session is one per page, not per player: it belongs to whichever player
 * started playing last, as only one plays at a time anyway.
 */
import {
  plugins,
  type ChapterAnnotation, type Manifest, type Player, type PluginContext, type PluginImpl,
} from '@nanoplayer/core';

const SEEK_OFFSET = 10;
/** Past this far into a chapter, "previous" restarts it, as music players do. */
const RESTART_CHAPTER_AFTER = 3;

type Action = 'play' | 'pause' | 'stop' | 'seekbackward' | 'seekforward' | 'seekto'
  | 'previoustrack' | 'nexttrack';
const ACTIONS: readonly Action[] = [
  'play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack',
];

function mediaSession(): MediaSession | null {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null;
}

function chaptersOf(m: Manifest | null): ChapterAnnotation[] {
  return (m?.annotations ?? [])
    .filter((a): a is ChapterAnnotation => a.kind === 'chapter')
    .sort((a, b) => a.start - b.start);
}

/** The player holding the page's session. */
let owner: MediaSessionLink | null = null;

class MediaSessionLink implements PluginImpl {
  #player: Player | null = null;
  #chapter = -1;
  #unsubscribe: Array<() => void> = [];

  activate(ctx: PluginContext): void {
    const session = mediaSession();
    if (!session) return;
    const player = ctx.player;
    this.#player = player;

    this.#unsubscribe.push(
      player.on('play', () => { this.#own(session); session.playbackState = 'playing'; }),
      player.on('pause', () => { if (owner === this) session.playbackState = 'paused'; }),
      player.on('ended', () => { if (owner === this) session.playbackState = 'paused'; }),
      player.on('time', () => { if (owner === this) this.#update(session); }),
      player.on('seek:end', () => { if (owner === this) this.#position(session); }),
      player.on('ratechange', () => { if (owner === this) this.#position(session); }),
      player.on('chain:phase', () => { if (owner === this) this.#handlers(session); }),
    );
  }

  deactivate(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
    const session = mediaSession();
    if (owner === this && session) {
      for (const action of ACTIONS) setHandler(session, action, null);
      session.metadata = null;
      session.playbackState = 'none';
      owner = null;
    }
    this.#player = null;
  }

  #own(session: MediaSession): void {
    if (owner !== this) {
      owner = this;
      this.#chapter = -1;
    }
    this.#handlers(session);
    this.#update(session);
  }

  #update(session: MediaSession): void {
    const chapter = this.#currentChapter();
    if (chapter !== this.#chapter || !session.metadata) {
      this.#chapter = chapter;
      this.#metadata(session);
    }
    this.#position(session);
  }

  #metadata(session: MediaSession): void {
    const player = this.#player!;
    const m = player.manifest;
    const chapter = this.#chapters()[this.#chapter];
    const poster = player.poster;
    session.metadata = new MediaMetadata({
      title: m?.title ?? document.title,
      artist: chapter?.title ?? '',
      artwork: poster ? [{ src: new URL(poster, document.baseURI).href }] : [],
    });
  }

  /** Live has no fixed duration, and the API throws on one it cannot take. */
  #position(session: MediaSession): void {
    const player = this.#player!;
    if (player.manifest?.live || !session.setPositionState) return;
    const duration = player.duration;
    if (!(duration > 0)) return;
    try {
      session.setPositionState({
        duration,
        position: Math.min(duration, Math.max(0, player.currentTime)),
        playbackRate: player.master?.getPlaybackRate() || 1,
      });
    } catch { /* a transient inconsistency mid-seek: the next update fixes it */ }
  }

  /**
   * The handlers set are the buttons the system shows, so they follow what
   * can be done now: nothing seeks during the intro, as with the seeking keys,
   * and "next" skips it instead; live has nowhere to seek.
   */
  #handlers(session: MediaSession): void {
    const player = this.#player!;
    const live = !!player.manifest?.live;
    const intro = player.phase === 'intro';
    const canSeek = !live && !intro;
    const hasChapters = !live && this.#chapters().length > 0;
    const seekBy = (delta: number) =>
      player.seek(Math.min(player.duration || 0, Math.max(0, player.currentTime + delta)));

    setHandler(session, 'play', () => { void player.play().catch(() => {}); });
    setHandler(session, 'pause', () => player.pause());
    setHandler(session, 'stop', () => player.pause());
    setHandler(session, 'seekbackward', canSeek
      ? (d) => seekBy(-(d.seekOffset ?? SEEK_OFFSET)) : null);
    setHandler(session, 'seekforward', canSeek
      ? (d) => seekBy(d.seekOffset ?? SEEK_OFFSET) : null);
    setHandler(session, 'seekto', canSeek
      ? (d) => { if (d.seekTime !== undefined) player.seek(d.seekTime); } : null);
    setHandler(session, 'previoustrack', hasChapters && !intro ? () => this.#previousChapter() : null);
    setHandler(session, 'nexttrack', intro
      ? () => player.skipIntro()
      : hasChapters ? () => this.#nextChapter() : null);
  }

  /** Chapter starts in visible time, those a trim leaves out dropped. */
  #chapters(): Array<{ start: number; title: string }> {
    const player = this.#player!;
    const duration = player.duration;
    return chaptersOf(player.manifest)
      .map((c) => ({ start: player.toVisibleTime(c.start), title: c.title }))
      .filter((c) => c.start >= 0 && (!(duration > 0) || c.start < duration));
  }

  #currentChapter(): number {
    const now = this.#player!.currentTime;
    let index = -1;
    this.#chapters().forEach((c, i) => { if (c.start <= now) index = i; });
    return index;
  }

  #previousChapter(): void {
    const player = this.#player!;
    const chapters = this.#chapters();
    const i = this.#currentChapter();
    const current = chapters[i];
    if (current && player.currentTime - current.start > RESTART_CHAPTER_AFTER) {
      player.seek(current.start);
    } else {
      player.seek(chapters[i - 1]?.start ?? 0);
    }
  }

  #nextChapter(): void {
    const next = this.#chapters()[this.#currentChapter() + 1];
    if (next) this.#player!.seek(next.start);
  }
}

/** Unsupported actions throw, and browsers support different sets. */
function setHandler(
  session: MediaSession, action: Action, handler: MediaSessionActionHandler | null,
): void {
  try { session.setActionHandler(action, handler); } catch { /* not supported here */ }
}

/** Self-registration: on wherever the browser has a media session. */
plugins.register({
  id: 'media-session',
  activateWhen: (m) => m !== null && mediaSession() !== null,
  load: () => new MediaSessionLink(),
});

export { MediaSessionLink };
