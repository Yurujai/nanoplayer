export interface TranscriptCue {
  /** Media time in seconds, as in the file. */
  start: number;
  end: number;
  text: string;
}

const STAMP = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/;

function seconds(stamp: string): number | null {
  const m = STAMP.exec(stamp);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/** The only character references WebVTT defines, so this is the whole set. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&lrm;': '‎', '&rlm;': '‏',
};

/** Tags dropped, references decoded: plain text, never markup. */
function plain(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|nbsp|lrm|rlm);/g, (e) => ENTITIES[e]!)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The cues of a WebVTT file as plain text. Parsed here, not read from the
 * `<track>`: the captions plugin owns those, and keeps disabled, unloaded, every
 * one not showing.
 */
export function parseVtt(source: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  for (const block of source.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    // Header, NOTE, STYLE and REGION blocks have no timing line.
    const timing = lines.findIndex((l) => l.includes('-->'));
    if (timing < 0) continue;
    const [from, to] = lines[timing]!.split('-->');
    const start = seconds(from ?? '');
    const end = seconds(to ?? '');
    if (start === null || end === null) continue;
    const text = plain(lines.slice(timing + 1).join(' '));
    if (text) cues.push({ start, end, text });
  }
  return cues;
}
