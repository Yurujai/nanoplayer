/**
 * Default UI strings. Spanish and English ship with the package; any other
 * language comes in through `strings` when creating the player.
 */
import { strings } from '@nanoplayer/core';

strings.register('es', {
  'ui.region': 'Reproductor de vídeo',
  'ui.play': 'Reproducir',
  'ui.pause': 'Pausar',
  'ui.replay': 'Volver a reproducir',
  'ui.progress': 'Posición',
  'ui.volume': 'Volumen',
  'ui.mute': 'Silenciar',
  'ui.unmute': 'Activar sonido',
  'ui.fullscreenEnter': 'Pantalla completa',
  'ui.fullscreenExit': 'Salir de pantalla completa',
  'ui.speed': 'Velocidad',
  'ui.normal': 'Normal',
  'ui.more': 'Más opciones',

  'ui.status.region': 'Estado del reproductor',
  'ui.status.playing': 'Reproduciendo',
  'ui.status.paused': 'En pausa',
  'ui.status.buffering': 'Cargando',
  'ui.status.ended': 'Vídeo terminado',

  'ui.live.badge': 'EN DIRECTO',
  'ui.live.waiting': 'La emisión aún no ha empezado',
  'ui.live.interrupted': 'Se ha interrumpido la emisión',
  'ui.live.goTo': 'Ir al directo',
  'ui.live.behind': 'Retrasado respecto al directo',
  'ui.live.window': 'Posición en el directo',
  'ui.live.behindBy': 'Retrasado respecto al directo: {time}',
  'ui.live.goToBehindBy': 'Ir al directo. Retrasado respecto al directo: {time}',

  // One per `PlayerError` code: the error message itself is diagnostics for integrators.
  'ui.error.generic': 'No se ha podido reproducir el vídeo',
  'ui.error.manifest/fetch': 'No se ha podido cargar el vídeo',
  'ui.error.manifest/invalid': 'Este vídeo está mal configurado',
  'ui.error.engine/unsupported': 'Este navegador no puede reproducir este vídeo',
  'ui.error.engine/failed': 'No se ha podido iniciar la reproducción',
  'ui.error.media/decode': 'No se ha podido reproducir el vídeo',
  'ui.error.media/network': 'Se ha perdido la conexión con el vídeo',
  'ui.error.media/blocked': 'Pulsa reproducir para empezar',
  'ui.error.internal': 'No se ha podido reproducir el vídeo',

  'ui.chain.intro': 'Cabecera',
  'ui.chain.outro': 'Cierre',
  'ui.chain.skip': 'Saltar cabecera',
  'ui.chain.skipped': 'Cabecera saltada',

  'ui.poster.play': 'Reproducir vídeo',
  'ui.poster.loading': 'Cargando…',

  'ui.settings.label': 'Ajustes',
  'ui.settings.back': 'Volver',
  'ui.settings.close': 'Cerrar ajustes',

  'ui.layout.label': 'Disposición',
  'ui.layout.side-by-side': 'Lado a lado',
  'ui.layout.presenter': 'Solo ponente',
  'ui.layout.presentation': 'Solo presentación',
  'ui.layout.pip': 'Imagen en imagen',
});

strings.register('en', {
  'ui.region': 'Video player',
  'ui.play': 'Play',
  'ui.pause': 'Pause',
  'ui.replay': 'Replay',
  'ui.progress': 'Seek',
  'ui.volume': 'Volume',
  'ui.mute': 'Mute',
  'ui.unmute': 'Unmute',
  'ui.fullscreenEnter': 'Full screen',
  'ui.fullscreenExit': 'Exit full screen',
  'ui.speed': 'Speed',
  'ui.normal': 'Normal',
  'ui.more': 'More options',

  'ui.status.region': 'Player status',
  'ui.status.playing': 'Playing',
  'ui.status.paused': 'Paused',
  'ui.status.buffering': 'Buffering',
  'ui.status.ended': 'Video ended',

  'ui.live.badge': 'LIVE',
  'ui.live.waiting': 'The broadcast has not started yet',
  'ui.live.interrupted': 'The broadcast was interrupted',
  'ui.live.goTo': 'Go to live',
  'ui.live.behind': 'Behind live',
  'ui.live.window': 'Position in the live stream',
  'ui.live.behindBy': 'Behind live: {time}',
  'ui.live.goToBehindBy': 'Go to live. Behind live: {time}',

  'ui.error.generic': 'The video could not be played',
  'ui.error.manifest/fetch': 'The video could not be loaded',
  'ui.error.manifest/invalid': 'This video is misconfigured',
  'ui.error.engine/unsupported': 'This browser cannot play this video',
  'ui.error.engine/failed': 'Playback could not be started',
  'ui.error.media/decode': 'The video could not be played',
  'ui.error.media/network': 'The connection to the video was lost',
  'ui.error.media/blocked': 'Press play to start',
  'ui.error.internal': 'The video could not be played',

  'ui.chain.intro': 'Intro',
  'ui.chain.outro': 'Outro',
  'ui.chain.skip': 'Skip intro',
  'ui.chain.skipped': 'Intro skipped',

  'ui.poster.play': 'Play video',
  'ui.poster.loading': 'Loading…',

  'ui.settings.label': 'Settings',
  'ui.settings.back': 'Back',
  'ui.settings.close': 'Close settings',

  'ui.layout.label': 'Layout',
  'ui.layout.side-by-side': 'Side by side',
  'ui.layout.presenter': 'Presenter only',
  'ui.layout.presentation': 'Presentation only',
  'ui.layout.pip': 'Picture in picture',
});
