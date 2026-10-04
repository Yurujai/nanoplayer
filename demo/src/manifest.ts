import { create, type Manifest } from '@nanoplayer/core';
import { attachControls } from '@nanoplayer/ui';
import '@nanoplayer/plugin-captions';
import '@nanoplayer/plugin-chapters';
import '@nanoplayer/plugin-pip';
import '@nanoplayer/plugin-audio-tracks';
import '@nanoplayer/plugin-media-session';
import '@nanoplayer/plugin-quality';
import '@nanoplayer/plugin-transcript';
import '@nanoplayer/plugin-thumbnails';
import '@nanoplayer/plugin-cast';
import '@nanoplayer/plugin-h5p';
import '@nanoplayer/plugin-sign-language';

/** Shows each file as served, so the page and the example cannot drift apart. */
async function show(file: string, into: string): Promise<Manifest> {
  const manifest = await (await fetch(file)).json() as Manifest;
  document.getElementById(into)!.textContent = JSON.stringify(manifest, null, 2);
  return manifest;
}

void show('live.json', 'live-json');
void show('example.json', 'example-json').then((example) => {
  const player = create('#player', { manifest: example });
  attachControls(player, { label: example.title ?? 'Example player' });
});
