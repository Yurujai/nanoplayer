import { describe, expect, it } from 'vitest';
import { parseVtt } from '../src/vtt.js';

describe('parseVtt', () => {
  it('reads cues as plain text, whatever the file carries around them', () => {
    const cues = parseVtt([
      'WEBVTT - lecture', '',
      'NOTE written by hand', '',
      'STYLE', '::cue { color: yellow }', '',
      'intro-1', '00:00:01.000 --> 00:00:04.500 align:start',
      '<v Ana>Welcome</v> to <b>thermodynamics</b>,', 'part one &amp; two.', '',
      '01:02:03.250 --> 01:02:05.000', 'Pressure &lt; volume',
    ].join('\r\n'));
    expect(cues).toEqual([
      { start: 1, end: 4.5, text: 'Welcome to thermodynamics, part one & two.' },
      { start: 3723.25, end: 3725, text: 'Pressure < volume' },
    ]);
  });

  it('accepts minutes without hours, and skips empty cues', () => {
    expect(parseVtt('WEBVTT\n\n00:12.000 --> 00:14.000\nShort\n\n00:15.000 --> 00:16.000\n\n'))
      .toEqual([{ start: 12, end: 14, text: 'Short' }]);
  });
});
