/**
 * Thumbnails plugin: a picture of that point of the video over the hover time
 * of the progress bar, from the manifest's `thumbnails` WebVTT file. It only
 * says which picture goes with each time; the bar draws it.
 */
import {
  parseVtt, plugins,
  type PluginContext, type PluginImpl, type TimelineImage,
} from '@nanoplayer/core';

export interface ThumbnailCue {
  /** Media time, as in the file. */
  start: number;
  end: number;
  image: TimelineImage;
}

const REGION = /^#xywh=(?:pixel:)?(\d+),(\d+),(\d+),(\d+)$/;

/**
 * `sprite.jpg#xywh=160,0,160,90` is a region of a sheet, the usual way, since
 * one request then serves many points; a bare URL is a whole image. Relative
 * URLs are relative to the WebVTT file, not the page.
 */
function imageFrom(reference: string, base: string): TimelineImage | null {
  let url: URL;
  try { url = new URL(reference, base); } catch { return null; }
  const region = REGION.exec(url.hash);
  if (!region) return { url: url.href };
  url.hash = '';
  const [x, y, width, height] = region.slice(1).map(Number) as [number, number, number, number];
  return { url: url.href, x, y, width, height };
}

export function parseThumbnails(source: string, base: string): ThumbnailCue[] {
  const cues: ThumbnailCue[] = [];
  for (const cue of parseVtt(source)) {
    const image = imageFrom(cue.text, base);
    if (image) cues.push({ start: cue.start, end: cue.end, image });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function cueAt(cues: ThumbnailCue[], time: number): ThumbnailCue | null {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cue = cues[mid]!;
    if (time < cue.start) hi = mid - 1;
    else if (time >= cue.end) lo = mid + 1;
    else return cue;
  }
  return null;
}

class Thumbnails implements PluginImpl {
  #unsubscribe: Array<() => void> = [];

  activate(ctx: PluginContext): void {
    const src = ctx.player.manifest?.thumbnails;
    if (!src) return;
    const base = new URL(src, document.baseURI).href;
    let cues: ThumbnailCue[] = [];
    let loading: Promise<void> | null = null;

    // Not with the page: only once there is playback, or someone hovers the bar.
    const load = () => {
      loading ??= fetch(base)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then((text) => { cues = parseThumbnails(text, base); })
        .catch(() => { /* no pictures: the bar still shows the time */ });
    };
    this.#unsubscribe.push(ctx.bus.on('engine:attach:ok', load));

    ctx.whenUi((ui) => {
      this.#unsubscribe.push(ui.addTimelinePreview({
        id: 'thumbnails',
        imageAt: (time) => {
          load();
          return cueAt(cues, time)?.image ?? null;
        },
      }));
    });
  }

  deactivate(): void {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
  }
}

/** Self-registration: on when the manifest names a thumbnails file. */
plugins.register({
  id: 'thumbnails',
  activateWhen: (m) => !!m?.thumbnails,
  load: () => new Thumbnails(),
});

export { Thumbnails };
