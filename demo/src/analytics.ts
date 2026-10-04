import { create, type Manifest } from '@nanoplayer/core';
import { attachControls } from '@nanoplayer/ui';
import '@nanoplayer/plugin-captions';
import '@nanoplayer/plugin-chapters';
import type { AnalyticsConfig } from '@nanoplayer/plugin-analytics';
import type { XapiConfig } from '@nanoplayer/plugin-xapi';
import '@nanoplayer/plugin-analytics';
import '@nanoplayer/plugin-xapi';

const manifest: Manifest = {
  id: 'analytics-demo',
  title: 'Introduction to thermodynamics',
  poster: '../media/poster.jpg',
  streams: [{ id: 'cam', role: 'presenter', audio: true,
              sources: [{ src: '../media/presenter.mp4', type: 'video/mp4' }] }],
  annotations: [
    { kind: 'chapter', start: 0, end: 12, title: 'Welcome' },
    { kind: 'chapter', start: 12, title: 'The first law' },
  ],
};

/** Newest first, capped: a long session would make the page heavy. */
function logger(id: string) {
  const out = document.getElementById(id)!;
  const entries: string[] = [];
  return (value: unknown) => {
    entries.unshift(JSON.stringify(value, null, 2));
    entries.length = Math.min(entries.length, 30);
    out.textContent = entries.join('\n\n');
  };
}

const logAnalytics = logger('log-analytics');
const logXapi = logger('log-xapi');

const analytics: AnalyticsConfig = {
  send: (events) => logAnalytics(events),
  flushEvery: 3,
  context: { page: 'analytics demo' },
};
const xapi: XapiConfig = {
  send: (statement) => logXapi(statement),
  actor: { objectType: 'Agent', name: 'Demo viewer', mbox: 'mailto:viewer@example.org' },
};

const player = create('#player', { manifest, plugins: { analytics, xapi } });
attachControls(player, { label: 'Analytics demo player' });
