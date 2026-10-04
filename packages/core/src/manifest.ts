/**
 * The manifest describes WHAT to play, never HOW: nothing here mentions hls.js,
 * `<video>` elements or layouts, so engines can change without it noticing.
 */

export interface Source {
  src: string;
  /** MIME type: `application/vnd.apple.mpegurl` for HLS, `video/mp4`, etc. It picks the engine. */
  type: string;
  /** Height in pixels, if known. Informative only: the engine picks the quality. */
  height?: number;
  label?: string;
}

/** The stream's role in the composition. Open, because layouts are plugins. */
export type StreamRole = 'presenter' | 'presentation' | (string & {});

export interface Stream {
  id: string;
  role: StreamRole;
  label?: string;
  /**
   * Video or sound only. Inferred from the sources' MIME type; only needed when
   * that is ambiguous, which in practice is audio-only HLS.
   */
  kind?: 'video' | 'audio';
  /**
   * Whether this stream carries the audio. **Exactly one** does: it is the
   * master of the sync clock, since its playbackRate cannot be touched without
   * being heard (S1), and iPhone cannot play two audio tracks
   * (see docs/browser-quirks.md#ios-single-audio).
   */
  audio: boolean;
  sources: Source[];
  poster?: string;
}

/**
 * A piece chained before or after the content: an institutional intro, an
 * outro with credits. Single-stream, with its own sound. Whether it can be
 * skipped is not configurable: the intro always can, the outro never.
 */
export interface Bumper {
  sources: Source[];
}

/** Playback trim. It does not modify the media: it remaps the visible timeline. */
export interface TrimAnnotation {
  kind: 'trim';
  /** Seconds from the start of the media. */
  start: number;
  end: number;
}

export interface ChapterAnnotation {
  kind: 'chapter';
  start: number;
  end?: number;
  title: string;
}

/** Interactive content anchored to a time. The core only hands it to the plugin that declares its `kind`. */
export interface InteractiveAnnotation {
  kind: 'h5p' | (string & {});
  start: number;
  end?: number;
  /** Opaque payload for that plugin. */
  data: Record<string, unknown>;
}

/** Data anchored to the timeline: trim, chapters and interactive content share the mechanism. */
export type Annotation = TrimAnnotation | ChapterAnnotation | InteractiveAnnotation;

export interface TextTrackDef {
  src: string;
  /** BCP 47 code. */
  lang: string;
  label?: string;
  kind?: 'subtitles' | 'captions' | 'descriptions' | 'chapters';
  default?: boolean;
}

export interface Manifest {
  id: string;
  title?: string;
  /** The only thing downloaded in the `idle` state. */
  poster?: string;
  /** Duration in seconds, if known in advance. */
  duration?: number;
  /** One stream for single-stream, two or more for multi-stream. */
  streams: Stream[];
  /** Intro, before the content. Optional and independent of `outro`. Can be skipped. */
  intro?: Bumper;
  /** Outro, after the content. Optional. **Cannot be skipped.** */
  outro?: Bumper;
  annotations?: Annotation[];
  textTracks?: TextTrackDef[];
  /**
   * A WebVTT file whose cues name an image for each stretch of the video,
   * usually a sprite and its region: `thumbs.jpg#xywh=0,0,160,90`.
   */
  thumbnails?: string;
  live?: boolean;
  /**
   * Image shown after pressing play while a live stream is not on air, apart
   * from `poster`, which is shown before. Falls back to the poster.
   */
  liveWaitingImage?: string;
}
