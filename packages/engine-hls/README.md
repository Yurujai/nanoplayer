# @nanoplayer/engine-hls

Motor HLS sobre [hls.js](https://github.com/video-dev/hls.js). Segunda
implementación de `MediaEngine`, y prueba de que la abstracción aguanta: se
registra y ya, sin tocar el núcleo.

```ts
import { createPlayer, nativeEngineFactory } from '@nanoplayer/core';
import { enginesWithHls } from '@nanoplayer/engine-hls';

createPlayer({
  container,
  manifest: '/api/video/123',
  engines: enginesWithHls(nativeEngineFactory),
});
```

## hls.js se carga en diferido

Es dependencia de pares y solo se descarga la **primera vez que hay que
reproducir HLS**. Verificado en navegador: cargar la página y hasta resolver el
manifiesto, la librería no se pide; aparece al enganchar el motor.

Quien reproduzca MP4 no paga nada, que es lo que hace compatible una etiqueta
`<script>` con no arrastrar la librería por si acaso.

## Cómo se reparte con el motor nativo

| | `canPlay` para HLS | Gana |
|---|---|---|
| Con MSE o ManagedMediaSource | `probably` | **hls.js** |
| Sin MSE (iOS antiguo) | `no` | nativo |

Toda la decisión vive en `canPlay`. Registrar este motor delante basta; no hay
condicionales repartidos por el código.

**Nunca se decide por `canPlayType`.** El spike S2 midió que devuelve `"maybe"`
para el MIME de HLS en los cinco navegadores probados, incluido Chrome de
escritorio, que no reproduce HLS nativo. Es la trampa clásica.

## Recuperación ante errores

Es la razón práctica de preferirlo donde se puede elegir: ante un error fatal se
reintenta —`startLoad()` para red, `recoverMediaError()` para decodificación— y
solo se avisa al consumidor cuando ya no queda nada que intentar.

## Al soltar el motor, la instancia muere

`hls.destroy()` no es opcional: sin él la instancia sigue pidiendo segmentos
aunque el elemento haya desaparecido del DOM. Comprobado en el ciclo completo —
tras soltar el motor, cero peticiones de segmento.
