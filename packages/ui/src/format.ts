/**
 * Time and quantity formatting: compact for the screen, spoken for screen
 * readers (`12:05` read aloud means nothing). All grammar comes from `Intl`,
 * so every language gets correct plurals, conjunctions and percent placement.
 */

function hoursMinutesSeconds(seconds: number): { h: number; m: number; s: number } {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

/** `1:05:03` or `4:07`. Hours only when needed. */
export function formatTime(seconds: number): string {
  const { h, m, s } = hoursMinutesSeconds(seconds);
  const twoDigits = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${twoDigits(m)}:${twoDigits(s)}` : `${m}:${twoDigits(s)}`;
}

/** `1 hour, 5 minutes and 3 seconds`, for `aria-valuetext`. */
export function spokenTime(seconds: number, lang = 'es'): string {
  const { h, m, s } = hoursMinutesSeconds(seconds);

  const unit = (value: number, unit: 'hour' | 'minute' | 'second') =>
    new Intl.NumberFormat(lang, { style: 'unit', unit, unitDisplay: 'long' }).format(value);

  const parts: string[] = [];
  if (h > 0) parts.push(unit(h, 'hour'));
  if (m > 0) parts.push(unit(m, 'minute'));
  if (s > 0 || parts.length === 0) parts.push(unit(s, 'second'));

  return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(parts);
}

/** `35 %` for the volume. Spacing and sign position depend on the language. */
export function formatPercent(value: number, lang = 'es'): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return new Intl.NumberFormat(lang, { style: 'percent' }).format(clamped);
}
